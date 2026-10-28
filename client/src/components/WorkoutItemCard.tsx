import { type ExerciseType, SWITCH_SIDES_S, type SetTarget } from '@halko/shared';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LocalExercise, LocalWorkoutItem } from '../db/db.ts';
import { formatDuration, parseCount, parseDuration } from '../lib/format.ts';
import {
  METRIC_IO,
  addSet,
  formatCount,
  isAutoWarmup,
  metricLabel,
  metricsFor,
  removeSet,
  setSimpleCount,
  toKind,
  updateAll,
  updateFrom,
  updateOne,
  withWarmups,
} from '../lib/targets.ts';
import { doneBySide } from '../lib/session.ts';
import { withMode } from '../lib/workoutDraft.ts';
import { thumbUrl } from './ExerciseMedia.tsx';
import { Icon } from './Icon.tsx';
import { ValueInput } from './ValueInput.tsx';
import { t } from '../lib/i18n.ts';

interface Props {
  item: LocalWorkoutItem;
  exercise: LocalExercise | undefined;
  supersetLabel?: string;
}

// Top of the card: picture, name, number of sets; `children` on the right.
function ItemHeader({ item, exercise, supersetLabel, children }: Props & { children: ReactNode }) {
  return (
    <>
      {supersetLabel && (
        <span className="superset-tag">
          <Icon name="link" size={14} />
          {t('item.superset', { label: supersetLabel })}
        </span>
      )}
      <div className="row" style={{ gap: 10 }}>
        <img className="thumb thumb-sm" src={thumbUrl(exercise?.mediaUrls ?? [])} alt="" />
        <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
          <span className="ellipsis" style={{ fontWeight: 700 }}>
            {exercise?.name ?? t('exercise.fallbackName')}
          </span>
          <span className="small muted">
            {t('sets.count', { count: item.targets.length })}
          </span>
        </span>
        {children}
      </div>
    </>
  );
}

// A value of the sets: typed in while editing, plain text otherwise (same place, same look).
function Value(props: {
  value: number | undefined;
  format: (v: number | undefined) => string;
  parse: (s: string) => number | null;
  onCommit?: (v: number) => void;
  label: string;
  numeric?: boolean;
  className?: string;
  // A warm-up value worked out from the working sets (dimmed), not typed in.
  auto?: boolean;
}) {
  const className = `${props.className ?? 'cell-input'}${props.auto ? ' auto' : ''}`;
  const title = props.auto ? t('sets.warmupAuto') : undefined;
  if (!props.onCommit) {
    return (
      <span className={`${className} static`} title={title}>
        {props.format(props.value) || '—'}
      </span>
    );
  }
  return (
    <ValueInput
      value={props.value}
      format={props.format}
      parse={props.parse}
      onCommit={props.onCommit}
      label={props.label}
      inputMode={props.numeric ? 'numeric' : 'decimal'}
      className={className}
      title={title}
    />
  );
}

