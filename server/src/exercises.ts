import { randomUUID } from 'node:crypto';
import { type WireExercise, type WireRow, mediaUrl, wireSchemas } from '@halko/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { type Db, type Tx, nextRev } from './db/index.ts';
import { exerciseOverrides, exercises, media } from './db/schema.ts';

type ExerciseRow = typeof exercises.$inferSelect;
type OverrideRow = typeof exerciseOverrides.$inferSelect;
type MergedExercise = ExerciseRow & { customized: boolean };

// Fields a user may change on a built-in exercise.
const OVERRIDABLE = ['name', 'exerciseType', 'equipment', 'primaryMuscles', 'secondaryMuscles', 'instructions', 'mediaIds'] as const;
const WIRE_FIELDS = Object.keys(wireSchemas.exercises.shape) as (keyof WireRow<'exercises'>)[];

// The exercise as this user sees it. A deleted override still counts for updatedAt, so devices
// holding the customized version accept the original again.
export function mergeExercise(base: ExerciseRow, override?: OverrideRow): MergedExercise {
  const active = !!override && !override.deleted;
  const merged: MergedExercise = { ...base, updatedAt: Math.max(base.updatedAt, override?.updatedAt ?? 0), customized: active };
  if (active) for (const k of OVERRIDABLE) (merged as Record<string, unknown>)[k] = override[k];
  return merged;
}

export function overridesFor(db: Db | Tx, userId: string, exerciseIds: string[]): Map<string, OverrideRow> {
  if (!exerciseIds.length) return new Map();
  const rows = db
    .select()
    .from(exerciseOverrides)
    .where(and(eq(exerciseOverrides.userId, userId), inArray(exerciseOverrides.exerciseId, exerciseIds)))
    .all();
  return new Map(rows.map((r) => [r.exerciseId, r]));
}

export function exercisesToWire(db: Db | Tx, rows: MergedExercise[]): WireExercise[] {
  const ids = [...new Set(rows.flatMap((r) => r.mediaIds))];
  const mimes = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const m of db.select({ id: media.id, mime: media.mime }).from(media).where(inArray(media.id, ids.slice(i, i + 500))).all()) {
      mimes.set(m.id, m.mime);
    }
  }
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of WIRE_FIELDS) out[k] = r[k];
    out.mediaUrls = r.mediaIds.map((id) => mediaUrl(id, mimes.get(id) ?? 'image/webp'));
    out.customized = r.customized;
    out.translations = r.customized ? {} : r.translations;
    out.sourceRef = r.sourceRef;
    return out as WireExercise;
  });
}

type PushResult = { stored: true } | { reason: string } | { bounce: MergedExercise };

// Stores one pushed exercise: a new or edited custom exercise, or this user's version of a
// built-in one. Last write wins on updatedAt, as for every synced row.
export function pushExercise(tx: Tx, userId: string, row: WireRow<'exercises'>): PushResult {
  if (row.mediaIds.length) {
    const known = tx.select({ id: media.id }).from(media).where(inArray(media.id, row.mediaIds)).all();
    if (known.length !== new Set(row.mediaIds).size) return { reason: 'unknown_media' };
  }
  const base = tx.select().from(exercises).where(eq(exercises.id, row.id)).get();

  if (!base) {
    if (row.source !== 'custom') return { reason: 'unknown_exercise' };
    tx.insert(exercises).values({ ...row, userId, sourceRef: null, rev: nextRev(tx) }).run();
    return { stored: true };
  }

  if (base.userId === null) {
    // Going back to the original is a separate request (resetExercise), not a deletion.
    if (row.deleted) return { reason: 'builtin' };
    const existing = overridesFor(tx, userId, [base.id]).get(base.id);
    if (existing && existing.updatedAt > row.updatedAt) return { bounce: mergeExercise(base, existing) };
    const values = {
      name: row.name,
      exerciseType: row.exerciseType,
      equipment: row.equipment,
      primaryMuscles: row.primaryMuscles,
      secondaryMuscles: row.secondaryMuscles,
      instructions: row.instructions,
      mediaIds: row.mediaIds,
      updatedAt: row.updatedAt,
      deleted: false,
      rev: nextRev(tx),
    };
    if (existing) tx.update(exerciseOverrides).set(values).where(eq(exerciseOverrides.id, existing.id)).run();
    else tx.insert(exerciseOverrides).values({ id: randomUUID(), userId, exerciseId: base.id, createdAt: row.updatedAt, ...values }).run();
    return { stored: true };
  }

  if (base.userId !== userId) return { reason: 'forbidden' };
  if (base.updatedAt > row.updatedAt) return { bounce: mergeExercise(base) };
  const { id: _id, createdAt: _createdAt, source: _source, ...fields } = row;
  tx.update(exercises).set({ ...fields, rev: nextRev(tx) }).where(eq(exercises.id, base.id)).run();
  return { stored: true };
}

// Drops this user's changes to a built-in exercise. Returns false when there were none.
export function resetExercise(db: Db, userId: string, exerciseId: string): boolean {
  return db.transaction((tx) => {
    const existing = overridesFor(tx, userId, [exerciseId]).get(exerciseId);
    if (!existing || existing.deleted) return false;
    tx.update(exerciseOverrides)
      .set({ deleted: true, updatedAt: Math.max(Date.now(), existing.updatedAt + 1), rev: nextRev(tx) })
      .where(eq(exerciseOverrides.id, existing.id))
      .run();
    return true;
  });
}
