// Usage: npm run import:exercises [-- --source <free-exercise-db checkout>] [--force]
// Imports the built-in exercise library and converts its images to small WebP files.
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/index.ts';
import { importFreeExerciseDb } from '../import/free-exercise-db.ts';
import { applyLibraryText } from '../import/library-text.ts';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

const config = loadConfig();
const db = openDb(config.dataDir);
const started = Date.now();
const result = await importFreeExerciseDb(db, config.dataDir, {
  sourceDir: values.source,
  force: values.force,
  log: (msg) => console.log(msg),
});
const updated = applyLibraryText(db);
db.$client.close();

console.log(
  `Done in ${Math.round((Date.now() - started) / 1000)} s: ${result.imported} imported, ` +
    `${result.skipped} already there, ${result.failed.length} failed, ${updated} texts updated.`,
);
for (const f of result.failed) console.error(`  failed ${f}`);
process.exit(result.failed.length ? 1 : 0);