// The planned sets, the same read-only and while editing. `onChange` (editing only) receives the changed item.
function ItemSets({ item, exercise, onChange }: { item: LocalWorkoutItem; exercise: LocalExercise | undefined; onChange?: (item: LocalWorkoutItem) => void }) {
  const type: ExerciseType = exercise?.exerciseType ?? 'weight_reps';
  const metrics = metricsFor(type);
  // The sets as shown: warm-up values left to work out are filled in from the working sets.
  const shown = withWarmups(item.targets, { exerciseType: type, equipment: exercise?.equipment ?? [] });
  const first = item.targets[0];
  const edit = onChange && ((targets: SetTarget[]) => onChange({ ...item, targets }));
  const commit = <T,>(fn: (v: T) => SetTarget[]) => edit && ((v: T) => edit(fn(v)));

  if (item.mode === 'simple' && first) {
    return (
      <div className="fields">
        <label className="field">
          <span>{t('sets.sets')}</span>
          <Value
            value={item.targets.length}
            format={formatCount}
            parse={(s) => {
              const n = parseCount(s);
              return n && n <= 30 ? n : null;
            }}
            onCommit={commit((n: number) => setSimpleCount(item.targets, n))}
            label={t('sets.setsCount')}
            numeric
          />
        </label>
        {metrics.map((m) => (
          <label key={m} className="field">
            <span>{metricLabel(m, type, doneBySide(exercise, item))}</span>
            <Value
              value={first[METRIC_IO[m].key] as number | undefined}
              format={METRIC_IO[m].format}
              parse={METRIC_IO[m].parse}
              onCommit={commit((v: number) => updateAll(item.targets, { [METRIC_IO[m].key]: v }))}
              label={metricLabel(m, type)}
              numeric={METRIC_IO[m].numeric}
            />
          </label>
        ))}
        <label className="field">
          <span>{t('sets.rest')}</span>
          <Value
            value={first.restS}
            format={formatDuration}
            parse={parseDuration}
            onCommit={commit((v: number) => updateAll(item.targets, { restS: v }))}
            label={t('sets.restBetween')}
            numeric
          />
        </label>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 4, ['--cols' as string]: metrics.length }}>
      <div className="set-row set-head">
        <span>{t('sets.set')}</span>
        {metrics.map((m) => (
          <span key={m}>{metricLabel(m, type, doneBySide(exercise, item))}</span>
        ))}
        <span>{t('sets.rest')}</span>
        <span />
      </div>
      {item.targets.map((target, idx) => {
        const workingIndex = item.targets.slice(0, idx + 1).filter((x) => x.kind !== 'warmup').length;
        const kind = target.kind === 'warmup' ? t('sets.warmupShort') : workingIndex;
        return (
          <div key={idx} className="set-row">
            {edit ? (
              <button
                type="button"
                className={`kind-btn${target.kind === 'warmup' ? ' warmup' : ''}`}
                onClick={() => edit(toKind(item.targets, shown, idx, target.kind === 'warmup' ? 'normal' : 'warmup', type))}
                aria-label={t('sets.kindToggle', { n: idx + 1, kind: target.kind === 'warmup' ? t('sets.warmup') : t('sets.working') })}
              >
                {kind}
              </button>
            ) : (
              <span className={`kind-btn${target.kind === 'warmup' ? ' warmup' : ''}`}>{kind}</span>
            )}
            {metrics.map((m) => {
              const key = METRIC_IO[m].key;
              const auto = (key === 'weightG' || key === 'reps') && isAutoWarmup(target, key, type);
              // A warm-up value typed in can go back to being worked out.
              const typedIn = !!edit && (key === 'weightG' || key === 'reps') && isAutoWarmup({ ...target, [key]: undefined }, key, type) && !auto;
              return (
                <span key={m} className="cell-wrap">
                  <Value
                    value={shown[idx]![key] as number | undefined}
                    format={METRIC_IO[m].format}
                    parse={METRIC_IO[m].parse}
                    onCommit={commit((v: number) => updateFrom(item.targets, idx, key, v, shown[idx]![key]))}
                    label={t('sets.cell', { n: idx + 1, what: metricLabel(m, type) })}
                    numeric={METRIC_IO[m].numeric}
                    auto={auto}
                  />
                  {typedIn && (
                    <button
                      type="button"
                      className="cell-reset"
                      onClick={() => edit(updateOne(item.targets, idx, { [key]: undefined }))}
                      aria-label={t('sets.warmupReset')}
                      title={t('sets.warmupReset')}
                    >
                      <Icon name="undo" size={14} />
                    </button>
                  )}
                </span>
              );
            })}
            <Value
              className="cell-input rest"
              value={target.restS}
              format={formatDuration}
              parse={parseDuration}
              onCommit={commit((v: number) => updateOne(item.targets, idx, { restS: v }))}
              label={t('sets.restCell', { n: idx + 1 })}
              numeric
            />
            {edit ? (
              <button
                type="button"
                className="icon-btn icon-btn-plain"
                style={{ height: 36 }}
                onClick={() => edit(removeSet(item.targets, idx))}
                disabled={item.targets.length <= 1}
                aria-label={t('sets.remove', { n: idx + 1 })}
              >
                <Icon name="close" size={16} />
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {edit && (
        <button type="button" className="btn btn-ghost" onClick={() => edit([...item.targets, addSet(shown, type).at(-1)!])}>
          {t('sets.add')}
        </button>
      )}
    </div>
  );
}

// For a timed exercise working one side at a time: whether it is done side by side here, with a pause to
// change sides (else as a plain set), and that pause.
function ItemSwitch({ item, onChange }: { item: LocalWorkoutItem; onChange: (item: LocalWorkoutItem) => void }) {
  const on = item.bySide !== false;
  return (
    <div className="fields">
      <button
        type="button"
        className="field field-toggle"
        aria-pressed={on}
        onClick={() => onChange({ ...item, bySide: on ? false : null })}
      >
        <span>{t('item.bySide')}</span>
        <span className="switch" aria-hidden="true" />
      </button>
      {/* Always there (dimmed and fixed when off), so the switch does not move when turned on or off. */}
      <label className={`field${on ? '' : ' field-off'}`} aria-disabled={!on}>
        <span>{t('item.switchS')}</span>
        <Value
          value={item.switchS ?? SWITCH_SIDES_S}
          format={formatDuration}
          parse={(s) => {
            const v = parseDuration(s);
            return v !== null && v <= 600 ? v : null;
          }}
          onCommit={on ? (v) => onChange({ ...item, switchS: v }) : undefined}
          label={t('item.switchLabel')}
          numeric
        />
      </label>
    </div>
  );
}

const timedUnilateral = (exercise: LocalExercise | undefined) => !!exercise?.unilateral && metricsFor(exercise.exerciseType).includes('duration');

// An exercise of a workout being edited: changes go to `onChange`, saved with the whole workout.
export function WorkoutItemCard({
  item,
  exercise,
  supersetLabel,
  onChange,
  onRemove,
}: Props & { onChange: (item: LocalWorkoutItem) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const [note, setNote] = useState(item.note ?? '');
  useEffect(() => setNote(item.note ?? ''), [item.note]);
  const type = exercise?.exerciseType ?? 'weight_reps';

  return (
    <article
      ref={setNodeRef}
      className={`item-card${supersetLabel ? ' in-superset' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 2 : undefined, position: 'relative' }}
    >
      <ItemHeader item={item} exercise={exercise} supersetLabel={supersetLabel}>
        <button type="button" className="icon-btn icon-btn-plain" onClick={onRemove} aria-label={t('item.remove', { name: exercise?.name ?? t('item.thisExercise') })}>
          <Icon name="trash" size={18} />
        </button>
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="icon-btn drag-handle"
          aria-label={t('item.move', { name: exercise?.name ?? t('item.thisExercise') })}
          {...attributes}
          {...listeners}
        >
          <Icon name="grip" size={18} />
        </button>
      </ItemHeader>

      <div className="seg" role="group" aria-label={t('item.mode')}>
        <button type="button" aria-pressed={item.mode === 'simple'} onClick={() => onChange(withMode(item, 'simple'))}>
          {t('item.simple')}
        </button>
        <button type="button" aria-pressed={item.mode === 'per_set'} onClick={() => onChange(withMode(item, 'per_set'))}>
          {t('item.perSet')}
        </button>
      </div>

      <ItemSets item={item} exercise={exercise} onChange={onChange} />
      {timedUnilateral(exercise) && <ItemSwitch item={item} onChange={onChange} />}

      <label className="note-input">
        <Icon name="pencil" size={16} />
        <span className="sr-only">{t('item.noteFor', { name: exercise?.name ?? '' })}</span>
        <input
          value={note}
          placeholder={t('item.notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (item.note ?? '') && onChange({ ...item, note: note.trim() || null })}
        />
      </label>
    </article>
  );
}

// The same card read-only: the planned sets as they are shown while editing, without the controls.
// With `tag` instead of a link to the exercise: a preview, of exercises that may not be here yet.
export function WorkoutItemView({ item, exercise, supersetLabel, tag }: Props & { tag?: ReactNode }) {
  return (
    <article className={`item-card${supersetLabel ? ' in-superset' : ''}`}>
      {tag === undefined ? (
        <Link to={`/exercises/${item.exerciseId}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>
          <ItemHeader item={item} exercise={exercise} supersetLabel={supersetLabel}>
            <Icon name="chevron" size={18} />
          </ItemHeader>
        </Link>
      ) : (
        <ItemHeader item={item} exercise={exercise} supersetLabel={supersetLabel}>
          {tag}
        </ItemHeader>
      )}
      <ItemSets item={item} exercise={exercise} />
      {timedUnilateral(exercise) && doneBySide(exercise, item) && <span className="small muted">{t('item.sides', { time: formatDuration(item.switchS ?? SWITCH_SIDES_S) })}</span>}
      {item.note && (
        <p className="note-input" style={{ margin: 0, fontSize: '0.8125rem' }}>
          <Icon name="pencil" size={16} />
          {item.note}
        </p>
      )}
    </article>
  );
}
