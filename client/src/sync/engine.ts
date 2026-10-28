import type { Appearance, PushTable, SyncChanges, SyncResponse, WireExercise } from '@halko/shared';
import { liveQuery } from 'dexie';
import { type HalkoDb, type LocalExercise, db as defaultDb, exerciseText } from '../db/db.ts';
import { currentLocale } from '../lib/i18n.ts';
import { ApiError, api, getToken } from '../lib/api.ts';
import { applySharedAppearance, getAppearance, onAppearanceEdited } from '../lib/appearance.ts';
import { createStore } from '../lib/store.ts';
import { syncSettings } from './settings.ts';
import { newId } from '../lib/id.ts';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export const syncStatus = createStore<{
  state: SyncState;
  lastSyncAt: number | null;
  pending: number;
  rejected: number;
  // Set while a sync receives several pages (first launch: the whole exercise library).
  download: { done: number; total: number } | null;
}>({
  state: 'idle',
  lastSyncAt: null,
  pending: 0,
  rejected: 0,
  download: null,
});

// Local tables pushed as-is (minus local-only fields, with a boolean `deleted`). Parents first.
const TABLES = ['exercises', 'folders', 'workouts', 'workoutItems', 'sessions', 'setLogs'] as const;
const LOCAL_ONLY = new Set(['dirty', 'mediaUrls', 'customized', 'library', 'sourceRef']);
type LocalTable = (typeof TABLES)[number];

interface SharedAppearance {
  id: string;
  value: Appearance;
  createdAt: number;
  updatedAt: number;
}

type Snapshot = Map<string, number>; // "table:id" -> updatedAt pushed

const meta = async <T>(db: HalkoDb, key: string) => (await db.meta.get(key))?.value as T | undefined;

async function countPending(db: HalkoDb = defaultDb): Promise<number> {
  let n = 0;
  for (const t of TABLES) n += await db[t].where('dirty').equals(1).count();
  if (syncSettings.get().shareAppearance && (await meta<number>(db, 'appearanceDirtyAt'))) n++;
  return n;
}

export async function collectChanges(db: HalkoDb): Promise<{ changes: SyncChanges; snapshot: Snapshot }> {
  const changes: Record<string, unknown[]> = {};
  const snapshot: Snapshot = new Map();
  for (const t of TABLES) {
    const rows = await db[t].where('dirty').equals(1).toArray();
    if (!rows.length) continue;
    changes[t] = rows.map((row) => ({
      ...Object.fromEntries(Object.entries(row).filter(([k]) => !LOCAL_ONLY.has(k))),
      deleted: row.deleted === 1,
    }));
    for (const r of rows) snapshot.set(`${t}:${r.id}`, r.updatedAt);
  }
  const dirtyAt = await meta<number>(db, 'appearanceDirtyAt');
  if (syncSettings.get().shareAppearance && dirtyAt) {
    const shared = await meta<SharedAppearance>(db, 'sharedAppearance');
    changes.userSettings = [
      {
        id: shared?.id ?? newId(),
        key: 'appearance',
        value: getAppearance(),
        createdAt: shared?.createdAt ?? dirtyAt,
        updatedAt: dirtyAt,
        deleted: false,
      },
    ];
    snapshot.set('userSettings:appearance', dirtyAt);
  }
  return { changes: changes as SyncChanges, snapshot };
}

function toLocalExercise(e: WireExercise): LocalExercise {
  const library = e.source === 'builtin' && !e.customized ? { en: { name: e.name, instructions: e.instructions }, translations: e.translations } : undefined;
  return {
    id: e.id,
    source: e.source,
    ...(library ? { ...exerciseText(library, currentLocale()), library } : { name: e.name, instructions: e.instructions }),
    sport: e.sport,
    exerciseType: e.exerciseType,
    category: e.category,
    level: e.level,
    equipment: e.equipment,
    primaryMuscles: e.primaryMuscles,
    secondaryMuscles: e.secondaryMuscles,
    mediaIds: e.mediaIds,
    mediaUrls: e.mediaUrls,
    unilateral: e.unilateral,
    customized: e.customized,
    sourceRef: e.sourceRef,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    deleted: e.deleted ? 1 : 0,
    dirty: 0,
  };
}

