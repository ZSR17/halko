import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExerciseType, MuscleId, Sport } from '@halko/shared';
import { and, eq } from 'drizzle-orm';
import { type Db, nextRev } from '../db/index.ts';
import { exercises } from '../db/schema.ts';
import { storeImage } from '../lib/media.ts';
import { libraryExerciseId } from './library-ids.ts';

// https://github.com/yuhonas/free-exercise-db (public domain / Unlicense)
const DEFAULT_SOURCE_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main';

export interface FreeExercise {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}

const MUSCLE_MAP: Record<string, MuscleId> = {
  abdominals: 'abs',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lowerback',
  'middle back': 'middleback',
  neck: 'neck',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
};

export function mapMuscles(names: string[]): MuscleId[] {
  const out = new Set<MuscleId>();
  for (const name of names) {
    const id = MUSCLE_MAP[name.toLowerCase()];
    if (id) out.add(id);
  }
  return [...out];
}

const BODYWEIGHT_EQUIPMENT = new Set(['body only', '']);

// The dataset has no notion of "how is this measured"; infer one of our 8 types from category,
// equipment and name. Wrong guesses can be fixed per exercise in the app.
export function guessExerciseType(e: FreeExercise): ExerciseType {
  const name = e.name.toLowerCase();
  const bodyweight = BODYWEIGHT_EQUIPMENT.has((e.equipment ?? '').toLowerCase());
  if (e.category === 'cardio') return 'distance_duration';
  if (e.category === 'stretching') return 'duration';
  if (/farmer|carry|yoke/.test(name) || (/sled|drag/.test(name) && /drag|push|walk/.test(name) && !/curl/.test(name))) {
    return 'weight_distance';
  }
  if (/plank|wall sit|l-sit|\bhold\b|isometric|side bridge|dead hang|flexed-arm hang/.test(name) && !/push[- ]?up/.test(name)) {
    return bodyweight ? 'duration' : 'duration_weight';
  }
  if (/assisted/.test(name)) return 'assisted_bw';
  if (/weighted/.test(name) && !/ball/.test(name) && !/(barbell|dumbbell|kettlebell|cable|machine)/.test((e.equipment ?? '').toLowerCase())) {
    return 'weighted_bw';
  }
  return bodyweight ? 'bw_reps' : 'weight_reps';
}

function guessSport(e: FreeExercise): Sport {
  return e.category === 'cardio' ? 'cardio' : 'strength';
}

export interface ImportOptions {
  // Local checkout of free-exercise-db (dist/exercises.json + exercises/<id>/<n>.jpg); downloads otherwise.
  sourceDir?: string;
  sourceUrl?: string;
  // Re-import entries that already exist (overwrites edits made to built-in exercises).
  force?: boolean;
  concurrency?: number;
  log?: (msg: string) => void;
}

interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  failed: string[];
}

async function readSource(opts: ImportOptions, rel: string): Promise<Buffer> {
  if (opts.sourceDir) return fs.readFile(path.join(opts.sourceDir, rel));
  const url = `${opts.sourceUrl ?? DEFAULT_SOURCE_URL}/${rel.split(path.sep).join('/')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function importFreeExerciseDb(db: Db, dataDir: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const log = opts.log ?? (() => {});
  const list = JSON.parse((await readSource(opts, 'dist/exercises.json')).toString('utf8')) as FreeExercise[];
  const result: ImportResult = { total: list.length, imported: 0, skipped: 0, failed: [] };

  const importOne = async (e: FreeExercise) => {
    const existing = db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.source, 'builtin'), eq(exercises.sourceRef, e.id)))
      .get();
    if (existing && !opts.force) {
      result.skipped++;
      return;
    }
    const mediaIds: string[] = [];
    for (const img of e.images) {
      mediaIds.push(await storeImage(db, dataDir, await readSource(opts, path.join('exercises', img))));
    }
    const now = Date.now();
    const values = {
      name: e.name,
      sport: guessSport(e),
      exerciseType: guessExerciseType(e),
      category: e.category,
      level: e.level,
      equipment: e.equipment ? [e.equipment] : [],
      primaryMuscles: mapMuscles(e.primaryMuscles),
      secondaryMuscles: mapMuscles(e.secondaryMuscles),
      instructions: e.instructions,
      mediaIds,
      updatedAt: now,
      deleted: false,
    };
    db.transaction((tx) => {
      const rev = nextRev(tx);
      if (existing) {
        tx.update(exercises).set({ ...values, rev }).where(eq(exercises.id, existing.id)).run();
      } else {
        tx.insert(exercises)
          .values({ id: libraryExerciseId(e.id), userId: null, source: 'builtin', sourceRef: e.id, createdAt: now, rev, ...values })
          .run();
      }
    });
    result.imported++;
  };

  // Small worker pool: images are fetched/converted concurrently, DB writes stay synchronous.
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const e = list[next++]!;
      try {
        await importOne(e);
      } catch (err) {
        result.failed.push(`${e.id}: ${(err as Error).message}`);
      }
      const done = result.imported + result.skipped + result.failed.length;
      if (done % 50 === 0 || done === list.length) log(`${done}/${list.length}`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 6 }, worker));
  return result;
}
