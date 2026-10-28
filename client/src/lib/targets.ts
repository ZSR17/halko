import { EXERCISE_TYPES, type ExerciseType, type Metric, type SetTarget } from '@halko/shared';
import { distanceUnit, formatDist, formatDuration, formatWeight, niceWeight, parseCount, parseDist, parseDuration, parseWeight, roundWeight, weightUnit } from './format.ts';
import { defaultBar, plateSettings } from './plates.ts';
import { t } from './i18n.ts';

export type ItemMode = 'simple' | 'per_set';

const DEFAULTS: Record<ExerciseType, { sets: number; target: Omit<SetTarget, 'kind'> }> = {
  weight_reps: { sets: 3, target: { reps: 10, weightG: 20000, restS: 90 } },
  bw_reps: { sets: 3, target: { reps: 10, restS: 90 } },
  weighted_bw: { sets: 3, target: { reps: 8, weightG: 5000, restS: 90 } },
  assisted_bw: { sets: 3, target: { reps: 8, weightG: 20000, restS: 90 } },
  duration: { sets: 3, target: { durationS: 30, restS: 60 } },
  duration_weight: { sets: 3, target: { durationS: 30, weightG: 10000, restS: 60 } },
  distance_duration: { sets: 1, target: { durationS: 1200, distanceM: 5000, restS: 0 } },
  weight_distance: { sets: 3, target: { weightG: 24000, distanceM: 40, restS: 90 } },
};

export function defaultTargets(type: ExerciseType): SetTarget[] {
  const { sets, target } = DEFAULTS[type];
  const weightG = target.weightG && niceWeight(target.weightG);
  return Array.from({ length: sets }, () => ({ kind: 'normal' as const, ...target, ...(weightG && { weightG }) }));
}

export const formatCount = (v: number | undefined) => (v === undefined ? '' : String(v));

// How each metric maps onto a set's field, and how it is shown / typed (`numeric`: no decimal point).
export const METRIC_IO: Record<
  Metric,
  { key: 'reps' | 'weightG' | 'durationS' | 'distanceM'; format: (v: number | undefined) => string; parse: (s: string) => number | null; numeric: boolean }
> = {
  reps: { key: 'reps', format: formatCount, parse: parseCount, numeric: true },
  weight: { key: 'weightG', format: formatWeight, parse: parseWeight, numeric: false },
  duration: { key: 'durationS', format: formatDuration, parse: parseDuration, numeric: true },
  distance: { key: 'distanceM', format: formatDist, parse: parseDist, numeric: false },
};

export function metricsFor(type: ExerciseType): readonly Metric[] {
  return EXERCISE_TYPES[type].metrics;
}

// `perSide`: a set done one side at a time, whose reps, time and distance are per side (not its weight).
export function metricLabel(metric: Metric, type: ExerciseType, perSide = false): string {
  const capital = (unit: string) => unit.charAt(0).toUpperCase() + unit.slice(1);
  if (metric === 'weight') return (type === 'weighted_bw' ? '+' : type === 'assisted_bw' ? '−' : '') + capital(weightUnit());
  const label = { reps: t('metric.reps'), duration: t('metric.duration'), distance: capital(distanceUnit()) }[metric];
  return perSide ? t('metric.perSide', { label }) : label;
}

export function metricLongLabel(metric: Metric, type: ExerciseType): string {
  return metric === 'reps' ? t('metric.repsLong') : metricLabel(metric, type);
}

// Simple mode = N identical working sets. Leaving per-set mode keeps the first working set as the model.
export function toSimple(targets: SetTarget[]): SetTarget[] {
  const working = targets.filter((t) => t.kind !== 'warmup');
  const model = working[0] ?? targets[0];
  if (!model) return [];
  return Array.from({ length: Math.max(1, working.length) }, () => ({ ...model, kind: 'normal' as const }));
}

export function setSimpleCount(targets: SetTarget[], count: number): SetTarget[] {
  const model = targets[0];
  if (!model || count < 1) return targets;
  return Array.from({ length: count }, () => ({ ...model }));
}

