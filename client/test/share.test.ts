import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LocalExercise, HalkoDb } from '../src/db/db.ts';
import { createWorkout, liveItems, saveWorkout } from '../src/db/workouts.ts';
import { prefs } from '../src/lib/i18n.ts';
import { toggleSuperset } from '../src/lib/workoutDraft.ts';
import { ShareError, exportWorkout, importWorkout, previewImport, readSharedWorkout } from '../src/lib/workoutShare.ts';
import { addItem } from './workout-helpers.ts';

let n = 0;
// Two installs: the same library exercise has a different id on each server.
let mine: HalkoDb;
let theirs: HalkoDb;

const exercise = (over: Partial<LocalExercise>): LocalExercise => ({
  id: crypto.randomUUID(),
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
  ...over,
});

const squat = (id: string) => exercise({ id, sourceRef: 'Barbell_Squat', name: 'Squat à la barre', library: { en: { name: 'Barbell Squat', instructions: [] }, translations: {} } });
const lunge = exercise({ id: 'my-lunge', source: 'custom', name: 'Bulgarian lunge', unilateral: true, primaryMuscles: ['quads', 'glutes'], mediaIds: ['a'.repeat(64), 'b'.repeat(64)], mediaUrls: [`/media/${'a'.repeat(64)}.mp4`, `/media/${'b'.repeat(64)}.webp`] });

// A server that serves media files and takes uploads (recording them).
function mockServer() {
  const uploads: { type: string; size: number }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/media/')) return new Response(new Uint8Array([1, 2, 3, 4]));
      if (url.startsWith('/api/v1/media')) {
        const body = init!.body as File;
        uploads.push({ type: body.type, size: body.size });
        const id = String(uploads.length).repeat(64);
        return new Response(JSON.stringify({ ids: [id], urls: [`/media/${id}.webp`] }));
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return uploads;
}

// Push on my side: squat and lunge as a superset, then squat again with its own sets and a note.
async function pushWorkout(): Promise<string> {
  await mine.exercises.bulkAdd([squat('squat-here'), lunge]);
  const id = await createWorkout('Push', mine);
  await mine.workouts.update(id, { note: 'Monday' });
  await addItem(id, (await mine.exercises.get('squat-here'))!, mine);
  await addItem(id, lunge, mine);
  await addItem(id, (await mine.exercises.get('squat-here'))!, mine);
  const items = toggleSuperset(await liveItems(mine, id), 0);
  items[1] = { ...items[1]!, switchS: 8 };
  items[0] = { ...items[0]!, bySide: false };
  items[2] = { ...items[2]!, mode: 'per_set', note: 'Slow', targets: [{ kind: 'warmup', reps: 10, weightG: 40000, restS: 60 }, { kind: 'normal', reps: 5, weightG: 100000, restS: 180 }] };
  await saveWorkout(id, 'Push', items, mine);
  return id;
}

beforeEach(async () => {
  mine = new HalkoDb(`share-mine-${n}`);
  theirs = new HalkoDb(`share-theirs-${n++}`);
  await theirs.exercises.add(squat('squat-there'));
  localStorage.setItem('halko.token', 'test-token');
  prefs.set({ ...prefs.get(), locale: 'en' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sharing a workout', () => {
  it('rebuilds the workout on another install, library exercises found by their free-exercise-db id', async () => {
    mockServer();
    const shared = await exportWorkout(await pushWorkout(), { media: false }, mine);
    expect(shared.exercises).toEqual([
      { ref: 'Barbell_Squat', name: 'Barbell Squat' },
      { custom: expect.not.objectContaining({ media: expect.anything() }) },
    ]);
    // Shown before importing: the library squat is theirs, the lunge new, the superset kept.
    const preview = await previewImport(shared, theirs);
    expect(preview.items.map((i) => [i.exercise?.name, i.status])).toEqual([
      ['Squat à la barre', null],
      ['Bulgarian lunge', 'new'],
      ['Squat à la barre', null],
    ]);
    expect([...preview.labels.values()]).toEqual(['A']);
    expect(preview.items[2]!.item).toMatchObject({ mode: 'per_set', note: 'Slow' });
    expect(await theirs.workouts.count()).toBe(0);

    // Through a file: JSON and back.
    const id = await importWorkout(readSharedWorkout(JSON.parse(JSON.stringify(shared))), { media: true }, theirs);

    expect(await theirs.workouts.get(id)).toMatchObject({ name: 'Push', note: 'Monday', dirty: 1 });
    const items = await liveItems(theirs, id);
    const created = (await theirs.exercises.toArray()).find((e) => e.source === 'custom')!;
    expect(created).toMatchObject({ name: 'Bulgarian lunge', primaryMuscles: ['quads', 'glutes'], mediaIds: [], dirty: 1 });
    expect(items.map((i) => i.exerciseId)).toEqual(['squat-there', created.id, 'squat-there']);
    expect(items[0]!.supersetGroup).toBeTruthy();
    expect(items[1]!.supersetGroup).toBe(items[0]!.supersetGroup);
    expect(items.map((i) => [i.bySide, i.switchS])).toEqual([[false, null], [null, 8], [null, null]]);
    expect(items[2]).toMatchObject({ supersetGroup: null, mode: 'per_set', note: 'Slow', targets: [{ kind: 'warmup', weightG: 40000 }, { kind: 'normal', reps: 5 }] });

    // Imported again: my lunge (same name and type) is used, not a second one.
    await importWorkout(shared, { media: true }, theirs);
    expect((await theirs.exercises.toArray()).filter((e) => e.source === 'custom')).toHaveLength(1);
  });

  it('carries the photos and videos of custom exercises when asked, at both ends', async () => {
    const uploads = mockServer();
    const shared = await exportWorkout(await pushWorkout(), { media: true }, mine);
    // The video, without the poster image that follows it.
    const custom = shared.exercises[1]!;
    expect('custom' in custom && custom.custom.media).toEqual([{ mime: 'video/mp4', data: 'AQIDBA==' }]);

    await importWorkout(shared, { media: false }, theirs);
    expect(uploads).toEqual([]);
    await theirs.exercises.where('source').equals('custom').delete();
    await importWorkout(shared, { media: true }, theirs);
    expect(uploads).toEqual([{ type: 'video/mp4', size: 4 }]);
    expect((await theirs.exercises.where('source').equals('custom').first())!.mediaIds).toEqual(['1'.repeat(64)]);
    // The file's copy of the video is not kept in the exercise.
    expect(await theirs.exercises.where('source').equals('custom').first()).not.toHaveProperty('media');
  });

  it('writes nothing when a file cannot be sent, and refuses what is not a workout', async () => {
    mockServer();
    const shared = await exportWorkout(await pushWorkout(), { media: true }, mine);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(importWorkout(shared, { media: true }, theirs)).rejects.toThrow();
    expect(await theirs.workouts.count()).toBe(0);
    expect(await theirs.exercises.count()).toBe(1);

    expect(() => readSharedWorkout({ app: 'halko', version: 1, tables: {} })).toThrow(ShareError);
    expect(() => readSharedWorkout({ ...shared, workout: { ...shared.workout, items: [{ ...shared.workout.items[0]!, exercise: 9 }] } })).toThrow(ShareError);
    // A library the importing device does not have yet.
    await theirs.exercises.clear();
    await expect(importWorkout(shared, { media: false }, theirs)).rejects.toThrow(/Barbell Squat/);
    expect((await previewImport(shared, theirs)).items[0]).toMatchObject({ exercise: undefined, status: 'missing' });
  });
});
