import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageResponse } from '@halko/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { exerciseOverrides, exercises, media } from './db/schema.ts';
import { mediaDir, mediaRelPath } from './lib/media.ts';

// An upload is attached to its exercise by the next sync, which can wait (device offline): recent
// files are kept even when nothing uses them yet.
export const CLEANUP_GRACE_MS = 7 * 24 * 3600 * 1000;

// Deletes media files that no exercise (custom, built-in, or a user's version of one) uses anymore.
export async function cleanupMedia(db: Db, dataDir: string, now = Date.now()): Promise<{ files: number; bytes: number }> {
  const used = new Set<string>();
  for (const r of db.select({ ids: exercises.mediaIds }).from(exercises).where(eq(exercises.deleted, false)).all()) {
    r.ids.forEach((id) => used.add(id));
  }
  for (const r of db.select({ ids: exerciseOverrides.mediaIds }).from(exerciseOverrides).where(eq(exerciseOverrides.deleted, false)).all()) {
    r.ids.forEach((id) => used.add(id));
  }
  const unused = db
    .select()
    .from(media)
    .all()
    .filter((m) => !used.has(m.id) && m.createdAt < now - CLEANUP_GRACE_MS);
  for (const m of unused) {
    await fs.rm(path.join(mediaDir(dataDir), mediaRelPath(m.id, m.mime === 'video/mp4' ? 'mp4' : 'webp')), { force: true });
  }
  for (let i = 0; i < unused.length; i += 500) {
    db.delete(media).where(inArray(media.id, unused.slice(i, i + 500).map((m) => m.id))).run();
  }
  // Leftovers of conversions interrupted by a restart.
  await fs.rm(path.join(dataDir, 'tmp'), { recursive: true, force: true });
  return { files: unused.length, bytes: unused.reduce((n, m) => n + m.bytes, 0) };
}

export async function storageUsage(db: Db, dataDir: string): Promise<StorageResponse> {
  const totals = db.select({ files: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${media.bytes}), 0)` }).from(media).get();
  let databaseBytes = 0;
  for (const suffix of ['', '-wal']) {
    databaseBytes += await fs
      .stat(path.join(dataDir, `halko.db${suffix}`))
      .then((s) => s.size)
      .catch(() => 0);
  }
  return { media: { files: totals?.files ?? 0, bytes: totals?.bytes ?? 0 }, databaseBytes };
}

export const BACKUPS_KEPT = 7;

// Consistent copy of the database once a day in data/backups (a backup of data/ then always holds
// a safe file, even if the live one is caught mid-write). Keeps the last 7.
export async function backupDatabase(db: Db, dataDir: string, now = new Date()): Promise<string | null> {
  const dir = path.join(dataDir, 'backups');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `halko-${now.toISOString().slice(0, 10)}.db`);
  const exists = await fs
    .access(file)
    .then(() => true)
    .catch(() => false);
  if (!exists) db.$client.prepare('VACUUM INTO ?').run(file);
  const old = (await fs.readdir(dir)).filter((f) => /^halko-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -BACKUPS_KEPT);
  for (const f of old) await fs.rm(path.join(dir, f), { force: true });
  return exists ? null : file;
}
