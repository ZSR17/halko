import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, 'halko.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  // Foreign keys off while migrating: a table rebuilt to change a column (SQLite cannot alter one) is
  // dropped while others point at it, which they cannot stop in the transaction migrations run in.
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder });
  const broken = sqlite.pragma('foreign_key_check') as unknown[];
  if (broken.length) throw new Error(`Database references broken after migrating: ${JSON.stringify(broken)}`);
  sqlite.pragma('foreign_keys = ON');
  return db;
}

// Global, monotonic revision counter: every synced write gets the next value so clients can pull
// "everything since rev N". Must run inside the same transaction as the write it stamps.
export function nextRev(db: Db | Tx): number {
  const row = db
    .insert(schema.meta)
    .values({ key: 'rev', value: '1' })
    .onConflictDoUpdate({ target: schema.meta.key, set: { value: sql`CAST(${schema.meta.value} AS INTEGER) + 1` } })
    .returning({ value: schema.meta.value })
    .get();
  return Number(row.value);
}

// Single-user for now, but every row already carries a user id.
// Random id of this database, sent with each sync so devices notice when the data behind the server was
// replaced (see SyncResponse.instance). Removing the `instance` row of a copy gives it a new one.
export function instanceId(db: Db): string {
  const existing = db.select().from(schema.meta).where(eq(schema.meta.key, 'instance')).get();
  if (existing) return existing.value;
  db.insert(schema.meta).values({ key: 'instance', value: randomUUID() }).onConflictDoNothing().run();
  return instanceId(db);
}

export function ensureOwner(db: Db): string {
  const existing = db.select().from(schema.meta).where(eq(schema.meta.key, 'owner_id')).get();
  if (existing) return existing.value;
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(schema.users).values({ id, name: 'Moi', createdAt: Date.now() }).run();
    tx.insert(schema.meta).values({ key: 'owner_id', value: id }).run();
  });
  return id;
}
