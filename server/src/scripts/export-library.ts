// Usage: npm run export:library -- --out <folder> [--source <free-exercise-db checkout>]
// Writes the exercise library as a new server imports it, for an app that embeds it: <folder>/exercises.json
// (the exercises as sync sends them, without media addresses) and <folder>/images/<media id>.webp.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { openDb } from '../db/index.ts';
import { exercises } from '../db/schema.ts';
import { exercisesToWire } from '../exercises.ts';
import { importFreeExerciseDb } from '../import/free-exercise-db.ts';
import { applyLibraryText } from '../import/library-text.ts';
import { mediaDir, mediaRelPath } from '../lib/media.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    source: { type: 'string' },
  },
});
if (!values.out) {
  console.error('Usage: npm run export:library -- --out <folder> [--source <free-exercise-db checkout>]');
  process.exit(1);
}
const out = path.resolve(values.out);

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'halko-library-'));
try {
  const db = openDb(dataDir);
  const result = await importFreeExerciseDb(db, dataDir, { sourceDir: values.source, log: (msg) => console.log(msg) });
  if (result.failed.length) throw new Error(`Not imported: ${result.failed.join(', ')}`);
  applyLibraryText(db);
  const rows = db.select().from(exercises).where(eq(exercises.source, 'builtin')).all();
  // One date for the whole export: an app replaces its copy of an exercise only with a more recent one.
  const exportedAt = Date.now();
  const wire = exercisesToWire(db, rows.map((r) => ({ ...r, customized: false })))
    .map((e) => ({ ...e, createdAt: exportedAt, updatedAt: exportedAt, mediaUrls: [] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  db.$client.close();

  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, 'images'), { recursive: true });
  // One exercise per line, so that a new export reads as a diff.
  await fs.writeFile(path.join(out, 'exercises.json'), `[\n${wire.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`);
  for (const id of new Set(wire.flatMap((e) => e.mediaIds))) {
    await fs.copyFile(path.join(mediaDir(dataDir), mediaRelPath(id, 'webp')), path.join(out, 'images', `${id}.webp`));
  }
  console.log(`${wire.length} exercises written to ${out}`);
} finally {
  await fs.rm(dataDir, { recursive: true, force: true });
}
