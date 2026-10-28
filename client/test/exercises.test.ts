import { beforeEach, describe, expect, it } from 'vitest';
import { HalkoDb, type LocalExercise } from '../src/db/db.ts';
import { createExercise, deleteExercise, updateExercise } from '../src/db/exercises.ts';
import { createWorkout } from '../src/db/workouts.ts';
import { exportData, importData } from '../src/lib/backup.ts';

let db: HalkoDb;
let n = 0;
const builtin: LocalExercise = {
  id: 'squat',
  source: 'builtin',
  name: 'Squat',
  sport: 'strength',
  exerciseType: 'weight_reps',
  category: null,
  level: null,
  equipment: [],
  primaryMuscles: ['quads'],
  secondaryMuscles: [],
  instructions: [],
  mediaIds: [],
  mediaUrls: [],
  sourceRef: null,
  unilateral: false,
  customized: false,
  createdAt: 0,
  updatedAt: 0,
  deleted: 0,
  dirty: 0,
};
const fields = {
  name: '  Bulgarian lunge ',
  exerciseType: 'weight_reps' as const,
  equipment: ['dumbbell'],
  primaryMuscles: ['quads' as const],
  secondaryMuscles: ['glutes' as const],
  instructions: [],
  mediaIds: [],
  mediaUrls: [],
};

beforeEach(async () => {
  db = new HalkoDb(`exercises-${n++}`);
  await db.exercises.add(builtin);
});

describe('exercises', () => {
  it('creates, edits and deletes custom exercises as rows to push', async () => {
    const id = await createExercise(fields, db);
    expect(await db.exercises.get(id)).toMatchObject({ name: 'Bulgarian lunge', source: 'custom', dirty: 1, deleted: 0 });
    await deleteExercise(id, db);
    expect(await db.exercises.get(id)).toMatchObject({ deleted: 1, dirty: 1 });
  });

  it('marks an edited built-in exercise as the user’s version', async () => {
    await updateExercise('squat', { ...fields, name: 'My squat' }, db);
    expect(await db.exercises.get('squat')).toMatchObject({ name: 'My squat', source: 'builtin', customized: true, dirty: 1 });
  });
});

describe('backup', () => {
  it('exports user data and merges it back without overwriting newer rows', async () => {
    const custom = await createExercise(fields, db);
    const w = await createWorkout('Legs', db);
    const backup = JSON.parse(JSON.stringify(await exportData(db)));
    // The untouched library is not exported.
    expect(backup.tables.exercises.map((e: { id: string }) => e.id)).toEqual([custom]);
    expect(backup.tables.workouts[0]).not.toHaveProperty('dirty');

    const other = new HalkoDb(`exercises-${n++}`);
    expect(await importData(backup, other)).toEqual({ imported: 2, skipped: 0 });
    expect(await other.workouts.get(w)).toMatchObject({ name: 'Legs', dirty: 1 });

    await other.workouts.update(w, { name: 'Newer', updatedAt: Date.now() + 1000 });
    expect((await importData(backup, other)).skipped).toBe(2);
    expect((await other.workouts.get(w))!.name).toBe('Newer');

    await expect(importData({ hello: 'world' }, other)).rejects.toThrow('Halko export');
  });
});