// Server rows overwrite local ones unless the local copy was edited later and not pushed yet.
export async function applyChanges(db: HalkoDb, changes: SyncChanges): Promise<void> {
  let shared: SharedAppearance | undefined;
  await db.transaction('rw', [db.folders, db.workouts, db.workoutItems, db.sessions, db.setLogs, db.exercises, db.meta], async () => {
    for (const t of TABLES) {
      if (t === 'exercises') continue;
      const rows = (changes[t] ?? []) as { id: string; updatedAt: number; deleted: boolean }[];
      for (const row of rows) {
        const local = await db[t].get(row.id);
        if (local?.dirty && local.updatedAt > row.updatedAt) continue;
        await (db[t] as unknown as { put: (r: unknown) => Promise<unknown> }).put({ ...row, deleted: row.deleted ? 1 : 0, dirty: 0 });
      }
    }
    // Deleted exercises are kept (hidden from the library) so past sessions still show their name.
    for (const e of changes.exercises ?? []) {
      const local = await db.exercises.get(e.id);
      if (local?.dirty && local.updatedAt > e.updatedAt) continue;
      await db.exercises.put(toLocalExercise(e));
    }
    const setting = changes.userSettings?.find((s) => s.key === 'appearance');
    if (setting) {
      shared = { id: setting.id, value: setting.value as Appearance, createdAt: setting.createdAt, updatedAt: setting.updatedAt };
      await db.meta.put({ key: 'sharedAppearance', value: shared });
      const dirtyAt = await meta<number>(db, 'appearanceDirtyAt');
      if (dirtyAt && dirtyAt <= setting.updatedAt) await db.meta.delete('appearanceDirtyAt');
      else if (dirtyAt) shared = undefined; // a newer local edit is waiting to be pushed
    }
  });
  if (shared && syncSettings.get().shareAppearance) applySharedAppearance(shared.value);
}

// Pushed rows are clean again unless they were edited while the request was in flight.
export async function markPushed(db: HalkoDb, snapshot: Snapshot, rejected: SyncResponse['rejected']): Promise<void> {
  const refused = new Set(rejected.map((r) => `${r.table}:${r.id}`));
  await db.transaction('rw', [db.exercises, db.folders, db.workouts, db.workoutItems, db.sessions, db.setLogs, db.meta], async () => {
    for (const [key, updatedAt] of snapshot) {
      if (refused.has(key)) continue;
      const [table, id] = key.split(':') as [PushTable, string];
      if (table === 'userSettings') {
        if ((await meta<number>(db, 'appearanceDirtyAt')) === updatedAt) await db.meta.delete('appearanceDirtyAt');
        continue;
      }
      const t = db[table as LocalTable];
      const row = await t.get(id);
      if (row && row.updatedAt === updatedAt) await t.update(id, { dirty: 0 });
    }
  });
}

// The server's data was replaced (another install, a copy of another server): its rows have other ids,
// so everything local is dropped and downloaded again rather than mixed with the new data.
async function resetLocalData(db: HalkoDb): Promise<void> {
  await db.transaction('rw', [...TABLES.map((t) => db[t]), db.meta], async () => {
    for (const t of TABLES) await db[t].clear();
    await db.meta.clear();
  });
}

let running: Promise<void> | null = null;
let again = false;

async function run(db: HalkoDb): Promise<void> {
  try {
    syncStatus.set({ state: 'syncing' });
    let rejected = 0;
    let first = true;
    let received = 0;
    for (;;) {
      const since = (await meta<number>(db, 'syncRev')) ?? 0;
      const instance = await meta<string>(db, 'serverInstance');
      const { changes, snapshot } = first ? await collectChanges(db) : { changes: {}, snapshot: new Map() as Snapshot };
      const res = await api<SyncResponse>('/sync', { method: 'POST', body: JSON.stringify({ since, instance, changes }) });
      if (res.instance !== instance) {
        // First sync of this device: the server stored the changes, carry on. Otherwise start over.
        if (instance !== undefined) await resetLocalData(db);
        await db.meta.put({ key: 'serverInstance', value: res.instance });
        if (instance !== undefined) continue;
      }
      await applyChanges(db, res.changes);
      await markPushed(db, snapshot, res.rejected);
      await db.meta.put({ key: 'syncRev', value: res.rev });
      rejected += res.rejected.length;
      first = false;
      received += Object.values(res.changes).reduce((n, rows) => n + (rows?.length ?? 0), 0);
      if (!res.hasMore) break;
      syncStatus.set({ download: { done: received, total: received + res.remaining } });
    }
    syncStatus.set({ state: 'synced', lastSyncAt: Date.now(), pending: await countPending(db), rejected, download: null });
  } catch (err) {
    // A proxy in front of a stopped server answers 502-504: that is "unreachable", not a sync error.
    const failed = err instanceof ApiError && (err.status < 502 || err.status > 504);
    syncStatus.set({ state: failed ? 'error' : 'offline', pending: await countPending(db), download: null });
  }
}