// In simple mode a field edit applies to every set.
export function updateAll(targets: SetTarget[], patch: Partial<SetTarget>): SetTarget[] {
  return targets.map((t) => ({ ...t, ...patch }));
}

export function updateOne(targets: SetTarget[], index: number, patch: Partial<SetTarget>): SetTarget[] {
  return targets.map((t, i) => (i === index ? { ...t, ...patch } : t));
}

// A value typed on set `index`, as in a session: when it goes up (from `from`, the value it showed), the
// next sets below it are brought up to it. A decrease stays on that set, and a warm-up value left to work
// out stays so.
export function updateFrom(targets: SetTarget[], index: number, key: keyof Values, value: number, from: number | undefined): SetTarget[] {
  const up = from !== undefined && value > from;
  return targets.map((t, i) => {
    if (i === index) return { ...t, [key]: value };
    const current = t[key];
    return up && i > index && current !== undefined && current < value ? { ...t, [key]: value } : t;
  });
}

export function addSet(targets: SetTarget[], type: ExerciseType): SetTarget[] {
  const last = targets[targets.length - 1];
  return [...targets, last ? { ...last, kind: 'normal' } : defaultTargets(type)[0]!];
}

type Values = Pick<SetTarget, 'reps' | 'weightG' | 'durationS' | 'distanceM'>;

// Values done in a set, without the empty ones.
export function doneValues(set: Values): Values {
  return Object.fromEntries((['reps', 'weightG', 'durationS', 'distanceM'] as const).filter((k) => set[k] != null).map((k) => [k, set[k]]));
}

// Sets are matched across workouts by their rank among warm-ups or among working sets ("2nd working
// set"), since two workouts may plan a different number of warm-ups for the same exercise.
export function rankKey(sets: Pick<SetTarget, 'kind'>[], index: number): string {
  const warmup = sets[index]!.kind === 'warmup';
  return `${warmup}:${sets.slice(0, index).filter((t) => (t.kind === 'warmup') === warmup).length}`;
}

// What was done for an exercise: values by rankKey, and whether all working sets were done the same
// way (then `model` holds those values). `sets` in set order, each with its rankKey in the plan it
// was done from.
export interface DoneSets {
  values: Map<string, Values>;
  model: Values | undefined;
}

export function doneSets(sets: { key: string; set: Pick<SetTarget, 'kind'> & Values }[]): DoneSets {
  const working = sets.filter((s) => s.set.kind !== 'warmup').map((s) => JSON.stringify(doneValues(s.set)));
  return {
    values: new Map(sets.map((s) => [s.key, doneValues(s.set)])),
    model: working.length && working.every((w) => w === working[0]) ? JSON.parse(working[0]!) : undefined,
  };
}

// A plan with the values done; only planned sets change (extra sets are not added). Identical sets
// (simple mode) stay identical when every working set was done the same way; otherwise they become
// per-set so each one keeps what was done.
export function withDone(targets: SetTarget[], mode: ItemMode, done: DoneSets): { mode: ItemMode; targets: SetTarget[] } {
  if (mode === 'simple' && done.model) return { mode, targets: updateAll(targets, done.model) };
  if (mode === 'simple' && done.values.size === 0) return { mode, targets };
  return {
    mode: 'per_set',
    targets: targets.map((t, i) => {
      const values = done.values.get(rankKey(targets, i));
      if (!values) return t;
      // A warm-up worked out from the working sets stays so.
      const { weightG, reps, ...rest } = values;
      if (t.kind !== 'warmup') return { ...t, ...values };
      return { ...t, ...rest, ...(t.weightG !== undefined && weightG !== undefined && { weightG }), ...(t.reps !== undefined && reps !== undefined && { reps }) };
    }),
  };
}

