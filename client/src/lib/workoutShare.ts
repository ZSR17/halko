import { type SharedExercise, type SharedWorkout, sharedWorkoutSchema } from '@halko/shared';
import { type HalkoDb, type LocalExercise, type LocalWorkoutItem, db as defaultDb } from '../db/db.ts';
import { type ExerciseFields, createExercise, uploadMedia } from '../db/exercises.ts';
import { createWorkout, liveItems, saveWorkout, supersetLabels } from '../db/workouts.ts';
import { saveJsonAs } from './backup.ts';
import { t } from './i18n.ts';
import { newId } from './id.ts';

// A workout as a file, to share with someone using another server: library exercises are named by their
// free-exercise-db id (their `id` differs from one server to another), custom ones travel whole, with
// their photos and videos if asked.

export class ShareError extends Error {}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

// The files of a custom exercise: each photo, and each video without the poster image that follows it.
async function exerciseMedia(e: LocalExercise): Promise<{ mime: 'image/webp' | 'video/mp4'; data: string }[]> {
  const out = [];
  for (let i = 0; i < e.mediaUrls.length; i++) {
    const url = e.mediaUrls[i]!;
    const video = url.endsWith('.mp4');
    const res = await fetch(url);
    if (!res.ok) throw new ShareError(t('share.mediaMissing', { name: e.name }));
    out.push({ mime: video ? ('video/mp4' as const) : ('image/webp' as const), data: toBase64(new Uint8Array(await res.arrayBuffer())) });
    if (video) i++;
  }
  return out;
}

// The workout `id` as a file's content; with `media`, the photos and videos of its custom exercises too.
export async function exportWorkout(id: string, { media }: { media: boolean }, db: HalkoDb = defaultDb): Promise<SharedWorkout> {
  const workout = await db.workouts.get(id);
  if (!workout) throw new ShareError(t('workout.notFound'));
  const items = await liveItems(db, id);
  const labels = supersetLabels(items);
  const exercises: SharedExercise[] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    if (index.has(item.exerciseId)) continue;
    const e = await db.exercises.get(item.exerciseId);
    if (!e) throw new ShareError(t('workout.notFound'));
    if (e.source === 'builtin') {
      // This user's version of it (name, video) stays here: the other server has its own library.
      if (!e.sourceRef) throw new ShareError(t('share.notSynced'));
      exercises.push({ ref: e.sourceRef, name: e.library?.en.name ?? e.name });
    } else {
      const { name, exerciseType, equipment, primaryMuscles, secondaryMuscles, instructions } = e;
      const files = media && e.mediaUrls.length ? await exerciseMedia(e) : undefined;
      exercises.push({ custom: { name, exerciseType, equipment, primaryMuscles, secondaryMuscles, instructions, ...(files && { media: files }) } });
    }
    index.set(item.exerciseId, exercises.length - 1);
  }
  return {
    app: 'halko',
    kind: 'workout',
    version: 1,
    exportedAt: Date.now(),
    workout: {
      name: workout.name,
      note: workout.note,
      items: items.map((i) => ({
        exercise: index.get(i.exerciseId)!,
        mode: i.mode,
        superset: i.supersetGroup ? (labels.get(i.supersetGroup) ?? null) : null,
        targets: i.targets,
        ...(i.bySide != null && { bySide: i.bySide }),
        ...(i.switchS != null && { switchS: i.switchS }),
        note: i.note,
      })),
    },
    exercises,
  };
}

// Whether the workout has custom exercises with photos or videos (the only ones a file can carry: the
// other server has the library's own).
export async function hasOwnMedia(id: string, db: HalkoDb = defaultDb): Promise<boolean> {
  const exercises = await db.exercises.bulkGet((await liveItems(db, id)).map((i) => i.exerciseId));
  return exercises.some((e) => e?.source === 'custom' && e.mediaUrls.length > 0);
}

// Saves the workout as a file named after it (without the characters file systems refuse), asking where
// first. False when that was cancelled.
export async function saveWorkoutFile(id: string, name: string, options: { media: boolean }, db: HalkoDb = defaultDb): Promise<boolean> {
  const save = await saveJsonAs(`${name.replace(/[\\/:*?"<>|]+/g, '-')}.halko.json`);
  if (!save) return false;
  await save(await exportWorkout(id, options, db));
  return true;
}

