import type { ExerciseType, SetTarget } from '@halko/shared';
import type { LocalExercise, LocalWorkoutItem } from '../db/db.ts';
import { withWarmups } from './targets.ts';

// Snapshot of a workout item taken when the session starts, so editing the workout
// mid-session does not move the ground under the user.
export interface PlanItem {
  itemId: string;
  exerciseId: string;
  exerciseType: ExerciseType;
  // Its equipment (a barbell exercise warms up from the empty bar).
  equipment: string[];
  supersetGroup: string | null;
  targets: SetTarget[];
  // Done one side then the other within each set, and the seconds to change sides in a timed set.
  unilateral?: boolean;
  switchS?: number | null;
  note: string | null;
}

export interface Step {
  item: number;
  set: number;
  target: SetTarget;
}

export type SetValues = Pick<SetTarget, 'reps' | 'weightG' | 'durationS' | 'distanceM'>;

// Whether the sets of an item are done one side then the other: an exercise working one side at a time,
// unless the workout does it as a plain set.
export function doneBySide(exercise: Pick<LocalExercise, 'unilateral'> | undefined, item: Pick<LocalWorkoutItem, 'bySide'>): boolean {
  return !!exercise?.unilateral && item.bySide !== false;
}

// Planned sets, plus those added (or minus those removed) during the session.
export function setCount(plan: PlanItem[], extra: Record<string, number>, item: number): number {
  const p = plan[item]!;
  return p.targets.length + (extra[p.itemId] ?? 0);
}

export function targetFor(plan: PlanItem[], item: number, set: number): SetTarget {
  const targets = plan[item]!.targets;
  const last = targets[targets.length - 1]!;
  return targets[set] ?? { ...last, kind: 'normal' };
}

// Execution order. Items of a superset are interleaved round by round (A1 B1 A2 B2…);
// an item with more sets than its partners finishes its extra sets alone.
export function buildSteps(plan: PlanItem[], extra: Record<string, number> = {}): Step[] {
  const steps: Step[] = [];
  for (let start = 0; start < plan.length; ) {
    const group = plan[start]!.supersetGroup;
    let end = start;
    while (group && plan[end + 1]?.supersetGroup === group) end++;
    const counts = Array.from({ length: end - start + 1 }, (_, k) => setCount(plan, extra, start + k));
    for (let round = 0; round < Math.max(...counts); round++) {
      for (let item = start; item <= end; item++) {
        if (round < counts[item - start]!) steps.push({ item, set: round, target: targetFor(plan, item, round) });
      }
    }
    start = end + 1;
  }
  return steps;
}

// No rest between exercises of the same superset round; otherwise the set's planned rest.
export function restAfter(plan: PlanItem[], steps: Step[], index: number): number {
  const cur = steps[index];
  const next = steps[index + 1];
  if (!cur || !next) return 0;
  const group = plan[cur.item]!.supersetGroup;
  if (group && plan[next.item]!.supersetGroup === group && next.set === cur.set && next.item > cur.item) return 0;
  return cur.target.restS ?? 90;
}

// Set number as shown to the user: warm-up sets are not counted, extra sets continue the count.
export function workingNumber(item: PlanItem, set: number): number {
  return item.targets.slice(0, set + 1).filter((t) => t.kind !== 'warmup').length + Math.max(0, set + 1 - item.targets.length);
}

export function stepKey(plan: PlanItem[], step: Step): string {
  return `${plan[step.item]!.itemId}:${step.set}`;
}

// First step after `from` (wrapping around) that is not done yet; -1 when everything is done.
export function nextOpenStep(plan: PlanItem[], steps: Step[], done: Set<string>, from: number): number {
  for (let k = 1; k <= steps.length; k++) {
    const i = (from + k) % steps.length;
    if (!done.has(stepKey(plan, steps[i]!))) return i;
  }
  return -1;
}