// Warm-ups follow the working sets: a warm-up without weight (or reps) has it worked out from the first
// working set; one typed in is kept. Ramp from the empty bar (barbell exercises) or 40 %, in even steps up
// to 85 % of the working weight, reps going down (10 first, then 5 up to 60 %, 3 up to 75 %, 2 above): a
// last warm-up near 80-90 % helps the working sets, few reps keep it from tiring (Ribeiro et al. 2020 and
// 2021; Starting Strength, Barbell Medicine).
const WARMUP_WEIGHT = new Set<ExerciseType>(['weight_reps', 'duration_weight', 'weight_distance']);

export function warmupPlan(count: number, workingG: number, barG: number | null): { weightG: number; reps: number }[] {
  const lb = weightUnit() === 'lb';
  // To the smallest pair of plates on a bar, else to the dumbbell or machine step.
  const step = barG !== null ? (lb ? 5 : 2.5) : lb ? 2.5 : 1;
  const top = 0.85 * workingG;
  const bottom = barG ?? 0.4 * workingG;
  const raw = count === 1 ? [0.6 * workingG] : Array.from({ length: count }, (_, i) => bottom + ((top - bottom) * i) / (count - 1));
  return raw.map((g, i) => {
    const weightG = Math.min(workingG, Math.max(barG ?? 0, roundWeight(g, step)));
    return { weightG, reps: warmupReps(i, count, weightG, workingG) };
  });
}

// Reps of warm-up `index` of `count` with `weightG`: 10 for the first, then fewer as it gets heavier.
const warmupReps = (index: number, count: number, weightG: number, workingG: number) => {
  const share = weightG / workingG;
  return index === 0 && count > 1 ? 10 : share <= 0.6 ? 5 : share <= 0.75 ? 3 : 2;
};

// `targets` with the warm-up values left to work out filled in, from `working` (the first working set,
// or the values proposed for it today).
export function withWarmups(
  targets: SetTarget[],
  exercise: { exerciseType: ExerciseType; equipment: readonly string[] },
  working: Values | undefined = targets.find((t) => t.kind !== 'warmup'),
): SetTarget[] {
  const count = targets.filter((t) => t.kind === 'warmup').length;
  if (!count || !working?.weightG || !WARMUP_WEIGHT.has(exercise.exerciseType)) return targets;
  const bar = exercise.equipment.includes('barbell') ? (plateSettings.get().barG ?? defaultBar()) : null;
  const plan = warmupPlan(count, working.weightG, bar);
  let w = 0;
  return targets.map((t) => {
    if (t.kind !== 'warmup') return t;
    const index = w++;
    const weightG = t.weightG ?? plan[index]!.weightG;
    // Reps go with the weight lifted, typed in or not.
    return { ...t, weightG, ...(exercise.exerciseType === 'weight_reps' && { reps: t.reps ?? warmupReps(index, count, weightG, working.weightG!) }) };
  });
}

// Whether a warm-up value is worked out (not typed in).
export const isAutoWarmup = (target: SetTarget, key: 'weightG' | 'reps', type: ExerciseType) =>
  target.kind === 'warmup' && target[key] === undefined && WARMUP_WEIGHT.has(type) && (key === 'weightG' || type === 'weight_reps');

// Set `index` made a warm-up (its values left to work out from the working sets) or a working set (with
// the values it showed). `shown`: the sets as shown (withWarmups).
export function toKind(targets: SetTarget[], shown: SetTarget[], index: number, kind: SetTarget['kind'], type: ExerciseType): SetTarget[] {
  if (kind !== 'warmup') return updateOne(targets, index, { ...shown[index], kind });
  return targets.map((t, i) => (i === index ? autoWarmup({ ...t, kind }, type) : t));
}

// A warm-up with the values that can be worked out left to work out.
function autoWarmup(set: SetTarget, type: ExerciseType): SetTarget {
  const out = { ...set };
  if (WARMUP_WEIGHT.has(type)) delete out.weightG;
  if (type === 'weight_reps') delete out.reps;
  return out;
}

export function removeSet(targets: SetTarget[], index: number): SetTarget[] {
  return targets.length <= 1 ? targets : targets.filter((_, i) => i !== index);
}
