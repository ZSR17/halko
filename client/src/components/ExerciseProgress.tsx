import type { LocalExercise, LocalSession, LocalSetLog } from '../db/db.ts';
import { formatSetValues } from '../lib/format.ts';
import { metricsForType } from '../lib/progress.ts';
import { type PanelMetric, ProgressPanel } from './ProgressPanel.tsx';
import { t } from '../lib/i18n.ts';

// Records, chart and table of an exercise's finished sessions (charge, volume…).
export function ExerciseProgress({ exercise, history }: { exercise: LocalExercise; history: { session: LocalSession; sets: LocalSetLog[] }[] }) {
  const metrics: PanelMetric[] = metricsForType(exercise.exerciseType).map((m) => ({
    id: m.id,
    label: m.label,
    format: m.format,
    scale: m.scale,
    higherIsBetter: m.higherIsBetter,
    // An estimated 1RM is not a weight actually lifted.
    record: m.id !== '1rm',
    rows: history.flatMap((h) => {
      const value = m.best(h.sets);
      return value === undefined
        ? []
        : [{ session: h.session, value, detail: h.sets.map((s) => formatSetValues(exercise.exerciseType, s)).join(', ') }];
    }),
  }));
  return <ProgressPanel name={exercise.name} metrics={metrics} detailLabel={t('sets.sets')} />;
}
