import type { ExerciseTranslations, ExerciseType, MuscleId, SetKind, SetTarget, Sport } from '@halko/shared';
import Dexie, { type EntityTable } from 'dexie';
import type { ItemMode } from '../lib/targets.ts';

// Local copies mirror the server tables so the sync (phase 4) can push/pull rows as-is.
// `dirty` marks rows changed on this device and not yet pushed; booleans are 0/1 so they can be indexed.
interface SyncedRow {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: 0 | 1;
  dirty: 0 | 1;
}

// Built-in exercises edited here, and custom ones, are pushed like other rows (`dirty`).
export interface LocalExercise {
  id: string;
  source: 'builtin' | 'custom';
  name: string;
  sport: Sport;
  exerciseType: ExerciseType;
  category: string | null;
  level: string | null;
  equipment: string[];
  primaryMuscles: MuscleId[];
  secondaryMuscles: MuscleId[];
  instructions: string[];
  // A built-in exercise this user has not changed: its English text and translations. `name` and
  // `instructions` above hold the text of the language chosen on this device (see exerciseText).
  library?: { en: { name: string; instructions: string[] }; translations: ExerciseTranslations };
  // free-exercise-db id of a built-in exercise.
  sourceRef: string | null;
  mediaIds: string[];
  mediaUrls: string[];
  // Works one side at a time (one arm, one leg, side plank…): its sets are done one side then the other,
  // values per side.
  unilateral: boolean;
  // A built-in exercise this user changed (it can go back to the original).
  customized: boolean;
  createdAt: number;
  updatedAt: number;
  deleted: 0 | 1;
  dirty: 0 | 1;
}

// A folder of workouts (one level; a workout may be in none).
export interface LocalFolder extends SyncedRow {
  name: string;
  position: number;
}

interface LocalWorkout extends SyncedRow {
  // null: in none.
  folderId: string | null;
  sport: Sport;
  name: string;
  note: string | null;
  position: number;
}

export interface LocalWorkoutItem extends SyncedRow {
  workoutId: string;
  exerciseId: string;
  position: number;
  mode: ItemMode;
  supersetGroup: string | null;
  targets: SetTarget[];
  // For a timed exercise working one side at a time: false when done here as a plain set (no sides, no pause
  // to change sides), else side by side with `switchS` seconds to change sides (null: SWITCH_SIDES_S).
  bySide: boolean | null;
  switchS: number | null;
  note: string | null;
}

export interface LocalSession extends SyncedRow {
  workoutId: string | null;
  sport: Sport;
  name: string;
  startedAt: number;
  endedAt: number | null;
  note: string | null;
}

export interface LocalSetLog extends SyncedRow {
  sessionId: string;
  exerciseId: string;
  workoutItemId: string | null;
  // Order of the exercise in the session, and of the set within the exercise (warm-ups included).
  position: number;
  setIndex: number;
  kind: SetKind;
  reps?: number;
  weightG?: number;
  durationS?: number;
  distanceM?: number;
  // The values are per side.
  unilateral?: boolean;
  completedAt: number;
}

interface MetaRow {
  key: string;
  value: unknown;
}

export class HalkoDb extends Dexie {
  exercises!: EntityTable<LocalExercise, 'id'>;
  folders!: EntityTable<LocalFolder, 'id'>;
  workouts!: EntityTable<LocalWorkout, 'id'>;
  workoutItems!: EntityTable<LocalWorkoutItem, 'id'>;
  sessions!: EntityTable<LocalSession, 'id'>;
  setLogs!: EntityTable<LocalSetLog, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'halko') {
    super(name);
    // Earlier versions, and how their data was brought up to date, are in the git history. Version 7 fills
    // the fields rows were missing before they were always sent.
    this.version(7)
      .stores({
        exercises: 'id, name, *primaryMuscles, *secondaryMuscles, source, dirty',
        folders: 'id, position, dirty',
        workouts: 'id, position, deleted, dirty',
        workoutItems: 'id, workoutId, [workoutId+position], exerciseId, dirty',
        sessions: 'id, startedAt, endedAt, dirty',
        setLogs: 'id, sessionId, [exerciseId+completedAt], dirty',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('exercises')
          .toCollection()
          .modify((e: LocalExercise) => {
            e.unilateral ??= false;
            e.sourceRef ??= null;
          });
        await tx
          .table('workouts')
          .toCollection()
          .modify((w: LocalWorkout) => {
            w.folderId ??= null;
          });
        await tx
          .table('workoutItems')
          .toCollection()
          .modify((i: LocalWorkoutItem) => {
            i.bySide ??= null;
            i.switchS ??= null;
          });
      });
  }
}

// Name and instructions of a library exercise in `locale`, or in English when it has no translation.
export function exerciseText(library: NonNullable<LocalExercise['library']>, locale: string): { name: string; instructions: string[] } {
  return library.translations[locale] ?? library.en;
}

export const db = new HalkoDb();
