import { EventEmitter } from 'node:events';
import {
  PUSH_TABLES,
  type PushTable,
  type SyncChanges,
  type SyncResponse,
  type WireRow,
  wireSchemas,
} from '@halko/shared';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { type Db, type Tx, instanceId, nextRev } from './db/index.ts';
import { exercisesToWire, mergeExercise, overridesFor, pushExercise } from './exercises.ts';
import * as schema from './db/schema.ts';

const PAGE_SIZE = 500;

// Emits ('rev', userId, rev) after each sync that stored something, for the live event stream.
export const revEvents = new EventEmitter();
revEvents.setMaxListeners(0);

// Exercises are handled apart (see exercises.ts): built-in rows are shared by every user.
const TABLES = {
  folders: schema.folders,
  workouts: schema.workouts,
  workoutItems: schema.workoutItems,
  sessions: schema.sessions,
  setLogs: schema.setLogs,
  userSettings: schema.userSettings,
} as const;

type RowTable = Exclude<PushTable, 'exercises'>;
type AnyTable = (typeof TABLES)[RowTable];
const ROW_TABLES = PUSH_TABLES.filter((t): t is RowTable => t !== 'exercises');
type Row = Record<string, unknown> & { id: string; userId: string | null; updatedAt: number; rev: number };

export function currentRev(db: Db | Tx): number {
  const row = db.select().from(schema.meta).where(eq(schema.meta.key, 'rev')).get();
  return row ? Number(row.value) : 0;
}

