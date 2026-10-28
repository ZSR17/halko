import { type Crop, MAX_UPLOAD_BYTES, type UploadResponse } from '@halko/shared';
import { ApiError, api } from '../lib/api.ts';
import { syncNow } from '../sync/engine.ts';
import { type HalkoDb, type LocalExercise, db as defaultDb, exerciseText } from './db.ts';
import type { MessageKey } from '@halko/shared/i18n';
import { t } from '../lib/i18n.ts';
import { newId } from '../lib/id.ts';

export type ExerciseFields = Pick<
  LocalExercise,
  'name' | 'exerciseType' | 'equipment' | 'primaryMuscles' | 'secondaryMuscles' | 'instructions' | 'mediaIds' | 'mediaUrls'
>;

export async function createExercise(fields: ExerciseFields, db: HalkoDb = defaultDb): Promise<string> {
  const id = newId();
  const t = Date.now();
  await db.exercises.add({
    id,
    source: 'custom',
    sport: 'strength',
    category: null,
    level: null,
    ...fields,
    name: fields.name.trim(),
    sourceRef: null,
    unilateral: false,
    customized: false,
    createdAt: t,
    updatedAt: t,
    deleted: 0,
    dirty: 1,
  });
  return id;
}

// Editing a built-in exercise makes it this user's version (kept on the server, on every device).
export async function updateExercise(id: string, fields: ExerciseFields, db: HalkoDb = defaultDb): Promise<void> {
  const existing = await db.exercises.get(id);
  if (!existing) throw new Error('exercise not found');
  await db.exercises.update(id, {
    ...fields,
    name: fields.name.trim(),
    // Now this user's own text, shown as is in every language.
    library: undefined,
    customized: existing.source === 'builtin',
    updatedAt: Date.now(),
    dirty: 1,
  });
}

// Shows the library exercises in `locale` (at start, and when the language changes).
export async function localizeExercises(locale: string, db: HalkoDb = defaultDb): Promise<void> {
  await db.exercises
    .where('source')
    .equals('builtin')
    .modify((e) => {
      if (!e.library) return;
      const text = exerciseText(e.library, locale);
      if (e.name !== text.name) e.name = text.name;
      if (JSON.stringify(e.instructions) !== JSON.stringify(text.instructions)) e.instructions = text.instructions;
    });
}

// Only custom exercises can be deleted; they stay in past sessions.
export async function deleteExercise(id: string, db: HalkoDb = defaultDb): Promise<void> {
  await db.exercises.update(id, { deleted: 1, updatedAt: Date.now(), dirty: 1 });
}

// Back to the library's version of a built-in exercise. Needs the server.
export async function resetExercise(id: string): Promise<void> {
  await syncNow();
  await api(`/exercises/${id}/override`, { method: 'DELETE' }).catch((err) => {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  });
  await syncNow();
}

export class UploadError extends Error {}

// Texts by HTTP status, looked up when the error happens (in the language of that moment).
const UPLOAD_ERRORS: Record<number, MessageKey> = {
  413: 'upload.tooLarge',
  415: 'upload.unsupported',
  503: 'upload.noVideo',
};

const LINK_ERRORS: Record<number, MessageKey> = {
  400: 'link.invalid',
  413: 'link.tooLarge',
  415: 'link.notMedia',
  502: 'link.notFound',
  503: 'upload.noVideo',
};

async function fromUrl(body: { url: string; crop?: Crop; frameFirst?: boolean }): Promise<UploadResponse | null> {
  try {
    return await api<UploadResponse>('/media/from-url', { method: 'POST', body: JSON.stringify(body) });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'needs_framing') return null;
    if (err instanceof ApiError) throw new UploadError(t(LINK_ERRORS[err.status] ?? 'link.refused'));
    throw new UploadError(t('link.offline'));
  }
}

// Asks the server to download a GIF or video from a link and keep it. Null when the link is a still photo:
// it is not kept yet, to be framed first, then sent with importMediaFromUrl.
export const importMotionFromUrl = (url: string) => fromUrl({ url, frameFirst: true });

// Asks the server to download a picture from a link and keep it (only `crop` of it), like an uploaded photo.
export async function importMediaFromUrl(url: string, crop?: Crop): Promise<UploadResponse> {
  return (await fromUrl({ url, crop }))!;
}

// Sends a photo, GIF or video to the server, which compresses it (and keeps only `crop` of a photo).
export async function uploadMedia(file: File, crop?: Crop): Promise<UploadResponse> {
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(t('upload.tooLarge'));
  const query = crop ? `?crop=${[crop.x, crop.y, crop.w, crop.h].join(',')}` : '';
  try {
    return await api<UploadResponse>(`/media${query}`, {
      method: 'POST',
      body: file,
      headers: { 'content-type': file.type || 'application/octet-stream' },
    });
  } catch (err) {
    if (err instanceof ApiError) throw new UploadError(t(UPLOAD_ERRORS[err.status] ?? 'upload.refused'));
    throw new UploadError(t('upload.offline'));
  }
}
