import type { ExerciseType } from '@halko/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db.ts';
import { workoutHistory } from '../db/sessions.ts';
import { formatTonnage, formatMinutes, sessionDurationMs, sessionVolumeG } from '../lib/stats.ts';
import { type PanelMetric, ProgressPanel } from './ProgressPanel.tsx';
import { weightScale } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';

// Records and chart of the sessions done from a workout: volume, reps and duration of each.
export function WorkoutProgress({ workoutId, name }: { workoutId: string; name: string }) {
  const data = useLiveQuery(async () => {
    const history = await workoutHistory(workoutId);
    const ids = [...new Set(history.flatMap((h) => h.sets.map((l) => l.exerciseId)))];
    const exercises = await db.exercises.bulkGet(ids);
    const types = new Map<string, ExerciseType>(exercises.filter((e) => e !== undefined).map((e) => [e.id, e.exerciseType]));
    return { history, types };
  }, [workoutId]);
  if (!data?.history.length) return null;

  const { history, types } = data;
  const measure = (id: string, label: string, format: (v: number) => string, value: (h: (typeof history)[number]) => number, record = true, scale?: number): PanelMetric => ({
    id,
    label,
    format,
    scale,
    higherIsBetter: true,
    record,
    rows: history.flatMap((h) => {
      const v = value(h);
      return v > 0 ? [{ session: h.session, value: v }] : [];
    }),
  });
  const metrics = [
    measure('volume', t('progress.volume'), formatTonnage, (h) => sessionVolumeG(h.sets, types), true, weightScale()),
    measure('reps', t('progress.totalReps'), (v) => t('unit.reps', { count: v }), (h) => h.sets.filter((l) => l.kind !== 'warmup').reduce((n, l) => n + (l.reps ?? 0), 0)),
    // A longer session is not better: no record for the duration.
    measure('duration', t('progress.duration'), formatMinutes, (h) => sessionDurationMs(h.session), false),
  ].filter((m) => m.rows.length > 0);

  return (
    <section className="stack">
      <h2 className="label">{t('progress.history')}</h2>
      <ProgressPanel name={name} metrics={metrics} />
    </section>
  );
}
