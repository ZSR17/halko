import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextRev } from '../src/db/index.ts';
import { exerciseOverrides, exercises, setLogs, workoutItems } from '../src/db/schema.ts';
import { applyLibraryIds } from '../src/import/library-ids.ts';
import { pullChanges } from '../src/sync.ts';
import { TEST_PASSWORD, makeTestApp } from './helpers.ts';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;
let headers: { authorization: string };
const T = 1_700_000_000_000;

// A library exercise as an earlier version imported it: with a random id.
const squat = {
  id: '0b1c6f3e-5d1a-4c55-9a43-3c2b1f6c8e01',
  userId: null,
  source: 'builtin' as const,
  sourceRef: 'Barbell_Squat',
  name: 'Barbell Squat',
  sport: 'strength' as const,
  exerciseType: 'weight_reps' as const,
  category: 'strength',
  level: 'beginner',
  equipment: ['barbell'],
  primaryMuscles: ['quads' as const],
  secondaryMuscles: ['glutes' as const],
  instructions: ['Squat.'],
  mediaIds: [],
  createdAt: T,
  updatedAt: T,
};
const NEW_ID = 'lib-Barbell_Squat';

const base = { createdAt: T, updatedAt: T, deleted: false };
const workout = { ...base, id: 'w1', folderId: null, sport: 'strength', name: 'Legs', note: null, position: 0 };
const item = (exerciseId: string, over: Record<string, unknown> = {}) => ({
  ...base,
  id: 'i1',
  workoutId: 'w1',
  exerciseId,
  position: 0,
  mode: 'simple',
  supersetGroup: null,
  targets: [{ kind: 'normal', reps: 5 }],
  bySide: null,
  switchS: null,
  note: null,
  ...over,
});
const session = { ...base, id: 's1', workoutId: 'w1', sport: 'strength', name: 'Legs', startedAt: T, endedAt: T + 1, note: null };
const log = (id: string, exerciseId: string) => ({
  ...base,
  id,
  sessionId: 's1',
  exerciseId,
  workoutItemId: 'i1',
  position: 0,
  setIndex: 0,
  kind: 'normal',
  reps: 5,
  weightG: 100_000,
  completedAt: T,
});
const edit = (over: Record<string, unknown> = {}) => ({
  ...squat,
  name: 'My squat',
  unilateral: false,
  deleted: false,
  updatedAt: T + 10,
  ...over,
});

async function sync(since: number, changes: Record<string, unknown[]> = {}) {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/sync', headers, payload: { since, changes } });
  expect(res.statusCode).toBe(200);
  return res.json();
}
const exercise = (id: string) => ctx.db.select().from(exercises).where(eq(exercises.id, id)).get();

beforeEach(async () => {
  ctx = await makeTestApp();
  ctx.db.insert(exercises).values({ ...squat, rev: nextRev(ctx.db) }).run();
  const { token } = (
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { password: TEST_PASSWORD, deviceName: 'A' } })
  ).json();
  headers = { authorization: `Bearer ${token}` };
});
afterEach(async () => {
  await ctx.cleanup();
});

describe('library ids', () => {
  it('moves a library exercise and what points at it to its fixed id, once', async () => {
    await sync(0, { exercises: [edit({ id: squat.id })], workouts: [workout], workoutItems: [item(squat.id)], sessions: [session], setLogs: [log('l1', squat.id), log('l2', squat.id)] });
    const { rev } = await sync(0);

    expect(applyLibraryIds(ctx.db)).toBe(1);
    expect(applyLibraryIds(ctx.db)).toBe(0);

    expect(exercise(NEW_ID)).toMatchObject({ sourceRef: 'Barbell_Squat', name: 'Barbell Squat', deleted: false, replacedBy: null });
    expect(exercise(squat.id)).toMatchObject({ sourceRef: null, deleted: true, replacedBy: NEW_ID });
    expect(ctx.db.select().from(workoutItems).get()!.exerciseId).toBe(NEW_ID);
    expect(ctx.db.select().from(exerciseOverrides).get()!.exerciseId).toBe(NEW_ID);
    // Each moved row has its own revision, and keeps its updatedAt.
    const logs = ctx.db.select().from(setLogs).all();
    expect(logs.map((l) => l.exerciseId)).toEqual([NEW_ID, NEW_ID]);
    expect(new Set(logs.map((l) => l.rev)).size).toBe(2);
    expect(logs.map((l) => l.updatedAt)).toEqual([T, T]);

    // A device that synced before gets the new exercise (with its version), the old one deleted and the moved rows.
    const { changes } = await sync(rev);
    expect(changes.exercises.find((e: { id: string }) => e.id === NEW_ID)).toMatchObject({ name: 'My squat', customized: true });
    expect(changes.exercises.find((e: { id: string }) => e.id === squat.id)).toMatchObject({ deleted: true });
    expect(changes.workoutItems).toMatchObject([{ id: 'i1', exerciseId: NEW_ID }]);
    expect(changes.setLogs).toHaveLength(2);
  });

  it('points the rows a device sends with an old id at the new one', async () => {
    await sync(0, { workouts: [workout], workoutItems: [item(squat.id)], sessions: [session] });
    applyLibraryIds(ctx.db);

    const res = await sync(0, { workoutItems: [item(squat.id, { updatedAt: T + 5 })], setLogs: [log('l1', squat.id)] });
    expect(res.rejected).toEqual([]);
    expect(res.changes.workoutItems).toMatchObject([{ id: 'i1', exerciseId: NEW_ID, updatedAt: T + 5 }]);
    expect(res.changes.setLogs).toMatchObject([{ id: 'l1', exerciseId: NEW_ID }]);
  });

  it('keeps an edit sent with an old id, and sends the old row back deleted', async () => {
    applyLibraryIds(ctx.db);
    const { rev } = await sync(0);
    const later = Date.now() + 60_000;

    const res = await sync(rev, { exercises: [edit({ id: squat.id, updatedAt: later })] });
    expect(res.rejected).toEqual([]);
    expect(res.changes.exercises.find((e: { id: string }) => e.id === NEW_ID)).toMatchObject({ name: 'My squat', customized: true });
    // As recent as the device's version, so that the device applies it.
    expect(res.changes.exercises.find((e: { id: string }) => e.id === squat.id)).toMatchObject({ deleted: true, updatedAt: later });
  });

  it('goes back to the original of an exercise named by its old id', async () => {
    await sync(0, { exercises: [edit({ id: squat.id })] });
    applyLibraryIds(ctx.db);

    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/exercises/${squat.id}/override`, headers });
    expect(res.statusCode).toBeLessThan(300);
    expect(ctx.db.select().from(exerciseOverrides).get()!.deleted).toBe(true);
    expect(pullChanges(ctx.db, ctx.ownerId, 0).changes.exercises!.find((e) => e.id === NEW_ID)).toMatchObject({ customized: false });
  });
});
