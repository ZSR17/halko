import type { ExerciseType } from '@halko/shared';
import { distanceScale, distanceText, formatDuration, roundWeight, weightScale, weightText, weightUnit } from './format.ts';
import { type SetValues, estimate1RM, setVolumeG } from './session.ts';
import { t } from './i18n.ts';

type Log = SetValues & { kind: string };

interface ProgressMetric {
  id: string;
  label: string;
  format: (v: number) => string;
  // Stored units (grams, metres) in one unit shown, so the chart's axis steps are round in that unit.
  scale?: number;
  // Best value of one session's sets, undefined when the session has none.
  best: (sets: Log[]) => number | undefined;
  higherIsBetter: boolean;
}

const working = (sets: Log[]) => sets.filter((s) => s.kind !== 'warmup');
const max = (values: (number | undefined)[]) => {
  const v = values.filter((x): x is number => x !== undefined && x > 0);
  return v.length ? Math.max(...v) : undefined;
};
const min = (values: (number | undefined)[]) => {
  const v = values.filter((x): x is number => x !== undefined && x > 0);
  return v.length ? Math.min(...v) : undefined;
};

const kg = weightText;
// Volumes to the whole pound: hundredths of a pound summed over sets are noise.
const volume = (g: number) => (weightUnit() === 'lb' ? weightText(roundWeight(g, 1)) : kg(g));
const km = distanceText;
const reps = (n: number) => t('unit.reps', { count: n });

export function metricsForType(type: ExerciseType): ProgressMetric[] {
  const maxWeight = (label: string): ProgressMetric => ({
    id: 'weight',
    label,
    format: kg,
    scale: weightScale(),
    best: (s) => max(working(s).map((x) => x.weightG)),
    higherIsBetter: true,
  });
  switch (type) {
    case 'weight_reps':
      return [
        maxWeight(t('progress.maxWeight')),
        {
          id: 'volume',
          label: t('progress.sessionVolume'),
          format: volume,
          scale: weightScale(),
          best: (s) => {
            const v = working(s).reduce((n, x) => n + setVolumeG(type, x), 0);
            return v > 0 ? v : undefined;
          },
          higherIsBetter: true,
        },
        {
          id: 'set-volume',
          label: t('progress.setVolume'),
          format: volume,
          scale: weightScale(),
          best: (s) => max(working(s).map((x) => setVolumeG(type, x))),
          higherIsBetter: true,
        },
        {
          id: 'total-reps',
          label: t('progress.totalReps'),
          format: reps,
          best: (s) => {
            const n = working(s).reduce((sum, x) => sum + (x.reps ?? 0), 0);
            return n > 0 ? n : undefined;
          },
          higherIsBetter: true,
        },
        {
          id: '1rm',
          label: t('progress.oneRm'),
          format: kg,
          scale: weightScale(),
          best: (s) => max(working(s).map((x) => (x.weightG && x.reps ? estimate1RM(x.weightG, x.reps) : undefined))),
          higherIsBetter: true,
        },
      ];
    case 'bw_reps':
      return [{ id: 'reps', label: t('progress.maxReps'), format: reps, best: (s) => max(working(s).map((x) => x.reps)), higherIsBetter: true }];
    case 'weighted_bw':
      return [maxWeight(t('progress.maxAdded'))];
    case 'assisted_bw':
      return [{ id: 'assist', label: t('progress.minAssist'), format: kg, scale: weightScale(), best: (s) => min(working(s).map((x) => x.weightG)), higherIsBetter: false }];
    case 'duration':
      return [{ id: 'duration', label: t('progress.bestTime'), format: formatDuration, best: (s) => max(working(s).map((x) => x.durationS)), higherIsBetter: true }];
    case 'duration_weight':
      return [maxWeight(t('progress.maxWeight'))];
    case 'distance_duration':
      return [{ id: 'distance', label: t('progress.maxDistance'), format: km, scale: distanceScale(), best: (s) => max(working(s).map((x) => x.distanceM)), higherIsBetter: true }];
    case 'weight_distance':
      return [maxWeight(t('progress.maxWeight'))];
  }
}

function isBetter(metric: ProgressMetric, value: number, previousBest: number | undefined): boolean {
  if (previousBest === undefined) return false; // first time is not a "record"
  return metric.higherIsBetter ? value > previousBest : value < previousBest;
}

// Value of `metric` that this session beat, if it set a record against all earlier sessions.
export function recordFor(metric: ProgressMetric, earlier: Log[][], current: Log[]): { value: number; previous: number } | null {
  const value = metric.best(current);
  if (value === undefined) return null;
  const bests = earlier.map(metric.best).filter((v): v is number => v !== undefined);
  if (!bests.length) return null;
  const previous = metric.higherIsBetter ? Math.max(...bests) : Math.min(...bests);
  return isBetter(metric, value, previous) ? { value, previous } : null;
}
