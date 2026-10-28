import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextRev } from '../src/db/index.ts';
import { exercises, setLogs, userSettings, users, workouts } from '../src/db/schema.ts';
import { pullChanges, revEvents } from '../src/sync.ts';
import { TEST_PASSWORD, makeTestApp } from './helpers.ts';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;
let token: string;
const T = 1_700_000_000_000;

function addExercise(id: string, userId: string | null = null) {
  ctx.db
    .insert(exercises)
    .values({
      id,
      userId,
      source: userId ? 'custom' : 'builtin',
      sourceRef: id,
      name: id,
      sport: 'strength',
      exerciseType: 'weight_reps',
      category: null,
      level: null,
      equipment: [],
      primaryMuscles: ['quads'],
      secondaryMuscles: [],
      instructions: [],
      mediaIds: [],
      createdAt: T,
      updatedAt: T,
      rev: nextRev(ctx.db),
    })
    .run();
}

const workout = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  folderId: null,
  sport: 'strength',
  name: 'Legs',
  note: null,
  position: 0,
  createdAt: T,
  updatedAt: T,
  deleted: false,
  ...over,
});
const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  workoutId: 'w1',
  exerciseId: 'squat',
  position: 0,
  mode: 'simple',
  supersetGroup: null,
  targets: [{ kind: 'normal', reps: 8, weightG: 80000, restS: 90 }],
  bySide: null,
  switchS: null,
  note: null,
  createdAt: T,
  updatedAt: T,
  deleted: false,
  ...over,
});
const session = { id: 's1', workoutId: 'w1', sport: 'strength', name: 'Legs', startedAt: T, endedAt: T + 1, note: null, createdAt: T, updatedAt: T, deleted: false };
const log = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  sessionId: 's1',
  exerciseId: 'squat',
  workoutItemId: 'i1',
  position: 0,
  setIndex: 0,
  kind: 'normal',
  reps: 8,
  weightG: 80000,
  completedAt: T,
  createdAt: T,
  updatedAt: T,
  deleted: false,
  ...over,
});

async function sync(since: number, changes: Record<string, unknown[]> = {}) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { authorization: `Bearer ${token}` },
    payload: { since, changes },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeEach(async () => {
  ctx = await makeTestApp();
  addExercise('squat');
  token = (
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { password: TEST_PASSWORD, deviceName: 'A' } })
  ).json().token;
});
afterEach(async () => {
  await ctx.cleanup();
});

