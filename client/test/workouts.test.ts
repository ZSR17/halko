import { beforeEach, describe, expect, it } from 'vitest';
import { type LocalExercise, type LocalWorkoutItem, HalkoDb } from '../src/db/db.ts';
import { createWorkout, deleteWorkout, duplicateWorkout, liveItems, newItem, saveWorkout, supersetLabels } from '../src/db/workouts.ts';
import { moveItem, removeItemAt, toggleSuperset, withMode } from '../src/lib/workoutDraft.ts';
import { addItem } from './workout-helpers.ts';
import { createFolder, deleteFolder, moveToFolder, reorderHome, saveFolder } from '../src/db/folders.ts';
import { collectChanges } from '../src/sync/engine.ts';

let db: HalkoDb;
let n = 0;

function exercise(name: string, exerciseType: LocalExercise['exerciseType'] = 'weight_reps'): LocalExercise {
  return {
    id: `ex-${name}`,
    source: 'builtin',
    name,
    sport: 'strength',
    exerciseType,
    category: 'strength',
    level: null,
    equipment: [],
    primaryMuscles: [],
    secondaryMuscles: [],
    instructions: [],
    mediaIds: [],
    mediaUrls: [],
    sourceRef: null,
    unilateral: false,
    customized: false,
    createdAt: 0,
    deleted: 0,
    dirty: 0,
    updatedAt: 0,
  };
}

async function workoutWith(names: string[]) {
  const id = await createWorkout('Legs', db);
  for (const name of names) await addItem(id, exercise(name), db);
  return id;
}

const groups = (items: LocalWorkoutItem[]) => items.map((i) => i.supersetGroup);

beforeEach(() => {
  db = new HalkoDb(`test-${n++}`);
});

describe('workouts', () => {
  it('adds items with defaults for the exercise type and marks rows dirty', async () => {
    const id = await createWorkout('Legs', db);
    await addItem(id, exercise('Plank', 'duration'), db);
    const [item] = await liveItems(db, id);
    expect(item).toMatchObject({ mode: 'simple', position: 0, dirty: 1, deleted: 0 });
    expect(item!.targets[0]).toMatchObject({ durationS: 30 });
  });

  it('links and unlinks supersets', async () => {
    let items = await liveItems(db, await workoutWith(['A', 'B', 'C']));
    items = toggleSuperset(items, 0);
    const g = groups(items);
    expect(g[0]).toBeTruthy();
    expect(g[0]).toBe(g[1]);
    expect(g[2]).toBeNull();

    // Extending the superset to a third exercise.
    items = toggleSuperset(items, 1);
    expect(new Set(groups(items)).size).toBe(1);
    expect(supersetLabels(items).get(items[0]!.supersetGroup!)).toBe('A');

    // Unlinking in the middle leaves a valid 2-item superset and an ungrouped item.
    items = toggleSuperset(items, 1);
    const g4 = groups(items);
    expect(g4[0]).toBe(g4[1]);
    expect(g4[2]).toBeNull();
  });

  it('cleans up supersets broken by a move or a removal', async () => {
    let items = toggleSuperset(await liveItems(db, await workoutWith(['A', 'B', 'C'])), 0);
    // Move C between A and B: the superset is split into singletons, which get ungrouped.
    expect(groups(moveItem(items, 2, 1))).toEqual([null, null, null]);

    items = toggleSuperset(items, 0);
    expect(groups(removeItemAt(items, 1))).toEqual([null, null]);
  });

  it('saves an edited workout at once, writing only what changed', async () => {
    const id = await workoutWith(['A', 'B', 'C']);
    const before = await liveItems(db, id);
    const [a, b, c] = before;
    const edited = [withMode(c!, 'per_set'), a!, await newItem(id, exercise('D'), db)];
    await saveWorkout(id, '  Legs v2 ', edited, db);

    const after = await liveItems(db, id);
    expect(after.map((i) => i.exerciseId)).toEqual(['ex-C', 'ex-A', 'ex-D']);
    expect(after.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(after[0]!.mode).toBe('per_set');
    expect((await db.workoutItems.get(b!.id))!.deleted).toBe(1);
    expect((await db.workouts.get(id))!.name).toBe('Legs v2');

    // Saving the same list again writes nothing.
    const stamps = after.map((i) => i.updatedAt);
    await saveWorkout(id, 'Legs v2', after, db);
    expect((await liveItems(db, id)).map((i) => i.updatedAt)).toEqual(stamps);
  });

  it('duplicates and deletes workouts', async () => {
    const id = await workoutWith(['A', 'B']);
    await saveWorkout(id, 'Legs', toggleSuperset(await liveItems(db, id), 0), db);
    const items = await liveItems(db, id);

    const copy = await duplicateWorkout(id, db);
    const copied = await liveItems(db, copy);
    expect(copied).toHaveLength(2);
    expect(copied[0]!.supersetGroup).toBe(copied[1]!.supersetGroup);
    expect(copied[0]!.supersetGroup).not.toBe(items[0]!.supersetGroup);

    await deleteWorkout(id, db);
    expect((await db.workouts.get(id))!.deleted).toBe(1);
    expect(await liveItems(db, id)).toEqual([]);
  });
});

describe('folders', () => {
  it('sorts workouts into folders, in one order with them, and keeps them when a folder is deleted', async () => {
    const legs = await createWorkout('Legs', db);
    const folder = await createFolder('  Strength ', db);
    expect(await db.folders.get(folder)).toMatchObject({ name: 'Strength', position: 1, dirty: 1 });
    const push = await createWorkout('Push', db);
    expect((await db.workouts.get(push))!.position).toBe(2);
    // The workouts page: folders and the workouts in none share one order.
    await reorderHome([push, `folder:${folder}`, legs], db);
    expect([(await db.workouts.get(push))!.position, (await db.folders.get(folder))!.position, (await db.workouts.get(legs))!.position]).toEqual([0, 1, 2]);

    await moveToFolder(legs, folder, db);
    const inside = await createWorkout('Pull', db, folder);
    expect((await db.workouts.get(legs))!.folderId).toBe(folder);
    // A copy stays in the same folder.
    expect((await db.workouts.get(await duplicateWorkout(inside, db)))!.folderId).toBe(folder);

    // Edited: renamed, and a workout taken out (back last on the workouts page).
    await saveFolder(folder, 'Force', [legs], db);
    expect((await db.folders.get(folder))!.name).toBe('Force');
    expect(await db.workouts.get(legs)).toMatchObject({ folderId: null, position: 5 });

    await deleteFolder(folder, db);
    expect((await db.folders.get(folder))!.deleted).toBe(1);
    const workouts = await db.workouts.toArray();
    expect(workouts.filter((w) => !w.deleted)).toHaveLength(4);
    expect(workouts.every((w) => (w.folderId ?? null) === null && w.dirty === 1)).toBe(true);

    // Pushed before the workouts pointing at them.
    const { changes } = await collectChanges(db);
    expect(Object.keys(changes).indexOf('folders')).toBeLessThan(Object.keys(changes).indexOf('workouts'));
    expect(changes.folders![0]).toMatchObject({ id: folder, name: 'Force', deleted: true });
  });
});