// The content of a file to import, checked.
export function readSharedWorkout(data: unknown): SharedWorkout {
  const parsed = sharedWorkoutSchema.safeParse(data);
  if (!parsed.success || parsed.data.workout.items.some((i) => i.exercise >= parsed.data.exercises.length)) {
    throw new ShareError(t('share.notWorkout'));
  }
  return parsed.data;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// What an exercise of the file is here: a library exercise found by its free-exercise-db id (or missing:
// the library is not downloaded yet), one of my custom exercises of the same name and type, or a new one.
type Match = { mine: LocalExercise } | { missing: string } | { custom: Extract<SharedExercise, { custom: unknown }>['custom'] };

function match(e: SharedExercise, mine: LocalExercise[]): Match {
  if ('ref' in e) {
    const found = mine.find((m) => m.source === 'builtin' && m.sourceRef === e.ref);
    return found ? { mine: found } : { missing: e.name };
  }
  const c = e.custom;
  const same = mine.find((m) => m.source === 'custom' && m.exerciseType === c.exerciseType && sameName(m.name, c.name));
  return same ? { mine: same } : { custom: c };
}

const myExercises = async (db: HalkoDb) => (await db.exercises.toArray()).filter((e) => !e.deleted);

// The workout of a file as it would be once imported, to show before importing: its items with their
// exercise (those to create are built from the file, their photos included), whether that exercise is
// new here or missing, and the superset letters.
export interface ImportPreview {
  items: { item: LocalWorkoutItem; exercise: LocalExercise | undefined; status: 'new' | 'missing' | null }[];
  labels: Map<string, string>;
}

export async function previewImport(shared: SharedWorkout, db: HalkoDb = defaultDb): Promise<ImportPreview> {
  const mine = await myExercises(db);
  const matches = shared.exercises.map((e) => match(e, mine));
  const items = shared.workout.items.map((i, position) => {
    const m = matches[i.exercise]!;
    const id = 'mine' in m ? m.mine.id : `shared-${i.exercise}`;
    const item: LocalWorkoutItem = {
      id: `preview-${position}`,
      workoutId: 'preview',
      exerciseId: id,
      position,
      mode: i.mode,
      supersetGroup: i.superset,
      targets: i.targets,
      bySide: i.bySide ?? null,
      switchS: i.switchS ?? null,
      note: i.note,
      createdAt: 0,
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    };
    if ('mine' in m) return { item, exercise: m.mine, status: null };
    if ('missing' in m) return { item, exercise: undefined, status: 'missing' as const };
    const { media: files = [], ...custom } = m.custom;
    const exercise: LocalExercise = {
      ...custom,
      id,
      source: 'custom',
      sport: 'strength',
      category: null,
      level: null,
      mediaIds: [],
      mediaUrls: files.filter((f) => f.mime !== 'video/mp4').map((f) => `data:${f.mime};base64,${f.data}`),
      sourceRef: null,
      unilateral: false,
      customized: false,
      createdAt: 0,
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    };
    return { item, exercise, status: 'new' as const };
  });
  return { items, labels: supersetLabels(items.map((i) => i.item)) };
}

// Adds a shared workout here and returns its id. Library exercises are found by their free-exercise-db id;
// a custom one of the same name and type as one of mine is mine, else it is created (with its photos and
// videos when `media`). Files are sent to the server first: if that fails, nothing is written.
export async function importWorkout(shared: SharedWorkout, { media }: { media: boolean }, db: HalkoDb = defaultDb): Promise<string> {
  const mine = await myExercises(db);
  const resolved: (string | ExerciseFields)[] = [];
  for (const e of shared.exercises) {
    const m = match(e, mine);
    if ('missing' in m) throw new ShareError(t('share.libraryMissing', { name: m.missing }));
    if ('mine' in m) {
      resolved.push(m.mine.id);
      continue;
    }
    // The files are sent to the server, not kept in the exercise.
    const { media: files = [], ...c } = m.custom;
    const fields: ExerciseFields = { ...c, mediaIds: [], mediaUrls: [] };
    if (media) {
      for (const [n, file] of files.entries()) {
        const sent = await uploadMedia(new File([fromBase64(file.data)], `${c.name}-${n}.${file.mime === 'video/mp4' ? 'mp4' : 'webp'}`, { type: file.mime }));
        fields.mediaIds.push(...sent.ids);
        fields.mediaUrls.push(...sent.urls);
      }
    }
    resolved.push(fields);
  }

  return db.transaction('rw', [db.exercises, db.folders, db.workouts, db.workoutItems], async () => {
    const exerciseIds: string[] = [];
    for (const r of resolved) exerciseIds.push(typeof r === 'string' ? r : await createExercise(r, db));
    const id = await createWorkout(shared.workout.name, db);
    if (shared.workout.note) await db.workouts.update(id, { note: shared.workout.note });
    const groups = new Map<string, string>();
    const t = Date.now();
    const items: LocalWorkoutItem[] = shared.workout.items.map((i, position) => ({
      id: newId(),
      workoutId: id,
      exerciseId: exerciseIds[i.exercise]!,
      position,
      mode: i.mode,
      supersetGroup: i.superset ? (groups.get(i.superset) ?? groups.set(i.superset, newId()).get(i.superset)!) : null,
      targets: i.targets,
      bySide: i.bySide ?? null,
      switchS: i.switchS ?? null,
      note: i.note,
      createdAt: t,
      updatedAt: t,
      deleted: 0,
      dirty: 1,
    }));
    await saveWorkout(id, shared.workout.name, items, db);
    return id;
  });
}
