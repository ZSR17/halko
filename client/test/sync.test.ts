import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HalkoDb, type LocalExercise } from '../src/db/db.ts';
import { localizeExercises, updateExercise } from '../src/db/exercises.ts';
import { startSession } from '../src/db/sessions.ts';
import { prefs } from '../src/lib/i18n.ts';
import { createWorkout, liveItems, saveWorkout } from '../src/db/workouts.ts';
import { addItem } from './workout-helpers.ts';
import { applyChanges, collectChanges, markPushed, syncNow, syncStatus } from '../src/sync/engine.ts';
import { syncSettings } from '../src/sync/settings.ts';

let db: HalkoDb;
let n = 0;
const squat: LocalExercise = {
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
  deleted: 0,
  dirty: 0,
  updatedAt: 0,
};

// Minimal stand-in for the server: records requests, answers with a canned response.
function mockServer(respond: (body: { since: number; changes: Record<string, unknown[]> }) => unknown) {
  const calls: { since: number; changes: Record<string, unknown[]> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      return new Response(JSON.stringify(respond(body)));
    }),
  );
  return calls;
}

const empty = { rev: 10, hasMore: false, changes: {}, rejected: [] };

beforeEach(async () => {
  db = new HalkoDb(`sync-${n++}`);
  await db.exercises.add(squat);
  localStorage.setItem('halko.token', 'test-token');
  syncSettings.set({ shareAppearance: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sync engine', () => {
  it('pushes dirty rows as wire rows and marks them clean', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    const { changes } = await collectChanges(db);
    expect(changes.workouts?.[0]).toMatchObject({ id: w, deleted: false });
    expect(changes.workouts?.[0]).not.toHaveProperty('dirty');
    expect(changes.workoutItems).toHaveLength(1);

    const calls = mockServer(() => empty);
    await syncNow({ db });
    expect(calls[0]!.since).toBe(0);
    expect((await db.workouts.get(w))!.dirty).toBe(0);
    expect((await db.meta.get('syncRev'))!.value).toBe(10);
    expect(syncStatus.get()).toMatchObject({ state: 'synced', pending: 0 });

    // Next sync only pulls, from the stored revision.
    await syncNow({ db });
    expect(calls[1]).toEqual({ since: 10, changes: {} });
  });

  it('pushes edited exercises without local-only fields', async () => {
    await db.exercises.update('squat', { name: 'My squat', updatedAt: 5, dirty: 1 });
    const { changes } = await collectChanges(db);
    expect(changes.exercises).toHaveLength(1);
    expect(changes.exercises![0]).toMatchObject({ id: 'squat', name: 'My squat', deleted: false, mediaIds: [] });
    for (const k of ['dirty', 'mediaUrls', 'customized']) expect(changes.exercises![0]).not.toHaveProperty(k);
  });

  it('keeps a row dirty when it is edited while the push is in flight', async () => {
    const w = await createWorkout('Legs', db);
    mockServer(() => empty);
    const { snapshot } = await collectChanges(db);
    await new Promise((r) => setTimeout(r, 2));
    await saveWorkout(w, 'Legs v2', await liveItems(db, w), db);
    await markPushed(db, snapshot, []);
    expect((await db.workouts.get(w))!.dirty).toBe(1);
  });

  it('applies pulled rows unless the local copy is newer and unsent', async () => {
    const w = await createWorkout('Local', db);
    const local = (await db.workouts.get(w))!;
    const remote = (name: string, updatedAt: number) => ({ ...local, name, updatedAt, deleted: false, dirty: undefined });
    await applyChanges(db, { workouts: [remote('Old', local.updatedAt - 1000)] as never });
    expect((await db.workouts.get(w))!.name).toBe('Local');
    await applyChanges(db, { workouts: [remote('Newer', local.updatedAt + 1000)] as never });
    expect(await db.workouts.get(w)).toMatchObject({ name: 'Newer', dirty: 0 });

    const wireSquat = (over: object) => ({ ...squat, deleted: false, dirty: undefined, translations: {}, ...over }) as never;
    await applyChanges(db, { exercises: [wireSquat({ mediaIds: ['abc'], mediaUrls: ['/media/abc.mp4'], updatedAt: 5 })] });
    expect(await db.exercises.get('squat')).toMatchObject({ mediaUrls: ['/media/abc.mp4'], deleted: 0, dirty: 0 });

    // A local edit not pushed yet survives an older server copy; deleted exercises stay for history.
    await db.exercises.update('squat', { name: 'My squat', updatedAt: 50, dirty: 1 });
    await applyChanges(db, { exercises: [wireSquat({ name: 'Server', updatedAt: 10 })] });
    expect((await db.exercises.get('squat'))!.name).toBe('My squat');
    await applyChanges(db, { exercises: [wireSquat({ deleted: true, updatedAt: 60 })] });
    expect(await db.exercises.get('squat')).toMatchObject({ deleted: 1, name: 'Squat' });
  });

  it('shows library exercises in the language chosen, and finds them back in English', async () => {
    prefs.set({ ...prefs.get(), locale: 'fr' });
    const translations = { fr: { name: 'Squat à la barre', instructions: ['Descends.'] } };
    const wire = { ...squat, name: 'Barbell Squat', instructions: ['Squat.'], deleted: false, dirty: undefined, translations, updatedAt: 5 };
    await applyChanges(db, { exercises: [wire as never] });
    expect(await db.exercises.get('squat')).toMatchObject({ name: 'Squat à la barre', instructions: ['Descends.'] });
    await localizeExercises('en', db);
    expect(await db.exercises.get('squat')).toMatchObject({ name: 'Barbell Squat', instructions: ['Squat.'], dirty: 0 });
    // A language without translation shows English.
    await localizeExercises('de', db);
    expect((await db.exercises.get('squat'))!.name).toBe('Barbell Squat');

    // Once edited, the exercise is this user's text, kept in every language and pushed without the library.
    await updateExercise('squat', { ...squat, name: 'My squat' }, db);
    await localizeExercises('fr', db);
    expect((await db.exercises.get('squat'))!.name).toBe('My squat');
    const { changes } = await collectChanges(db);
    expect(changes.exercises![0]).not.toHaveProperty('library');
  });

  it('follows the pages announced by the server', async () => {
    const calls = mockServer((b) => (b.since === 0 ? { ...empty, rev: 5, hasMore: true } : { ...empty, rev: 9 }));
    await syncNow({ db });
    expect(calls.map((c) => c.since)).toEqual([0, 5]);
    expect((await db.meta.get('syncRev'))!.value).toBe(9);
  });

  it('starts over when the data behind the server was replaced', async () => {
    let instance = 'db-1';
    const calls = mockServer(() => ({ ...empty, instance }));
    await syncNow({ db });
    expect((await db.meta.get('serverInstance'))!.value).toBe('db-1');
    await createWorkout('Legs', db);

    // Another database: the first answer stores nothing, local data is dropped and pulled again.
    instance = 'db-2';
    calls.length = 0;
    await syncNow({ db });
    expect(calls.map((c) => ({ since: c.since, instance: (c as { instance?: string }).instance }))).toEqual([
      { since: 10, instance: 'db-1' },
      { since: 0, instance: 'db-2' },
    ]);
    expect(calls[1]!.changes).toEqual({});
    expect(await db.workouts.count()).toBe(0);
    expect(await db.exercises.count()).toBe(0);
    expect((await db.meta.get('serverInstance'))!.value).toBe('db-2');
  });

  it('reports the server as unreachable when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await createWorkout('Legs', db);
    await syncNow({ db });
    expect(syncStatus.get()).toMatchObject({ state: 'offline', pending: 1 });

    // Same when the reverse proxy is up but the server behind it is not.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    await syncNow({ db });
    expect(syncStatus.get().state).toBe('offline');
  });

  it('reports download progress while several pages arrive', async () => {
    const seen: (typeof syncStatus extends { get: () => infer T } ? T : never)['download'][] = [];
    const stop = syncStatus.subscribe(() => seen.push(syncStatus.get().download));
    const workout = (id: string) => ({ id, sport: 'strength', name: id, note: null, position: 0, createdAt: 0, updatedAt: 0, deleted: false });
    mockServer((b) =>
      b.since === 0
        ? { ...empty, rev: 5, hasMore: true, remaining: 2, changes: { workouts: [workout('a'), workout('b')] } }
        : { ...empty, rev: 9, remaining: 0, changes: { workouts: [workout('c'), workout('d')] } },
    );
    await syncNow({ db });
    stop();
    expect(seen).toContainEqual({ done: 2, total: 4 });
    expect(syncStatus.get().download).toBeNull();
  });
});
