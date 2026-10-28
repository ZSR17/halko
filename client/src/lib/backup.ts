import { type HalkoDb, db as defaultDb } from '../db/db.ts';
import { t } from './i18n.ts';

// Safety-net export of everything the user created: workouts, history, custom exercises and
// their versions of built-in ones. Media files stay on the server (only their references are kept).
const TABLES = ['exercises', 'folders', 'workouts', 'workoutItems', 'sessions', 'setLogs'] as const;
type Table = (typeof TABLES)[number];

interface Backup {
  app: 'halko';
  version: 1;
  exportedAt: number;
  tables: Record<Table, Record<string, unknown>[]>;
}

export async function exportData(db: HalkoDb = defaultDb): Promise<Backup> {
  const tables = {} as Backup['tables'];
  for (const t of TABLES) {
    let rows: { dirty?: number; source?: string; customized?: boolean }[] = await db[t].toArray();
    if (t === 'exercises') rows = rows.filter((e) => e.source === 'custom' || e.customized);
    tables[t] = rows.map(({ dirty: _dirty, ...row }) => row);
  }
  return { app: 'halko', version: 1, exportedAt: Date.now(), tables };
}

const jsonBlob = (data: unknown) => new Blob([JSON.stringify(data)], { type: 'application/json' });

function downloadJson(data: unknown, fileName: string): void {
  const url = URL.createObjectURL(jsonBlob(data));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The « Save as » dialog of Chrome and Edge (File System Access API), not in the DOM types yet.
interface SavePicker {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
}

// Where to save a JSON file: asked with the system's « Save as » dialog where the browser has one (Chrome,
// Edge), else it goes to the downloads. Called first thing on the click, while a dialog is still allowed,
// before the content is made. Resolves with the function writing it there, or null when cancelled.
export async function saveJsonAs(fileName: string): Promise<((data: unknown) => Promise<void>) | null> {
  const w = window as SavePicker;
  if (!w.showSaveFilePicker) return async (data) => downloadJson(data, fileName);
  try {
    const file = await w.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
    return async (data) => {
      const out = await file.createWritable();
      await out.write(jsonBlob(data));
      await out.close();
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

export const backupFileName = () => `halko-${new Date().toISOString().slice(0, 10)}.json`;

export class BackupError extends Error {}

// Fields added after the first exports, with the value rows made before them have.
const ADDED_SINCE: Partial<Record<(typeof TABLES)[number], object>> = {
  exercises: { unilateral: false, sourceRef: null },
  workouts: { folderId: null },
  workoutItems: { bySide: null, switchS: null },
};

// Merges an export into this device: rows missing or older here are taken, then synced as usual
// (the server keeps the most recent version of each row).
export async function importData(data: unknown, db: HalkoDb = defaultDb): Promise<{ imported: number; skipped: number }> {
  const backup = data as Partial<Backup> | null;
  if (backup?.app !== 'halko' || backup?.version !== 1 || typeof backup.tables !== 'object') {
    throw new BackupError(t('settings.notExport'));
  }
  let imported = 0;
  let skipped = 0;
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) {
      const rows = backup.tables![t];
      if (!Array.isArray(rows)) continue;
      for (const row of rows as { id?: unknown; updatedAt?: unknown }[]) {
        if (typeof row?.id !== 'string' || typeof row.updatedAt !== 'number') {
          skipped++;
          continue;
        }
        const local = await db[t].get(row.id);
        if (local && local.updatedAt >= row.updatedAt) {
          skipped++;
          continue;
        }
        await (db[t] as unknown as { put: (r: unknown) => Promise<unknown> }).put({ ...ADDED_SINCE[t], ...row, dirty: 1 });
        imported++;
      }
    }
  });
  return { imported, skipped };
}
