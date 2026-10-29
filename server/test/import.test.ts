import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exercises, media } from '../src/db/schema.ts';
import { type FreeExercise, guessExerciseType, importFreeExerciseDb, mapMuscles } from '../src/import/free-exercise-db.ts';
import { ensureLibrary, hasLibrary } from '../src/import/library.ts';
import { TEST_PASSWORD, makeTestApp, tempDir } from './helpers.ts';

function fx(partial: Partial<FreeExercise>): FreeExercise {
  return {
    id: 'X',
    name: 'X',
    force: null,
    level: 'beginner',
    mechanic: null,
    equipment: 'barbell',
    primaryMuscles: [],
    secondaryMuscles: [],
    instructions: [],
    category: 'strength',
    images: [],
    ...partial,
  };
}

describe('mapping', () => {
  it('maps dataset muscles to our ids and drops unknown ones', () => {
    expect(mapMuscles(['quadriceps', 'lower back', 'middle back', 'abdominals', 'wings'])).toEqual([
      'quads',
      'lowerback',
      'middleback',
      'abs',
    ]);
  });

  it('guesses the exercise type', () => {
    expect(guessExerciseType(fx({ name: 'Barbell Squat' }))).toBe('weight_reps');
    expect(guessExerciseType(fx({ name: 'Pullups', equipment: 'body only' }))).toBe('bw_reps');
    expect(guessExerciseType(fx({ name: 'Plank', equipment: 'body only' }))).toBe('duration');
    expect(guessExerciseType(fx({ name: 'Side Bridge', equipment: 'body only' }))).toBe('duration');
    expect(guessExerciseType(fx({ name: 'Weighted Pull Ups', equipment: 'other' }))).toBe('weighted_bw');
    expect(guessExerciseType(fx({ name: 'Band Assisted Pull-Up', equipment: 'bands' }))).toBe('assisted_bw');
    expect(guessExerciseType(fx({ name: "Farmer's Walk", category: 'strongman', equipment: 'other' }))).toBe(
      'weight_distance',
    );
    expect(guessExerciseType(fx({ name: 'Jogging, Treadmill', category: 'cardio', equipment: 'machine' }))).toBe(
      'distance_duration',
    );
    expect(guessExerciseType(fx({ name: 'Hamstring Stretch', category: 'stretching' }))).toBe('duration');
    expect(guessExerciseType(fx({ name: 'Butt Lift (Bridge)', equipment: 'body only' }))).toBe('bw_reps');
    expect(guessExerciseType(fx({ name: 'Drag Curl', equipment: 'barbell' }))).toBe('weight_reps');
    expect(guessExerciseType(fx({ name: 'Sled Row', category: 'strongman', equipment: 'other' }))).toBe('weight_reps');
    expect(guessExerciseType(fx({ name: 'Sled Push', category: 'strongman', equipment: 'other' }))).toBe(
      'weight_distance',
    );
    expect(guessExerciseType(fx({ name: 'Push Up to Side Plank', equipment: 'body only' }))).toBe('bw_reps');
    expect(guessExerciseType(fx({ name: 'Weighted Ball Side Bend', equipment: 'medicine ball' }))).toBe('weight_reps');
  });
});

describe('importFreeExerciseDb', () => {
  let ctx: Awaited<ReturnType<typeof makeTestApp>>;
  let source: string;

  beforeEach(async () => {
    ctx = await makeTestApp();
    source = tempDir();
    const list: FreeExercise[] = [
      fx({
        id: 'Barbell_Squat',
        name: 'Barbell Squat',
        primaryMuscles: ['quadriceps'],
        secondaryMuscles: ['glutes'],
        images: ['Barbell_Squat/0.jpg', 'Barbell_Squat/1.jpg'],
      }),
      fx({ id: 'Plank', name: 'Plank', equipment: 'body only', primaryMuscles: ['abdominals'], images: ['Plank/0.jpg'] }),
    ];
    fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(source, 'dist', 'exercises.json'), JSON.stringify(list));
    // Large JPEGs, like the dataset's, to check the WebP conversion shrinks them.
    for (const [rel, color] of [
      ['Barbell_Squat/0.jpg', '#c33'],
      ['Barbell_Squat/1.jpg', '#3c3'],
      ['Plank/0.jpg', '#c33'],
    ] as const) {
      const file = path.join(source, 'exercises', rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await sharp({ create: { width: 1200, height: 800, channels: 3, background: color } })
        .jpeg({ quality: 95 })
        .toFile(file);
    }
  });

  afterEach(async () => {
    await ctx.cleanup();
    fs.rmSync(source, { recursive: true, force: true });
  });

  it('imports the library on a new install only', async () => {
    expect(hasLibrary(ctx.db)).toBe(false);
    expect(await ensureLibrary(ctx.db, ctx.dataDir, { sourceDir: source })).toBe(2);
    expect(hasLibrary(ctx.db)).toBe(true);
    // Translations are applied right away.
    const squat = ctx.db.select().from(exercises).all().find((e) => e.sourceRef === 'Barbell_Squat')!;
    expect(squat.translations.fr?.name).toBe('Squat à la barre');
    expect(await ensureLibrary(ctx.db, ctx.dataDir, { sourceDir: source })).toBe(0);
  });

  it('imports exercises, converts images and is idempotent', async () => {
    const first = await importFreeExerciseDb(ctx.db, ctx.dataDir, { sourceDir: source });
    expect(first).toMatchObject({ total: 2, imported: 2, skipped: 0, failed: [] });

    const rows = ctx.db.select().from(exercises).all();
    const squat = rows.find((r) => r.sourceRef === 'Barbell_Squat')!;
    expect(squat).toMatchObject({
      id: 'lib-Barbell_Squat',
      source: 'builtin',
      userId: null,
      exerciseType: 'weight_reps',
      primaryMuscles: ['quads'],
      secondaryMuscles: ['glutes'],
    });
    expect(squat.mediaIds).toHaveLength(2);
    expect(rows.find((r) => r.sourceRef === 'Plank')!.exerciseType).toBe('duration');
    expect(new Set(rows.map((r) => r.rev)).size).toBe(2);

    // Identical images (same colour) are stored once.
    const files = ctx.db.select().from(media).all();
    expect(files).toHaveLength(2);
    for (const f of files) {
      expect(f.mime).toBe('image/webp');
      expect(Math.max(f.width!, f.height!)).toBeLessThanOrEqual(480);
    }

    const second = await importFreeExerciseDb(ctx.db, ctx.dataDir, { sourceDir: source });
    expect(second).toMatchObject({ imported: 0, skipped: 2 });
  });

  it('serves the imported exercises and their images', async () => {
    await importFreeExerciseDb(ctx.db, ctx.dataDir, { sourceDir: source });
    const { token } = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { password: TEST_PASSWORD, deviceName: 'PC' },
      })
    ).json();
    const headers = { authorization: `Bearer ${token}` };

    // Devices receive the library through sync.
    const pulled = (
      await ctx.app.inject({ method: 'POST', url: '/api/v1/sync', headers, payload: { since: 0, changes: {} } })
    ).json();
    const squat = pulled.changes.exercises.find((e: { name: string }) => e.name === 'Barbell Squat');
    expect(pulled.changes.exercises).toHaveLength(2);
    expect(squat.secondaryMuscles).toContain('glutes');

    const img = await ctx.app.inject({ method: 'GET', url: squat.mediaUrls[0] });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toContain('immutable');

    const bad = await ctx.app.inject({ method: 'GET', url: '/media/..%2F..%2Fhalko.db' });
    expect(bad.statusCode).toBe(404);
  });
});
