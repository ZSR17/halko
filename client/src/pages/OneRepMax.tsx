import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon.tsx';
import { Stepper } from '../components/Stepper.tsx';
import type { LocalSetLog } from '../db/db.ts';
import { liftedSets } from '../db/sessions.ts';
import { formatWeight, parseCount, parseWeight, roundWeight, weightStep, weightText, weightUnit } from '../lib/format.ts';
import { FORMULAS, type Formula, MAX_REPS, PERCENTAGES, oneRepMax, oneRmSettings, repsAt } from '../lib/oneRm.ts';
import { formatDate, t } from '../lib/i18n.ts';
import { Select } from '../components/Select.tsx';

const formatReps = (n: number | undefined) => (n === undefined ? '' : String(n));
const parseReps = (s: string) => {
  const n = parseCount(s);
  return n === null ? null : Math.min(MAX_REPS, Math.max(1, n));
};
// To the nearest tenth of a kg or lb: finer than any plate, no need for more.
const round = (g: number) => roundWeight(g, 0.1);
const kg = weightText;
const day = (ts: number) => formatDate(ts, { day: 'numeric', month: 'long', year: 'numeric' });

export function OneRepMax() {
  const settings = oneRmSettings.use();
  const { exerciseId, reserve } = settings;
  const formula: Formula = settings.formula in FORMULAS ? settings.formula : 'brzycki';
  const lifted = useLiveQuery(() => liftedSets(), []);

  // Picking an exercise fills in its best set for the chosen formula, until the values are edited by hand.
  const best = (lifted?.find((l) => l.exercise.id === exerciseId)?.sets ?? [])
    .filter((s) => s.reps! <= MAX_REPS)
    .reduce<LocalSetLog | undefined>(
      (top, s) => (!top || oneRepMax(s.weightG!, s.reps!, formula) > oneRepMax(top.weightG!, top.reps!, formula) ? s : top),
      undefined,
    );
  const { weightG, reps } = best ?? settings;
  const edit = (patch: { weightG?: number; reps?: number }) => oneRmSettings.set({ weightG, reps, ...patch, exerciseId: '' });
  const toFailure = reps && Math.min(MAX_REPS, reps + reserve);
  const max = weightG && toFailure ? oneRepMax(weightG, toFailure, formula) : undefined;

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="title">{t('oneRm.title')}</h1>

      <section className="stack">
        <h2 className="section-title">{t('oneRm.yourSet')}</h2>
        {!!lifted?.length && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">{t('oneRm.fromHistory')}</span>
            <Select
              label={t('oneRm.fromHistory')}
              value={exerciseId}
              options={[{ value: '', label: t('oneRm.chooseExercise') }, ...lifted.map((l) => ({ value: l.exercise.id, label: l.exercise.name }))]}
              onChange={(id) => oneRmSettings.set({ exerciseId: id })}
            />
            {best && (
              <span className="small muted">
                {t('oneRm.bestSet', { weight: kg(best.weightG!), reps: best.reps ?? 0, date: day(best.completedAt) })}
              </span>
            )}
          </div>
        )}
        <div className="steppers">
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">{t('oneRm.load')}</span>
            <Stepper label={t('oneRm.load')} unit={weightUnit()} value={weightG} step={weightStep()} format={formatWeight} parse={parseWeight} onChange={(v) => edit({ weightG: v })} />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">{t('oneRm.reps')}</span>
            <Stepper
              label={t('oneRm.reps')}
              unit="reps"
              value={reps}
              step={1}
              min={1}
              max={MAX_REPS}
              format={formatReps}
              parse={parseReps}
              inputMode="numeric"
              onChange={(v) => edit({ reps: Math.max(1, v) })}
            />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">{t('oneRm.reserve')}</span>
            <Stepper
              label={t('oneRm.reserveLabel')}
              unit="reps"
              value={reserve}
              step={1}
              max={10}
              format={formatReps}
              parse={(text) => {
                const n = parseCount(text);
                return n === null ? null : Math.min(10, n);
              }}
              inputMode="numeric"
              onChange={(v) => oneRmSettings.set({ reserve: v })}
            />
          </div>
        </div>
      </section>

      <section className="stack">
        <h2 className="section-title">{t('oneRm.formula')}</h2>
        <div className="chips-wrap">
          {(Object.keys(FORMULAS) as Formula[]).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={formula === f} onClick={() => oneRmSettings.set({ formula: f })}>
              {FORMULAS[f].label}
            </button>
          ))}
        </div>
      </section>

      {max !== undefined && (
        <section className="stack">
          {toFailure! > 10 && (
            <div className="card notice-warn">{t('oneRm.lowAccuracy')}</div>
          )}
          <div className="card stack" style={{ gap: 4 }}>
            <span className="label">{t('oneRm.estimated')}</span>
            <span className="title">{kg(round(max))}</span>
            {reserve > 0 && (
              <span className="small muted">
                {t('oneRm.countedAs', { total: toFailure ?? 0, reps: reps ?? 0, reserve })}
              </span>
            )}
          </div>
          <div className="card percent-table">
            {PERCENTAGES.map((p) => {
              const g = round((max * p) / 100);
              const r = repsAt(p, formula);
              return (
                <Link key={p} to={`/plates?weight=${g}`} className="row" aria-label={t('oneRm.rowLabel', { p, weight: kg(g) })}>
                  <span className="percent">{p} %</span>
                  <span className="grow small muted">{r === null ? t('oneRm.manyReps', { max: MAX_REPS }) : t('oneRm.aboutReps', { count: r })}</span>
                  <span className="percent-kg">{kg(g)}</span>
                  <Icon name="chevron" size={16} />
                </Link>
              );
            })}
          </div>
          <span className="small muted">{t('oneRm.tapRow')}</span>
        </section>
      )}
    </div>
  );
}