describe('sync', () => {
  it('stores pushed rows and serves them to another device', async () => {
    const first = await sync(0, { workouts: [workout()], workoutItems: [item()], sessions: [session], setLogs: [log()] });
    expect(first.rejected).toEqual([]);
    expect(first.changes.exercises.map((e: { id: string }) => e.id)).toEqual(['squat']);

    const other = await sync(0);
    expect(other.changes.workouts).toEqual([workout()]);
    expect(other.changes.workoutItems[0].targets[0]).toMatchObject({ reps: 8 });
    // A set's per-side mark not pushed comes back as its default.
    expect(other.changes.setLogs[0]).toEqual(log({ unilateral: false }));
    expect(other.hasMore).toBe(false);

    // Nothing new since the returned revision.
    const again = await sync(other.rev);
    expect(again.changes).toEqual({});
  });

  it('ignores changes made against another database and gives its own id', async () => {
    const first = await sync(0);
    expect(first.instance).toMatch(/^[0-9a-f-]{36}$/);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: { authorization: `Bearer ${token}` },
      payload: { since: 5, instance: 'another-database', changes: { workouts: [workout()] } },
    });
    expect(res.json()).toEqual({ instance: first.instance, rev: 0, hasMore: false, remaining: 0, changes: {}, rejected: [] });
    expect((await sync(0)).changes.workouts).toBeUndefined();
  });

  it('keeps the most recent version of a row', async () => {
    await sync(0, { workouts: [workout({ name: 'v2', updatedAt: T + 10 })] });
    const stale = await sync(0, { workouts: [workout({ name: 'v1', updatedAt: T + 5 })] });
    // The older edit is ignored and the device gets the newer version back.
    expect(stale.changes.workouts).toEqual([workout({ name: 'v2', updatedAt: T + 10 })]);
    const newer = await sync(stale.rev, { workouts: [workout({ name: 'v3', updatedAt: T + 20 })] });
    expect(newer.changes.workouts).toEqual([workout({ name: 'v3', updatedAt: T + 20 })]);
    expect(ctx.db.select().from(workouts).get()!.name).toBe('v3');
  });

  it('rejects invalid rows and dangling or foreign references', async () => {
    const other = randomUUID();
    ctx.db.insert(users).values({ id: other, name: 'Other', createdAt: T }).run();
    ctx.db
      .insert(workouts)
      .values({ id: 'foreign', userId: other, sport: 'strength', name: 'x', note: null, position: 0, createdAt: T, updatedAt: T, rev: nextRev(ctx.db) })
      .run();
    addExercise('their-custom', other);

    const res = await sync(0, {
      workouts: [workout({ name: '' }), workout({ id: 'foreign', updatedAt: T + 100 })],
      workoutItems: [item({ id: 'i2', workoutId: 'nope' }), item({ id: 'i3', workoutId: 'foreign' })],
      setLogs: [log({ id: 'l9', sessionId: 'nope' })],
    });
    expect(res.rejected).toEqual([
      { table: 'workouts', id: 'w1', reason: 'invalid' },
      { table: 'workouts', id: 'foreign', reason: 'forbidden' },
      { table: 'workoutItems', id: 'i2', reason: 'unknown_workout' },
      { table: 'workoutItems', id: 'i3', reason: 'unknown_workout' },
      { table: 'setLogs', id: 'l9', reason: 'unknown_session' },
    ]);
    // Another user's rows are never sent.
    expect((await sync(0)).changes.workouts).toBeUndefined();

    await sync(0, { workouts: [workout()] });
    const custom = await sync(0, { workoutItems: [item({ exerciseId: 'their-custom' })] });
    expect(custom.rejected).toEqual([{ table: 'workoutItems', id: 'i1', reason: 'unknown_exercise' }]);
  });

  it('stores folders and the folder of each workout', async () => {
    const folder = { id: 'f1', name: 'Force', position: 0, createdAt: T, updatedAt: T, deleted: false };
    const res = await sync(0, { folders: [folder], workouts: [workout({ folderId: 'f1' }), workout({ id: 'w2', folderId: 'nope' })] });
    expect(res.rejected).toEqual([{ table: 'workouts', id: 'w2', reason: 'unknown_folder' }]);
    expect((await sync(0)).changes).toMatchObject({ folders: [folder], workouts: [workout({ folderId: 'f1' })] });
    // Without its folder, a workout is not stored.
    const { folderId: _folderId, ...partial } = workout({ id: 'w3' });
    expect((await sync(0, { workouts: [partial] })).rejected).toEqual([{ table: 'workouts', id: 'w3', reason: 'invalid' }]);
  });

  it('stores the time to change sides and the sets done one side at a time', async () => {
    await sync(0, { workouts: [workout()], workoutItems: [item({ bySide: false, switchS: 8 })], sessions: [session], setLogs: [log({ unilateral: true })] });
    expect((await sync(0, { workoutItems: [item({ switchS: 601, id: 'i2' })] })).rejected).toEqual([{ table: 'workoutItems', id: 'i2', reason: 'invalid' }]);
    const pulled = await sync(0);
    expect(pulled.changes.workoutItems).toEqual([item({ bySide: false, switchS: 8 })]);
    expect(pulled.changes.setLogs).toEqual([log({ unilateral: true })]);
  });

  it('keeps one shared setting per key and clears removed set values', async () => {
    const appearance = (id: string, accent: string, updatedAt: number) => ({
      id,
      key: 'appearance',
      value: { theme: 'dark', accent, musclePrimary: '#FF4D2E', muscleSecondary: '#FFD166' },
      createdAt: T,
      updatedAt,
      deleted: false,
    });
    await sync(0, { userSettings: [appearance('from-pc', '#D4FF3A', T + 1)] });
    const res = await sync(0, { userSettings: [appearance('from-other', '#7CC4FF', T + 2)] });
    expect(ctx.db.select().from(userSettings).all()).toHaveLength(1);
    expect(res.changes.userSettings[0]).toMatchObject({ id: 'from-pc', value: { accent: '#7CC4FF' } });

    await sync(0, { workouts: [workout()], workoutItems: [item()], sessions: [session], setLogs: [log()] });
    const { weightG: _w, ...noWeight } = log({ updatedAt: T + 5 });
    await sync(0, { setLogs: [noWeight] });
    expect(ctx.db.select().from(setLogs).get()!.weightG).toBeNull();
  });

  it('paginates without skipping rows and notifies event stream listeners', async () => {
    const seen: number[] = [];
    const listener = (_u: string, rev: number) => seen.push(rev);
    revEvents.on('rev', listener);
    const many = Array.from({ length: 7 }, (_, k) => workout({ id: `w${k}`, position: k }));
    await sync(0, { workouts: many });
    revEvents.off('rev', listener);
    expect(seen).toHaveLength(1);

    const ids: string[] = [];
    const remaining: number[] = [];
    let since = 0;
    for (let guard = 0; guard < 10; guard++) {
      const page = pullChanges(ctx.db, ctx.ownerId, since, 3);
      ids.push(...(page.changes.workouts ?? []).map((w) => w.id));
      remaining.push(page.remaining);
      since = page.rev;
      if (!page.hasMore) break;
    }
    expect(ids.sort()).toEqual(many.map((w) => w.id).sort());
    // 8 rows (7 workouts + 1 exercise), up to 3 per table and page: what is left shrinks to 0.
    expect(remaining).toEqual([4, 1, 0]);
  });

  it('closes even while a device listens to the event stream', async () => {
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const stream = await fetch(`${address}/api/v1/events`, { headers: { authorization: `Bearer ${token}` } });
    expect(stream.status).toBe(200);
    const started = Date.now();
    await ctx.app.close();
    expect(Date.now() - started).toBeLessThan(2000);
    await stream.body?.cancel().catch(() => undefined);
  });

  it('requires a token', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/sync', payload: { since: 0, changes: {} } });
    expect(res.statusCode).toBe(401);
  });
});
