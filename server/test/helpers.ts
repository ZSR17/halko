import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { ensureOwner, openDb } from '../src/db/index.ts';
import { hashPassword } from '../src/lib/password.ts';

export const TEST_PASSWORD = 'correct horse battery staple';

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'halko-test-'));
}

export async function makeTestApp(env: Record<string, string> = {}) {
  const dataDir = tempDir();
  const config = loadConfig({ DATA_DIR: dataDir, APP_PASSWORD_HASH: await hashPassword(TEST_PASSWORD), ...env });
  const db = openDb(dataDir);
  const ownerId = ensureOwner(db);
  const app = await buildApp({ config, db, ownerId });
  const cleanup = async () => {
    await app.close();
    db.$client.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, db, dataDir, ownerId, cleanup };
}