// Values the inputs start with: the plan, which takes what was done at the end of each session, so it
// holds last time's values unless changed in the workout since (a load raised or lowered there is taken).
// What the plan leaves to work out (warm-ups) starts from last time.
export function prefill(target: SetTarget, previous: SetValues | undefined): SetValues {
  return {
    reps: target.reps ?? previous?.reps,
    weightG: target.weightG ?? previous?.weightG,
    durationS: target.durationS ?? previous?.durationS,
    distanceM: target.distanceM ?? previous?.distanceM,
  };
}

// What a set starts with: last time's values (else the plan), raised to what earlier sets of the session
// reached (`bumps`). A warm-up left to work out (no value typed in the plan) is worked out from the
// working weight of today when there is no last time, or when that weight is above last time's;
// otherwise it starts like the others, from last time.
export function proposedValues(
  plan: PlanItem[],
  item: number,
  set: number,
  previous: Map<number, SetValues> | undefined,
  bumps: Record<string, SetValues> | undefined,
): SetValues {
  const p = plan[item]!;
  const start = (s: number) => raised(prefill(targetFor(plan, item, s), previous?.get(s)), bumps?.[`${p.itemId}:${s}`]);
  const target = targetFor(plan, item, set);
  const working = p.targets.findIndex((t) => t.kind !== 'warmup');
  if (target.kind !== 'warmup' || working < 0) return start(set);
  const today = start(working);
  const lastTime = previous?.get(working)?.weightG;
  const heavier = today.weightG !== undefined && lastTime !== undefined && today.weightG > lastTime;
  if (previous?.has(set) && !heavier) return start(set);
  const auto = withWarmups(p.targets, { exerciseType: p.exerciseType, equipment: p.equipment }, today)[set]!;
  const values = { ...start(set) };
  if (target.weightG === undefined && auto.weightG !== undefined) values.weightG = auto.weightG;
  if (target.reps === undefined && auto.reps !== undefined) values.reps = auto.reps;
  return raised(values, bumps?.[`${p.itemId}:${set}`]);
}

const VALUE_KEYS = ['reps', 'weightG', 'durationS', 'distanceM'] as const;

// The values of `done` above those of `from`, field by field: what the next sets of the exercise must
// reach (15 reps done instead of 11 brings a next set of 10 to 15). Decreases are ignored: a set missed
// out of fatigue must not lower the next ones.
export function increase(done: SetValues, from: SetValues): SetValues {
  const result: SetValues = {};
  for (const k of VALUE_KEYS) {
    const value = done[k];
    if (value !== undefined && from[k] !== undefined && value > from[k]) result[k] = value;
  }
  return result;
}

// `bump` without what `removed` brought (a set whose validation is undone); nothing left gives undefined.
export function lowered(bump: SetValues | undefined, removed: SetValues): SetValues | undefined {
  const result: SetValues = {};
  for (const k of VALUE_KEYS) if (bump?.[k] !== undefined && bump[k] !== removed[k]) result[k] = bump[k];
  return Object.keys(result).length ? result : undefined;
}

// `v` brought up to `bump` (values reached on an earlier set of the session); higher values stay.
export function raised(v: SetValues, bump: SetValues | undefined): SetValues {
  if (!bump) return v;
  const result = { ...v };
  for (const k of VALUE_KEYS) if (bump[k] !== undefined) result[k] = Math.max(v[k] ?? 0, bump[k]);
  return result;
}

// Epley estimate, only meaningful for reasonably low reps.
export function estimate1RM(weightG: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weightG;
  return Math.round(weightG * (1 + Math.min(reps, 12) / 30));
}

// Volume = load moved: weight × reps for loaded exercises, both sides of a set done one side at a time.
export function setVolumeG(type: ExerciseType, v: SetValues & { unilateral?: boolean }): number {
  if (type === 'weight_reps' || type === 'weighted_bw') return (v.weightG ?? 0) * (v.reps ?? 0) * (v.unilateral ? 2 : 1);
  return 0;
}
