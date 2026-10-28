import type { LocalExercise, LocalWorkoutItem, HalkoDb } from '../src/db/db.ts';
import { liveItems, newItem, saveWorkout } from '../src/db/workouts.ts';
import { toggleSuperset } from '../src/lib/workoutDraft.ts';

// The edits of the workout page, each one saved at once, to set up a workout in a test.
async function edit(db: HalkoDb, workoutId: string, change: (items: LocalWorkoutItem[]) => LocalWorkoutItem[] | Promise<LocalWorkoutItem[]>) {
  const workout = (await db.workouts.get(workoutId))!;
  await saveWorkout(workoutId, workout.name, await change(await liveItems(db, workoutId)), db);
}

export const addItem = (workoutId: string, exercise: LocalExercise, db: HalkoDb) =>
  edit(db, workoutId, async (items) => [...items, await newItem(workoutId, exercise, db)]);

export async function updateItem(id: string, patch: Partial<Pick<LocalWorkoutItem, 'targets' | 'note' | 'mode' | 'switchS' | 'bySide'>>, db: HalkoDb) {
  const { workoutId } = (await db.workoutItems.get(id))!;
  await edit(db, workoutId, (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

export const toggleSupersetWithNext = (item: LocalWorkoutItem, db: HalkoDb) =>
  edit(db, item.workoutId, (items) => toggleSuperset(items, items.findIndex((i) => i.id === item.id)));
