import { and, eq, isNotNull } from 'drizzle-orm';
import { type Db, nextRev } from '../db/index.ts';
import { exerciseOverrides, exercises, setLogs, workoutItems } from '../db/schema.ts';

// Id of a library exercise: the same on every server, so that an app embedding the library can use it
// before any sync. free-exercise-db ids are letters, digits, `_` and `-`, 58 characters at most.
export function libraryExerciseId(sourceRef: string): string {
  return `lib-${sourceRef}`;
}

// Library exercises imported by an earlier version have a random id. Each one is copied under its fixed id and every
// row pointing at it follows; the old row stays, deleted, with `replacedBy`, for the devices that still use
// it. Idempotent: run on every start. Returns the number of exercises moved.
export function applyLibraryIds(db: Db): number {
  const moved = db
    .select()
    .from(exercises)
    .where(and(eq(exercises.source, 'builtin'), isNotNull(exercises.sourceRef)))
    .all()
    .filter((e) => e.id !== libraryExerciseId(e.sourceRef!));
  if (!moved.length) return 0;
  db.transaction((tx) => {
    const now = Date.now();
    for (const old of moved) {
      const id = libraryExerciseId(old.sourceRef!);
      // Its sourceRef goes first: it is unique among library exercises.
      tx.update(exercises)
        .set({ sourceRef: null, replacedBy: id, deleted: true, updatedAt: Math.max(now, old.updatedAt + 1), rev: nextRev(tx) })
        .where(eq(exercises.id, old.id))
        .run();
      tx.insert(exercises).values({ ...old, id, rev: nextRev(tx) }).run();
      // updatedAt is kept: a device's later edit of one of these rows still wins. Each row gets its own rev,
      // as the pull pages stop on a rev.
      for (const table of [exerciseOverrides, workoutItems, setLogs]) {
        for (const { id: rowId } of tx.select({ id: table.id }).from(table).where(eq(table.exerciseId, old.id)).all()) {
          tx.update(table).set({ exerciseId: id, rev: nextRev(tx) }).where(eq(table.id, rowId)).run();
        }
      }
    }
  });
  return moved.length;
}
