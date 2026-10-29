import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { ensureOwner, openDb } from './db/index.ts';
import { isPasswordHash } from './lib/password.ts';
import { ensureLibrary } from './import/library.ts';
import { applyLibraryIds } from './import/library-ids.ts';
import { applyLibraryText } from './import/library-text.ts';
import { backupDatabase, cleanupMedia } from './storage.ts';
import { currentRev, revEvents } from './sync.ts';

const config = loadConfig();
const db = openDb(config.dataDir);
const ownerId = ensureOwner(db);
const app = await buildApp({ config, db, ownerId, logger: { level: process.env.LOG_LEVEL ?? 'info' } });

const moved = applyLibraryIds(db);
if (moved) app.log.info(`${moved} built-in exercises moved to their fixed id`);
const updated = applyLibraryText(db);
if (updated) app.log.info(`${updated} built-in exercises updated (names, instructions, translations)`);

if (!config.passwordHash) {
  app.log.warn('APP_PASSWORD_HASH is empty: login is disabled. Generate one with `npm run hash-password`.');
} else if (!isPasswordHash(config.passwordHash)) {
  app.log.error(
    'APP_PASSWORD_HASH is not a valid hash, every login will fail. In an env file read by Docker Compose, ' +
      "put the value between single quotes (APP_PASSWORD_HASH='scrypt$...'), or regenerate it with hash-password --write.",
  );
}

// Once a day: database backup, and removal of unused media (replaced or deleted exercise videos).
const cleanup = async () => {
  await backupDatabase(db, config.dataDir)
    .then((file) => file && app.log.info(`database backup: ${file}`))
    .catch((err) => app.log.error(err, 'database backup failed'));
  await cleanupMedia(db, config.dataDir)
    .then((r) => r.files && app.log.info(`media cleanup: ${r.files} files, ${Math.round(r.bytes / 1024)} KB freed`))
    .catch((err) => app.log.error(err, 'media cleanup failed'));
};
void cleanup();
const cleanupTimer = setInterval(cleanup, 24 * 3600 * 1000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    clearInterval(cleanupTimer);
    await app.close();
    db.$client.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
// In development the app is served by Vite, not by this server (which then only answers /api and /media).
if (!config.staticDir) app.log.info('API only: open the app at http://localhost:5173 (npm run dev)');

// First start of a new install: download the exercise library in the background (a few minutes on
// a small server), then tell connected devices to fetch it.
void ensureLibrary(db, config.dataDir, { log: (msg) => app.log.info(`library import: ${msg}`) })
  .then((imported) => {
    if (!imported) return;
    app.log.info(`library import: ${imported} exercises imported`);
    revEvents.emit('rev', ownerId, currentRev(db));
  })
  .catch((err) => app.log.error(err, 'library import failed; run src/scripts/import-exercises.ts by hand'));
