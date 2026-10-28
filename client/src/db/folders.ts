import { type HalkoDb, db as defaultDb } from './db.ts';
import { newId } from '../lib/id.ts';

// Folders sort workouts (one level, optional). On the workouts page, folders and the workouts in none
// share one order (their `position`). Deleting a folder keeps its workouts, out of any folder.

const touched = () => ({ updatedAt: Date.now(), dirty: 1 as const });

// After every folder and workout: a new one comes last on the workouts page.
export async function nextPosition(db: HalkoDb = defaultDb): Promise<number> {
  const last = Math.max((await db.workouts.orderBy('position').last())?.position ?? -1, (await db.folders.orderBy('position').last())?.position ?? -1);
  return last + 1;
}

export async function createFolder(name: string, db: HalkoDb = defaultDb): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.folders.add({ id, name: name.trim(), position: await nextPosition(db), createdAt: now, updatedAt: now, deleted: 0, dirty: 1 });
  return id;
}

// Saves a folder edited: its name, and the workouts taken out of it.
export async function saveFolder(id: string, name: string, takenOut: string[], db: HalkoDb = defaultDb) {
  await db.transaction('rw', db.folders, db.workouts, async () => {
    const folder = await db.folders.get(id);
    const trimmed = name.trim();
    if (folder && trimmed && trimmed !== folder.name) await db.folders.update(id, { name: trimmed, ...touched() });
    for (const workoutId of takenOut) await moveToFolder(workoutId, null, db);
  });
}

export async function deleteFolder(id: string, db: HalkoDb = defaultDb) {
  await db.transaction('rw', db.folders, db.workouts, async () => {
    await db.workouts.filter((w) => w.folderId === id).modify({ folderId: null, ...touched() });
    await db.folders.update(id, { deleted: 1, ...touched() });
  });
}

// Puts a workout in `folderId`, or out of any folder with null (then last on the workouts page).
export async function moveToFolder(workoutId: string, folderId: string | null, db: HalkoDb = defaultDb) {
  const workout = await db.workouts.get(workoutId);
  if (!workout || workout.folderId === folderId) return;
  await db.workouts.update(workoutId, { folderId, ...(folderId === null && { position: await nextPosition(db) }), ...touched() });
}

// The order of the workouts page: folders (`folder:` ids) and workouts in none, as listed.
export async function reorderHome(keys: string[], db: HalkoDb = defaultDb) {
  await db.transaction('rw', db.folders, db.workouts, async () => {
    for (const [position, key] of keys.entries()) {
      if (key.startsWith('folder:')) await db.folders.update(key.slice('folder:'.length), { position, ...touched() });
      else await db.workouts.update(key, { position, ...touched() });
    }
  });
}
