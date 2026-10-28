import { type ExerciseType, type Metric, SWITCH_SIDES_S } from '@halko/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BodyMap } from '../components/BodyMap.tsx';
import { Timer } from '../components/Timer.tsx';
import { ask } from '../components/Dialog.tsx';
import { ExerciseMedia } from '../components/ExerciseMedia.tsx';
import { BackLink, useLeave } from '../components/BackLink.tsx';
import { Icon } from '../components/Icon.tsx';
import { Ring } from '../components/Ring.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { SyncBadge } from '../components/SyncBadge.tsx';
import { ValueInput } from '../components/ValueInput.tsx';
import { requestSync } from '../sync/engine.ts';
import { type LocalExercise, type LocalSetLog, db } from '../db/db.ts';
import {
  type LiveState,
  addExtraSet,
  discardSession,
  doneKeys,
  finishSession,
  logSet,
  previousPerformance,
  removeLastSet,
  unlogSet,
  sessionLogs,
  updateLive,
} from '../db/sessions.ts';
import { beep, unlockAudio, useNow } from '../lib/feedback.ts';
import { formatDuration, formatSetValues } from '../lib/format.ts';
import { type SetValues, buildSteps, increase, proposedValues, raised, setCount, stepKey, targetFor, workingNumber } from '../lib/session.ts';
import { METRIC_IO, metricLabel, metricsFor } from '../lib/targets.ts';
import { t } from '../lib/i18n.ts';

function elapsedLabel(ms: number): string {
  return formatDuration(Math.floor(ms / 1000));
}

// The values of a set already done, in boxes: changing one corrects the set right away (no new rest).
function DoneCells({
  metrics,
  type,
  log,
  label,
  onCorrect,
}: {
  metrics: readonly Metric[];
  type: ExerciseType;
  log: LocalSetLog;
  label: string;
  onCorrect: (values: SetValues) => void;
}) {
  const values: SetValues = { reps: log.reps, weightG: log.weightG, durationS: log.durationS, distanceM: log.distanceM };
  return (
    <>
      {metrics.map((m) => (
        <ValueInput
          key={m}
          className="cell-input boxed"
          value={values[METRIC_IO[m].key]}
          format={METRIC_IO[m].format}
          parse={METRIC_IO[m].parse}
          onCommit={(v) => onCorrect({ ...values, [METRIC_IO[m].key]: v })}
          label={t('live.cellIn', { what: metricLabel(m, type), set: label })}
          inputMode={METRIC_IO[m].numeric ? 'numeric' : 'decimal'}
        />
      ))}
    </>
  );
}

