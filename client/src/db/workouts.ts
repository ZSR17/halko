import type { SetTarget } from '@halko/shared';
import { type ItemMode, defaultTargets, doneSets, doneValues, rankKey, withDone } from '../lib/targets.ts';
import { type LocalExercise, type LocalWorkoutItem, type HalkoDb, db as defaultDb } from './db.ts';
import { nextPosition } from './folders.ts';
import { exerciseHistory } from './sessions.ts';
import { t as text } from '../lib/i18n.ts';
import { newId } from '../lib/id.ts';

const now = () => Date.now();
const touched = () => ({ updatedAt: now(), dirty: 1 as const });

export async function liveItems(db: HalkoDb, workoutId: string): Promise<LocalWorkoutItem[]> {
  const items = await db.workoutItems.where('workoutId').equals(workoutId).toArray();
  return items.filter((i) => !i.deleted).sort((a, b) => a.position - b.position);
}

// A new workout, at the end of the list; in `folderId` if given.
export async function createWorkout(name: string, db: HalkoDb = defaultDb, folderId: string | null = null): Promise<string> {
  const id = newId();
  const position = await nextPosition(db);
  const t = now();
  await db.workouts.add({
    id,
    sport: 'strength',
    name: name.trim() || text('workout.newName'),
    folderId,
    note: null,
    position,
    createdAt: t,
    updatedAt: t,
    deleted: 0,
    dirty: 1,
  });
  return id;
}

export async function deleteWorkout(id: string, db: HalkoDb = defaultDb) {
  await db.transaction('rw', db.workouts, db.workoutItems, async () => {
    await db.workouts.update(id, { deleted: 1, ...touched() });
    await db.workoutItems.where('workoutId').equals(id).modify({ deleted: 1, ...touched() });
  });
}

export async function duplicateWorkout(id: string, db: HalkoDb = defaultDb): Promise<string> {
  const source = await db.workouts.get(id);
  if (!source) throw new Error('workout not found');
  const copyId = await createWorkout(text('workout.copyName', { name: source.name }), db, source.folderId);
  const groups = new Map<string, string>();
  const items = await liveItems(db, id);
  const t = now();
  await db.workoutItems.bulkAdd(
    items.map((i) => ({
      ...i,
      id: newId(),
      workoutId: copyId,
      supersetGroup: i.supersetGroup
        ? (groups.get(i.supersetGroup) ?? groups.set(i.supersetGroup, newId()).get(i.supersetGroup)!)
        : null,
      createdAt: t,
      updatedAt: t,
      dirty: 1,
    })),
  );
  return copyId;
}

// A newly added exercise starts from what is known of it: the plan of another workout using it (sets,
// warm-ups, rests) with the values of the last time it was done; else the sets done last time; else
// the defaults of its type.
async function startingPlan(exercise: LocalExercise, db: HalkoDb): Promise<{ mode: ItemMode; targets: SetTarget[] }> {
  const others = (await db.workoutItems.where('exerciseId').equals(exercise.id).toArray())
    .filter((i) => !i.deleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  let base: LocalWorkoutItem | undefined;
  for (const item of others) {
    if ((await db.workouts.get(item.workoutId))?.deleted === 0) {
      base = item;
      break;
    }
  }
  const history = await exerciseHistory(exercise.id, db);
  const last = history[history.length - 1]?.sets ?? [];
  if (base) return withDone(base.targets, base.mode, doneSets(last.map((l, i) => ({ key: rankKey(last, i), set: l }))));
  if (last.length) {
    const restS = defaultTargets(exercise.exerciseType)[0]!.restS;
    const targets = last.map((l) => ({ kind: l.kind, ...doneValues(l), restS }));
    const identical = targets.every((t) => t.kind === 'normal' && JSON.stringify(t) === JSON.stringify(targets[0]));
    return { mode: identical ? 'simple' : 'per_set', targets };
  }
  return { mode: 'simple', targets: defaultTargets(exercise.exerciseType) };
}

// A new item for `exercise`, not saved yet (added to a workout being edited).
export async function newItem(workoutId: string, exercise: LocalExercise, db: HalkoDb = defaultDb): Promise<LocalWorkoutItem> {
  const { mode, targets } = await startingPlan(exercise, db);
  const t = now();
  return {
    id: newId(),
    workoutId,
    exerciseId: exercise.id,
    position: 0,
    mode,
    supersetGroup: null,
    targets,
    bySide: null,
    switchS: null,
    note: null,
    createdAt: t,
    updatedAt: t,
    deleted: 0,
    dirty: 1,
  };
}

const sameItem = (a: LocalWorkoutItem, b: LocalWorkoutItem) =>
  a.position === b.position &&
  a.mode === b.mode &&
  a.supersetGroup === b.supersetGroup &&
  a.note === b.note &&
  a.bySide === b.bySide &&
  a.switchS === b.switchS &&
  JSON.stringify(a.targets) === JSON.stringify(b.targets);

// Saves an edited workout at once: its name and its items in this order. Items no longer listed are
// deleted; only rows that changed are written (and synced).
export async function saveWorkout(id: string, name: string, items: LocalWorkoutItem[], db: HalkoDb = defaultDb) {
  await db.transaction('rw', db.workouts, db.workoutItems, async () => {
    const workout = await db.workouts.get(id);
    if (!workout) return;
    const saved = new Map((await liveItems(db, id)).map((i) => [i.id, i]));
    let changed = false;
    for (const old of saved.values()) {
      if (items.some((i) => i.id === old.id)) continue;
      await db.workoutItems.update(old.id, { deleted: 1, ...touched() });
      changed = true;
    }
    for (const [position, item] of items.entries()) {
      const row = { ...item, workoutId: id, position };
      const old = saved.get(item.id);
      if (old && sameItem(old, row)) continue;
      await db.workoutItems.put({ ...row, ...touched() });
      changed = true;
    }
    const trimmed = name.trim() || workout.name;
    if (changed || trimmed !== workout.name) await db.workouts.update(id, { name: trimmed, ...touched() });
  });
}

// Rewrites positions so the list of workouts matches `orderedIds`.
export async function reorderWorkouts(orderedIds: string[], db: HalkoDb = defaultDb) {
  await db.transaction('rw', db.workouts, async () => {
    for (const [position, id] of orderedIds.entries()) await db.workouts.update(id, { position, ...touched() });
  });
}

// "A", "B"… per superset in order of appearance, for display.
export function supersetLabels(items: LocalWorkoutItem[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const i of items) {
    if (i.supersetGroup && !labels.has(i.supersetGroup)) {
      labels.set(i.supersetGroup, String.fromCharCode(65 + labels.size));
    }
  }
  return labels;
}