export function syncNow({ db = defaultDb }: { db?: HalkoDb } = {}): Promise<void> {
  if (!getToken()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = run(db).finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow({ db });
    }
  });
  return running;
}

let debounce: ReturnType<typeof setTimeout> | undefined;
export function requestSync(delayMs = 1200): void {
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), delayMs);
}

// Live updates: reads the server's event stream and syncs when another device changed something.
async function listenEvents(signal: AbortSignal, db: HalkoDb): Promise<void> {
  const res = await fetch('/api/v1/events', { headers: { authorization: `Bearer ${getToken()}` }, signal });
  if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const messages = buffer.split('\n\n');
    buffer = messages.pop() ?? '';
    for (const m of messages) {
      const data = m.split('\n').find((l) => l.startsWith('data: '));
      if (!data) continue;
      const message = JSON.parse(data.slice(6)) as { rev?: number };
      if (message.rev !== undefined && message.rev > ((await meta<number>(db, 'syncRev')) ?? 0)) requestSync(300);
    }
  }
}

// Starts automatic sync for the app's lifetime; returns a stop function.
export function startSync(db: HalkoDb = defaultDb): () => void {
  let stopped = false;
  let stream: AbortController | null = null;
  let streaming = false;

  const connect = async () => {
    let backoff = 5_000;
    while (!stopped && document.visibilityState === 'visible') {
      if (!navigator.onLine) {
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      stream = new AbortController();
      try {
        streaming = true;
        await listenEvents(stream.signal, db);
        backoff = 5_000;
      } catch {
        backoff = Math.min(backoff * 2, 60_000);
      } finally {
        streaming = false;
      }
      if (!stopped) await new Promise((r) => setTimeout(r, backoff));
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      void syncNow();
      if (!streaming) void connect();
    } else {
      stream?.abort();
    }
  };
  const onOnline = () => void syncNow();

  // Local edits mark rows dirty: push them shortly after (debounced).
  let lastPending = -1;
  const pendingSub = liveQuery(() => countPending(db)).subscribe((n) => {
    syncStatus.set({ pending: n });
    if (n > lastPending && lastPending !== -1) requestSync();
    lastPending = n;
  });
  const stopEdits = onAppearanceEdited(() => {
    if (!syncSettings.get().shareAppearance) return;
    void db.meta.put({ key: 'appearanceDirtyAt', value: Date.now() }).then(() => requestSync());
  });
  const stopSettings = syncSettings.subscribe(() => requestSync(300));
  // Safety net when the event stream is not available.
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && !streaming) void syncNow();
  }, 30_000);

  // Ask the browser not to evict the local data (it may clear unprotected storage when space runs low).
  void navigator.storage?.persist?.().catch(() => false);

  document.addEventListener('visibilitychange', onVisible);
  addEventListener('online', onOnline);
  void syncNow();
  void connect();

  return () => {
    stopped = true;
    stream?.abort();
    clearInterval(poll);
    pendingSub.unsubscribe();
    stopEdits();
    stopSettings();
    document.removeEventListener('visibilitychange', onVisible);
    removeEventListener('online', onOnline);
  };
}

// Turning on "same colours on all devices": adopt the shared appearance if there is one,
// otherwise this device's colours become the shared ones.
export async function enableSharedAppearance(db: HalkoDb = defaultDb): Promise<void> {
  syncSettings.set({ shareAppearance: true });
  const shared = await meta<SharedAppearance>(db, 'sharedAppearance');
  if (shared) applySharedAppearance(shared.value);
  else await db.meta.put({ key: 'appearanceDirtyAt', value: Date.now() });
  await syncNow({ db });
}