// An exercise other than the current one, shown like it (picture, sets…) but without validating: its sets
// as planned, or as done (those can be corrected). Folded once all its sets are done; tapping unfolds it.
function OtherExercise({
  index,
  exercise,
  live,
  logs,
  lastSetOfSession,
  onCorrect,
  onUndo,
}: {
  index: number;
  exercise: LocalExercise | undefined;
  live: LiveState;
  logs: LocalSetLog[];
  lastSetOfSession: boolean;
  onCorrect: (set: number, values: SetValues) => void;
  onUndo: (set: number, log: LocalSetLog) => void;
}) {
  const p = live.plan[index]!;
  const name = exercise?.name ?? t('exercise.fallbackName');
  const total = setCount(live.plan, live.extra, index);
  const logged = new Map(logs.filter((l) => l.workoutItemId === p.itemId).map((l) => [l.setIndex, l]));
  const doneCount = Array.from({ length: total }, (_, set) => logged.has(set)).filter(Boolean).length;
  const previous = useLiveQuery(() => previousPerformance(p.exerciseId, live.sessionId), [p.exerciseId, live.sessionId]);
  const [open, setOpen] = useState(false);
  const metrics = metricsFor(p.exerciseType);
  const finished = doneCount === total;

  // Every set removed: skipped for this session, unless one is added back.
  if (total === 0) {
    return (
      <div className="card overview-row past">
        <span className="grow ellipsis" style={{ fontWeight: 700 }}>
          {name}
        </span>
        <span className="small muted">{t('live.noSet')}</span>
        <button type="button" className="btn btn-ghost" style={{ minHeight: 36 }} onClick={() => addExtraSet(live, index)}>
          {t('sets.add')}
        </button>
      </div>
    );
  }
  if (finished && !open) {
    return (
      <button type="button" className="card overview-row past" onClick={() => setOpen(true)} aria-expanded={false}>
        <span className="overview-mark">
          <Icon name="check" size={16} strokeWidth={3} />
        </span>
        <span className="grow ellipsis" style={{ fontWeight: 700 }}>
          {name}
        </span>
        <span className="small muted">
          {doneCount}/{total}
        </span>
      </button>
    );
  }
  return (
    <div className="stack other-exercise">
      {finished && (
        <button type="button" className="btn btn-ghost" style={{ minHeight: 36, alignSelf: 'flex-end' }} onClick={() => setOpen(false)} aria-expanded>
          {t('live.fold')}
        </button>
      )}
      <ExerciseMedia urls={exercise?.mediaUrls ?? []} name={name} style={{ height: 190, borderRadius: 20 }}>
        <div style={{ position: 'absolute', right: 8, bottom: 8, padding: 4, borderRadius: 10, background: 'var(--surface)' }}>
          <BodyMap primary={exercise?.primaryMuscles ?? []} secondary={exercise?.secondaryMuscles ?? []} height={78} legend={false} />
        </div>
      </ExerciseMedia>

      <div className="stack" style={{ gap: 2 }}>
        <h2 className="title-sm ellipsis">{name}</h2>
        {p.supersetGroup && <span className="small" style={{ color: 'var(--superset)', fontWeight: 700 }}>{t('live.superset')}</span>}
      </div>

      {p.note && (
        <div className="row small" style={{ gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--surface)' }}>
          <Icon name="pencil" size={14} />
          {p.note}
        </div>
      )}

      <div className="stack" style={{ gap: 4, ['--cols' as string]: metrics.length }}>
        <div className="live-row live-head">
          <span>{t('sets.set')}</span>
          <span style={{ textAlign: 'center' }}>{t('live.previous')}</span>
          {metrics.map((m) => (
            <span key={m} style={{ textAlign: 'center' }}>{metricLabel(m, p.exerciseType, p.unilateral)}</span>
          ))}
          <span />
        </div>
        {Array.from({ length: total }, (_, set) => {
          const log = logged.get(set);
          const target = targetFor(live.plan, index, set);
          const prev = previous?.get(set);
          const values = proposedValues(live.plan, index, set, previous, live.bumps);
          const number = target.kind === 'warmup' ? t('sets.warmupShort') : workingNumber(p, set);
          return (
            <div key={set} className={`live-row${log ? ' done' : ''}`}>
              <span style={{ fontWeight: 700, color: target.kind === 'warmup' ? 'var(--warn)' : undefined }}>{number}</span>
              <span className="small muted ellipsis" style={{ textAlign: 'center' }}>{prev ? formatSetValues(p.exerciseType, prev) : '—'}</span>
              {log ? (
                <DoneCells metrics={metrics} type={p.exerciseType} log={log} label={t('live.setOf', { name, n: number })} onCorrect={(v) => onCorrect(set, v)} />
              ) : (
                metrics.map((m) => (
                  <span key={m} className="num ellipsis" style={{ fontSize: '1.125rem', textAlign: 'center' }}>
                    {METRIC_IO[m].format(values[METRIC_IO[m].key]) || '—'}
                  </span>
                ))
              )}
              {log ? (
                <button type="button" className="check on" onClick={() => onUndo(set, log)} aria-label={t('live.undo', { n: number })}>
                  <Icon name="check" size={16} strokeWidth={3} />
                </button>
              ) : (
                <span className="check" aria-label={t('live.toDo')} />
              )}
            </div>
          );
        })}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost grow" onClick={() => addExtraSet(live, index)}>
            {t('sets.add')}
          </button>
          <button
            type="button"
            className="btn btn-ghost grow"
            disabled={lastSetOfSession || logged.has(total - 1)}
            onClick={() => removeLastSet(live, index)}
            aria-label={t('live.removeLastOf', { name })}
          >
            {t('live.removeSet')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LiveSession() {
  const navigate = useNavigate();
  const leave = useLeave();
  const live = useLiveQuery(async () => ((await db.meta.get('live'))?.value as LiveState | undefined) ?? null, []);
  const session = useLiveQuery(() => (live ? db.sessions.get(live.sessionId) : undefined), [live?.sessionId]);
  const logs = useLiveQuery(() => (live ? sessionLogs(live.sessionId) : []), [live?.sessionId]);
  const exercises = useLiveQuery(async () => {
    if (!live) return new Map();
    const rows = await db.exercises.bulkGet(live.plan.map((p) => p.exerciseId));
    return new Map(rows.filter((r) => r !== undefined).map((r) => [r.id, r]));
  }, [live?.sessionId]);
  const now = useNow(250);
  const [finishing, setFinishing] = useState(false);

  const steps = useMemo(() => (live ? buildSteps(live.plan, live.extra) : []), [live]);
  const done = useMemo(() => doneKeys(logs ?? []), [logs]);
  const step = live ? steps[live.cursor] : undefined;
  const item = live && step ? live.plan[step.item] : undefined;
  const exercise = item ? exercises?.get(item.exerciseId) : undefined;
  const previous = useLiveQuery(
    () => (item && live ? previousPerformance(item.exerciseId, live.sessionId) : new Map<number, SetValues>()),
    [item?.exerciseId, live?.sessionId],
  );

  // Values typed for each set (by step key): kept when going to another set or when the data reloads,
  // until the set is validated.
  const [edits, setEdits] = useState<Record<string, SetValues>>({});
  const draftKey = live && step ? stepKey(live.plan, step) : '';
  const loggedForStep = logs?.find((l) => `${l.workoutItemId}:${l.setIndex}` === draftKey);
  // What a set starts with: last time's values (else the plan), raised to what earlier sets reached.
  const startValues = (set: number) => (live && step ? proposedValues(live.plan, step.item, set, previous, live.bumps) : {});
  const startedFrom = step ? (loggedForStep ?? startValues(step.set)) : {};
  const draft: SetValues = { ...startedFrom, ...edits[draftKey] };
  // An increase typed on the current set shows on the next ones straight away (it is carried to them
  // when the set is validated; a decrease is not).
  const pending = increase(draft, startedFrom);
  const setField = useCallback(
    (key: keyof SetValues, v: number) => setEdits((e) => (e[draftKey]?.[key] === v ? e : { ...e, [draftKey]: { ...e[draftKey], [key]: v } })),
    [draftKey],
  );
  const setDuration = useCallback((s: number) => setField('durationS', s), [setField]);
  // While the timer runs or is paused, it owns the duration: the Time field is locked.
  const [timerStarted, setTimerStarted] = useState(false);

  const setNumber = (set: number) => (item ? workingNumber(item, set) : set + 1);

  // Moving on to another exercise brings it into view (the ones done above it are folded).
  const currentRef = useRef<HTMLDivElement>(null);
  const shownItem = useRef(step?.item);
  useEffect(() => {
    if (step?.item === shownItem.current) return;
    shownItem.current = step?.item;
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step?.item]);

  // End of rest: beep once, then close the rest screen.
  const beeped = useRef<number | null>(null);
  const resting = !!live?.restEndsAt && now < live.restEndsAt;
  useEffect(() => {
    if (live?.restEndsAt && now >= live.restEndsAt && beeped.current !== live.restEndsAt) {
      beeped.current = live.restEndsAt;
      beep();
      void updateLive({ restEndsAt: null });
    }
  }, [now, live?.restEndsAt]);

  if (live === undefined) return <div className="page muted">{t('common.loading')}</div>;
  if (live === null) {
    return (
      <div className="page">
        <p>{t('live.none')}</p>
        <Link to="/">{t('live.choose')}</Link>
      </div>
    );
  }

  const itemCount = live.plan.length;
  const allDone = steps.length > 0 && steps.every((s) => done.has(stepKey(live.plan, s)));
  const type = item?.exerciseType ?? 'weight_reps';
  const metrics = metricsFor(type);
  const itemSets = step ? Array.from({ length: setCount(live.plan, live.extra, step.item) }, (_, k) => k) : [];

  const validate = async () => {
    if (!step) return;
    unlockAudio();
    const key = draftKey;
    await logSet(live, live.cursor, draft, undefined, startedFrom);
    setEdits(({ [key]: _done, ...others }) => others);
  };
  // A set validated by mistake: to do again, with the values it had.
  const undo = (itemIndex: number, set: number, log: LocalSetLog) => {
    const values: SetValues = { reps: log.reps, weightG: log.weightG, durationS: log.durationS, distanceM: log.distanceM };
    setEdits((e) => ({ ...e, [`${live.plan[itemIndex]!.itemId}:${set}`]: values }));
    void unlogSet(live, itemIndex, set);
  };
  // A set already done, changed in its boxes: saved at once, without a new rest.
  const correct = (itemIndex: number, set: number, values: SetValues) => {
    const idx = steps.findIndex((st) => st.item === itemIndex && st.set === set);
    if (idx !== -1) void logSet(live, idx, values);
  };
  const finish = async () => {
    const id = await finishSession();
    requestSync(0);
    // Replaces this screen: going back from the summary must not return to a finished session.
    navigate(id ? `/history/${id}?done=1` : '/', { replace: true });
  };

  // `now` ticks every 250 ms and can lag the moment the rest started: never show more than planned.
  const restLeft = resting ? Math.min(live.restTotalS, Math.ceil((live.restEndsAt! - now) / 1000)) : 0;
  const nextStep = steps[live.cursor];

  return (
    <div className={`page live${resting ? ' resting' : ''}`} style={{ maxWidth: 720 }}>
      {/* Stays at the top of the screen while scrolling through the exercises. */}
      <div className="live-top">
      <header className="row" style={{ gap: 10 }}>
        <BackLink to="/" label={t('live.leave')} />
        <div className="grow stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="ellipsis" style={{ fontWeight: 700 }}>
            {session?.name ?? t('live.session')}
          </span>
          <span className="small muted">
            {t('live.progress', { n: step ? step.item + 1 : itemCount, total: itemCount, time: session ? elapsedLabel(now - session.startedAt) : '' })}
          </span>
        </div>
        <span className="hide-narrow">
          <SyncBadge compact />
        </span>
        <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setFinishing(true)}>
          {t('live.finish')}
        </button>
      </header>

      <div className="session-progress" style={{ gridTemplateColumns: `repeat(${itemCount}, minmax(0, 1fr))` }} aria-hidden="true">
        {live.plan.map((p, k) => {
          const total = setCount(live.plan, live.extra, k);
          const doneCount = Array.from({ length: total }, (_, s) => done.has(`${p.itemId}:${s}`)).filter(Boolean).length;
          return <span key={p.itemId} className={doneCount === total ? 'full' : k === step?.item ? 'current' : ''} />;
        })}
      </div>
      </div>

      {allDone && (
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center', padding: 28 }}>
          <h1 className="title-sm">{t('live.allDone')}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t('live.allDoneText', { count: logs?.length ?? 0, time: session ? elapsedLabel(now - session.startedAt) : '' })}
          </p>
          <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={finish}>
            {t('live.finishSession')}
          </button>
        </div>
      )}

      {live.plan.map((p, k) =>
        !allDone && step && item && k === step.item ? (
          <div key={p.itemId} ref={currentRef} className="stack current-exercise">
            <ExerciseMedia urls={exercise?.mediaUrls ?? []} name={exercise?.name ?? ''} style={{ height: 190, borderRadius: 20 }}>
              <div style={{ position: 'absolute', right: 8, bottom: 8, padding: 4, borderRadius: 10, background: 'var(--surface)' }}>
                <BodyMap primary={exercise?.primaryMuscles ?? []} secondary={exercise?.secondaryMuscles ?? []} height={78} legend={false} />
              </div>
            </ExerciseMedia>

            <div className="stack" style={{ gap: 2 }}>
              <h1 className="title-sm ellipsis">{exercise?.name}</h1>
              {item.supersetGroup && <span className="small" style={{ color: 'var(--superset)', fontWeight: 700 }}>{t('live.superset')}</span>}
            </div>

            {item.note && (
              <div className="row small" style={{ gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--surface)' }}>
                <Icon name="pencil" size={14} />
                {item.note}
              </div>
            )}

            <div className="stack" style={{ gap: 4, ['--cols' as string]: metrics.length }}>
              <div className="live-row live-head">
                <span>{t('sets.set')}</span>
                <span style={{ textAlign: 'center' }}>{t('live.previous')}</span>
                {metrics.map((m) => (
                  <span key={m} style={{ textAlign: 'center' }}>{metricLabel(m, type, item.unilateral)}</span>
                ))}
                <span />
              </div>
              {itemSets.map((set) => {
                const key = `${item.itemId}:${set}`;
                const log = logs?.find((l) => `${l.workoutItemId}:${l.setIndex}` === key);
                const target = targetFor(live.plan, step.item, set);
                const isCurrent = set === step.set;
                const prev = previous?.get(set);
                // A set not done yet shows what was typed for it, if anything.
                const values = log ?? { ...raised(startValues(set), set > step.set ? pending : undefined), ...edits[key] };
                return (
                  <div key={key} className={`live-row${isCurrent ? ' current' : ''}${log ? ' done' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
                    <span style={{ fontWeight: 700, color: target.kind === 'warmup' ? 'var(--warn)' : undefined }}>
                      {target.kind === 'warmup' ? t('sets.warmupShort') : setNumber(set)}
                    </span>
                    <span className="small muted ellipsis" style={{ textAlign: 'center' }}>{prev ? formatSetValues(type, prev) : '—'}</span>
                    {log && !isCurrent ? (
                      <DoneCells metrics={metrics} type={type} log={log} label={t('live.setN', { n: setNumber(set) })} onCorrect={(v) => correct(step.item, set, v)} />
                    ) : (
                    metrics.map((m) =>
                      // The current set is typed in its boxes; the others show their values.
                      isCurrent ? (
                        <ValueInput
                          key={m}
                          className="cell-input boxed"
                          value={draft[METRIC_IO[m].key]}
                          format={METRIC_IO[m].format}
                          parse={METRIC_IO[m].parse}
                          onCommit={(v) => setField(METRIC_IO[m].key, v)}
                          label={t('live.cellOf', { what: metricLabel(m, type), n: setNumber(set) })}
                          inputMode={METRIC_IO[m].numeric ? 'numeric' : 'decimal'}
                          disabled={m === 'duration' && timerStarted}
                        />
                      ) : (
                        <span key={m} className="num ellipsis" style={{ fontSize: '1.125rem', textAlign: 'center' }}>
                          {METRIC_IO[m].format(values[METRIC_IO[m].key]) || '—'}
                        </span>
                      ),
                    )
                    )}
                    {/* The box validates the current set, or undoes a set done. */}
                    {log ? (
                      <button type="button" className="check on" onClick={() => undo(step.item, set, log)} aria-label={t('live.undo', { n: setNumber(set) })}>
                        <Icon name="check" size={16} strokeWidth={3} />
                      </button>
                    ) : isCurrent ? (
                      <button type="button" className="check" onClick={validate} aria-label={t('live.validateSet', { n: setNumber(set) })} />
                    ) : (
                      <span className="check" aria-label={t('live.toDo')} />
                    )}
                  </div>
                );
              })}
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-ghost grow" onClick={() => addExtraSet(live, step.item)}>
                  {t('sets.add')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost grow"
                  disabled={steps.length <= 1 || !!logs?.some((l) => l.workoutItemId === item.itemId && l.setIndex === itemSets.length - 1)}
                  onClick={() => removeLastSet(live, step.item)}
                  aria-label={t('live.removeLast')}
                >
                  {t('live.removeSet')}
                </button>
              </div>
            </div>

            {metrics.includes('duration') && <Timer key={draftKey} targetS={draft.durationS} switchS={item.unilateral ? (item.switchS ?? SWITCH_SIDES_S) : null} onChange={setDuration} onStartedChange={setTimerStarted} />}


            <button type="button" className="btn btn-primary" style={{ minHeight: 58, fontSize: '1.0625rem' }} onClick={validate}>
              <Icon name="check" size={20} strokeWidth={3} />
              {loggedForStep ? t('live.correctSet') : step.target.kind === 'warmup' ? t('live.validateWarmup') : t('live.validateSet', { n: setNumber(step.set) })}
            </button>
          </div>
        ) : (
          <OtherExercise
            key={p.itemId}
            index={k}
            exercise={exercises?.get(p.exerciseId)}
            live={live}
            logs={logs ?? []}
            lastSetOfSession={steps.length <= 1}
            onCorrect={(set, values) => correct(k, set, values)}
            onUndo={(set, log) => undo(k, set, log)}
          />
        ),
      )}

      {resting && (
        // Not a live region: the time left changes every second and would be read out each time.
        <section className="rest-bar" aria-label={t('live.rest')}>
          <Ring size={64} progress={live.restTotalS ? 1 - restLeft / live.restTotalS : 0} color="var(--accent)">
            <span className="num" role="timer" style={{ fontSize: 'min(1.125rem, 22px)', lineHeight: 1 }}>
              {formatDuration(restLeft)}
            </span>
          </Ring>
          <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="section-title">{t('live.rest')}</span>
            {nextStep && (
              <span className="small muted ellipsis">
                {t('live.next', { name: exercises?.get(live.plan[nextStep.item]!.exerciseId)?.name ?? '', values: formatSetValues(live.plan[nextStep.item]!.exerciseType, { ...nextStep.target, unilateral: live.plan[nextStep.item]!.unilateral }) })}
              </span>
            )}
          </div>
          <div className="rest-actions">
            <button type="button" className="btn" onClick={() => updateLive({ restEndsAt: Math.max(now + 1000, live.restEndsAt! - 15000) })}>
              −15 s
            </button>
            <button type="button" className="btn" onClick={() => updateLive({ restEndsAt: live.restEndsAt! + 15000, restTotalS: live.restTotalS + 15 })}>
              +15 s
            </button>
            <button type="button" className="btn btn-primary" onClick={() => updateLive({ restEndsAt: null })}>
              {t('live.skip')}
            </button>
          </div>
        </section>
      )}

      {finishing && (
        <Sheet title={t('live.finishTitle')} onClose={() => setFinishing(false)}>
          <p style={{ margin: 0 }}>
            {t('live.finishCount', { count: logs?.length ?? 0, total: steps.length })}
          </p>
          <button type="button" className="btn btn-primary" onClick={finish}>
            {t('live.finishSave')}
          </button>
          <button type="button" className="btn" onClick={() => setFinishing(false)}>
            {t('live.continue')}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              setFinishing(false);
              const sure = await ask({
                title: t('live.abandonTitle'),
                message: t('live.abandonMessage'),
                confirm: t('live.abandon'),
                cancel: t('live.back'),
                danger: true,
              });
              if (!sure) return setFinishing(true);
              await discardSession();
              leave('/');
            }}
          >
            {t('live.abandon')}
          </button>
        </Sheet>
      )}
    </div>
  );
}