// Server row -> wire row: only the protocol's fields (no user id, rev or server-only columns),
// and SQL NULLs of optional numbers become absent.
function toWire(table: RowTable, row: Row): Record<string, unknown> {
  const fields = Object.keys(wireSchemas[table].shape);
  const out: Record<string, unknown> = {};
  for (const k of fields) {
    const v = row[k];
    if (v === null && ['reps', 'weightG', 'durationS', 'distanceM'].includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function getById(tx: Tx, table: AnyTable, id: string): Row | undefined {
  return tx.select().from(table).where(eq(table.id, id)).get() as Row | undefined;
}

// A pushed row may only point at rows of the same user (or at built-in exercises).
function checkRefs(tx: Tx, table: RowTable, row: Record<string, unknown>, userId: string): string | null {
  const own = (t: AnyTable, id: unknown) => {
    if (id === null || id === undefined) return true;
    const r = getById(tx, t, String(id));
    return !!r && r.userId === userId;
  };
  const exercise = (id: unknown) => {
    const r = tx.select().from(schema.exercises).where(eq(schema.exercises.id, String(id))).get();
    return !!r && (r.userId === null || r.userId === userId);
  };
  if (table === 'workouts' && !own(TABLES.folders, row.folderId)) return 'unknown_folder';
  if (table === 'workoutItems') {
    if (!own(TABLES.workouts, row.workoutId)) return 'unknown_workout';
    if (!exercise(row.exerciseId)) return 'unknown_exercise';
  }
  if (table === 'sessions' && !own(TABLES.workouts, row.workoutId)) return 'unknown_workout';
  if (table === 'setLogs') {
    if (!own(TABLES.sessions, row.sessionId)) return 'unknown_session';
    if (!exercise(row.exerciseId)) return 'unknown_exercise';
    if (!own(TABLES.workoutItems, row.workoutItemId)) return 'unknown_workout_item';
  }
  return null;
}

function pushChanges(db: Db, userId: string, changes: Record<string, unknown[] | undefined>) {
  const rejected: SyncResponse['rejected'] = [];
  // Rows where the server already had a newer version: sent back so the device converges.
  const bounced: SyncChanges = {};
  let stored = 0;

  db.transaction((tx) => {
    // Parents before children so references resolve within one push.
    for (const table of PUSH_TABLES) {
      for (const raw of changes[table] ?? []) {
        const parsed = wireSchemas[table].safeParse(raw);
        const rawId = String((raw as { id?: unknown })?.id ?? '');
        if (!parsed.success) {
          rejected.push({ table, id: rawId, reason: 'invalid' });
          continue;
        }
        if (table === 'exercises') {
          const result = pushExercise(tx, userId, parsed.data as WireRow<'exercises'>);
          if ('stored' in result) stored++;
          else if ('reason' in result) rejected.push({ table, id: rawId, reason: result.reason });
          else (bounced.exercises ??= []).push(...exercisesToWire(tx, [result.bounce]));
          continue;
        }
        const t = TABLES[table];
        const row = parsed.data as Record<string, unknown> & { id: string; updatedAt: number };
        let existing = getById(tx, t, row.id);
        if (table === 'userSettings') {
          // One row per (user, key): reuse the server id whatever the device sent.
          existing = tx
            .select()
            .from(schema.userSettings)
            .where(and(eq(schema.userSettings.userId, userId), eq(schema.userSettings.key, row.key as 'appearance')))
            .get() as Row | undefined;
          if (existing) row.id = existing.id;
        }
        if (existing && existing.userId !== userId) {
          rejected.push({ table, id: row.id, reason: 'forbidden' });
          continue;
        }
        if (existing && existing.updatedAt > row.updatedAt) {
          (((bounced as Record<string, unknown[]>)[table] ??= []) as unknown[]).push(toWire(table, existing));
          continue;
        }
        const refError = checkRefs(tx, table, row, userId);
        if (refError) {
          rejected.push({ table, id: row.id, reason: refError });
          continue;
        }
        const values: Record<string, unknown> = { ...row, userId, rev: nextRev(tx) };
        if (table === 'setLogs') {
          // Absent optional values must clear what an older version of the set had.
          for (const k of ['reps', 'weightG', 'durationS', 'distanceM']) values[k] ??= null;
        }
        if (existing) tx.update(t).set(values as never).where(eq(t.id, row.id)).run();
        else tx.insert(t).values(values as never).run();
        stored++;
      }
    }
  });

  const rev = currentRev(db);
  if (stored) revEvents.emit('rev', userId, rev);
  return { rejected, bounced, stored };
}

// How many rows a device will still receive after revision `rev`.
function countAfter(db: Db, userId: string, rev: number): number {
  let n = 0;
  for (const table of ROW_TABLES) {
    const t = TABLES[table];
    n += db.select({ n: sql<number>`count(*)` }).from(t).where(and(eq(t.userId, userId), gt(t.rev, rev))).get()?.n ?? 0;
  }
  const ex = schema.exercises;
  n += db.select({ n: sql<number>`count(*)` }).from(ex).where(and(or(isNull(ex.userId), eq(ex.userId, userId)), gt(ex.rev, rev))).get()?.n ?? 0;
  const ov = schema.exerciseOverrides;
  n += db.select({ n: sql<number>`count(*)` }).from(ov).where(and(eq(ov.userId, userId), gt(ov.rev, rev))).get()?.n ?? 0;
  return n;
}

// Rows changed after `since`, at most PAGE_SIZE per table. When a table is truncated, the page
// stops at the lowest "last rev" among truncated tables so no row is skipped across pages.
export function pullChanges(db: Db, userId: string, since: number, pageSize = PAGE_SIZE) {
  const pages: { table: RowTable | 'exercises' | 'exerciseOverrides'; rows: Row[] }[] = [];
  for (const table of ROW_TABLES) {
    const t = TABLES[table];
    const rows = db
      .select()
      .from(t)
      .where(and(eq(t.userId, userId), gt(t.rev, since)))
      .orderBy(asc(t.rev))
      .limit(pageSize)
      .all() as Row[];
    pages.push({ table, rows });
  }
  const ex = schema.exercises;
  pages.push({
    table: 'exercises',
    rows: db
      .select()
      .from(ex)
      .where(and(or(isNull(ex.userId), eq(ex.userId, userId)), gt(ex.rev, since)))
      .orderBy(asc(ex.rev))
      .limit(pageSize)
      .all() as Row[],
  });
  const ov = schema.exerciseOverrides;
  pages.push({
    table: 'exerciseOverrides',
    rows: db
      .select()
      .from(ov)
      .where(and(eq(ov.userId, userId), gt(ov.rev, since)))
      .orderBy(asc(ov.rev))
      .limit(pageSize)
      .all() as Row[],
  });

  const truncated = pages.filter((p) => p.rows.length === pageSize);
  const hasMore = truncated.length > 0;
  const cutoff = hasMore ? Math.min(...truncated.map((p) => p.rows[p.rows.length - 1]!.rev)) : currentRev(db);
  const changes: SyncChanges = {};
  const exerciseIds = new Set<string>();
  for (const p of pages) {
    const rows = p.rows.filter((r) => r.rev <= cutoff);
    if (p.table === 'exercises') rows.forEach((r) => exerciseIds.add(r.id));
    else if (p.table === 'exerciseOverrides') rows.forEach((r) => exerciseIds.add(String(r.exerciseId)));
    else if (rows.length) (changes as Record<string, unknown[]>)[p.table] = rows.map((r) => toWire(p.table as RowTable, r));
  }
  // A changed exercise or a changed override both resend the exercise as this user sees it.
  if (exerciseIds.size) {
    const ids = [...exerciseIds];
    const overrides = overridesFor(db, userId, ids);
    const merged = [];
    for (let i = 0; i < ids.length; i += 500) {
      for (const base of db.select().from(ex).where(inArray(ex.id, ids.slice(i, i + 500))).all()) {
        merged.push(mergeExercise(base, overrides.get(base.id)));
      }
    }
    changes.exercises = exercisesToWire(db, merged);
  }
  return { rev: cutoff, hasMore, remaining: hasMore ? countAfter(db, userId, cutoff) : 0, changes };
}

export function sync(
  db: Db,
  userId: string,
  since: number,
  changes: Record<string, unknown[] | undefined>,
  deviceInstance?: string,
): SyncResponse {
  const instance = instanceId(db);
  // Rows from another database must not be mixed into this one.
  if (deviceInstance && deviceInstance !== instance) return { instance, rev: 0, hasMore: false, remaining: 0, changes: {}, rejected: [] };
  const pushed = pushChanges(db, userId, changes);
  const pulled = pullChanges(db, userId, since);
  for (const [table, rows] of Object.entries(pushed.bounced)) {
    const list = ((pulled.changes as Record<string, unknown[]>)[table] ??= []);
    const ids = new Set(list.map((r) => (r as { id: string }).id));
    for (const r of rows as { id: string }[]) if (!ids.has(r.id)) list.push(r);
  }
  return { instance, rev: pulled.rev, hasMore: pulled.hasMore, remaining: pulled.remaining, changes: pulled.changes, rejected: pushed.rejected };
}
