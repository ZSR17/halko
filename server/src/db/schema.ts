import type { ExerciseTranslations, ExerciseType, MuscleId, SetKind, SetTarget, Sport, UserSettingKey } from '@halko/shared';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Columns every synced table carries: last-write-wins on updatedAt, incremental pull on rev,
// tombstones instead of hard deletes so other devices learn about deletions.
const synced = {
  updatedAt: integer('updated_at').notNull(),
  rev: integer('rev').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
};

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('devices_token_hash').on(t.tokenHash)],
);

// Settings shared by all of a user's devices (device-only preferences never reach the server).
export const userSettings = sqliteTable(
  'user_settings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    key: text('key').$type<UserSettingKey>().notNull(),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
    createdAt: integer('created_at').notNull(),
    ...synced,
  },
  (t) => [uniqueIndex('user_settings_key').on(t.userId, t.key), index('user_settings_rev').on(t.rev)],
);

// Files are content-addressed: id is the sha256 of the stored (already compressed) bytes.
export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at').notNull(),
});

export const exercises = sqliteTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    // null for the built-in library shared by every user.
    userId: text('user_id').references(() => users.id),
    source: text('source', { enum: ['builtin', 'custom'] }).notNull(),
    sourceRef: text('source_ref'),
    name: text('name').notNull(),
    sport: text('sport').$type<Sport>().notNull(),
    exerciseType: text('exercise_type').$type<ExerciseType>().notNull(),
    category: text('category'),
    level: text('level'),
    equipment: text('equipment', { mode: 'json' }).$type<string[]>().notNull(),
    primaryMuscles: text('primary_muscles', { mode: 'json' }).$type<MuscleId[]>().notNull(),
    secondaryMuscles: text('secondary_muscles', { mode: 'json' }).$type<MuscleId[]>().notNull(),
    instructions: text('instructions', { mode: 'json' }).$type<string[]>().notNull(),
    // Built-in exercises: name and instructions in other languages (name and instructions are English).
    translations: text('translations', { mode: 'json' }).$type<ExerciseTranslations>().notNull().default({}),
    mediaIds: text('media_ids', { mode: 'json' }).$type<string[]>().notNull(),
    // Works one side at a time (one arm, one leg, side plank…): its sets are done side by side, values per side.
    unilateral: integer('unilateral', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    ...synced,
  },
  (t) => [uniqueIndex('exercises_source_ref').on(t.source, t.sourceRef), index('exercises_rev').on(t.rev)],
);

// A user's version of a built-in exercise (renamed, muscles fixed, own video...). The shared
// library row stays as imported; deleting the override brings the original back.
export const exerciseOverrides = sqliteTable(
  'exercise_overrides',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    exerciseId: text('exercise_id').notNull().references(() => exercises.id),
    name: text('name').notNull(),
    exerciseType: text('exercise_type').$type<ExerciseType>().notNull(),
    equipment: text('equipment', { mode: 'json' }).$type<string[]>().notNull(),
    primaryMuscles: text('primary_muscles', { mode: 'json' }).$type<MuscleId[]>().notNull(),
    secondaryMuscles: text('secondary_muscles', { mode: 'json' }).$type<MuscleId[]>().notNull(),
    instructions: text('instructions', { mode: 'json' }).$type<string[]>().notNull(),
    mediaIds: text('media_ids', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: integer('created_at').notNull(),
    ...synced,
  },
  (t) => [uniqueIndex('exercise_overrides_user').on(t.userId, t.exerciseId), index('exercise_overrides_rev').on(t.rev)],
);

// Folders the user sorts workouts into (one level, optional: a workout may be in none).
export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    ...synced,
  },
  (t) => [index('folders_rev').on(t.rev)],
);

export const workouts = sqliteTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    folderId: text('folder_id').references(() => folders.id),
    sport: text('sport').$type<Sport>().notNull(),
    name: text('name').notNull(),
    note: text('note'),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    ...synced,
  },
  (t) => [index('workouts_rev').on(t.rev)],
);

export const workoutItems = sqliteTable(
  'workout_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    workoutId: text('workout_id').notNull().references(() => workouts.id),
    exerciseId: text('exercise_id').notNull().references(() => exercises.id),
    position: integer('position').notNull(),
    mode: text('mode', { enum: ['simple', 'per_set'] }).notNull(),
    // Items sharing a group id form a superset; rest applies after the last one.
    supersetGroup: text('superset_group'),
    targets: text('targets', { mode: 'json' }).$type<SetTarget[]>().notNull(),
    // An exercise working one side at a time done here as a plain set (false), or side by side (null).
    bySide: integer('by_side', { mode: 'boolean' }),
    // Seconds to change sides between the two halves of a timed set (null: the default).
    switchS: integer('switch_s'),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
    ...synced,
  },
  (t) => [index('workout_items_workout').on(t.workoutId), index('workout_items_rev').on(t.rev)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    workoutId: text('workout_id').references(() => workouts.id),
    sport: text('sport').$type<Sport>().notNull(),
    name: text('name').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
    ...synced,
  },
  (t) => [index('sessions_started').on(t.userId, t.startedAt), index('sessions_rev').on(t.rev)],
);

export const setLogs = sqliteTable(
  'set_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    sessionId: text('session_id').notNull().references(() => sessions.id),
    exerciseId: text('exercise_id').notNull().references(() => exercises.id),
    workoutItemId: text('workout_item_id').references(() => workoutItems.id),
    position: integer('position').notNull(),
    setIndex: integer('set_index').notNull(),
    kind: text('kind').$type<SetKind>().notNull(),
    reps: integer('reps'),
    // Assisted exercises store the assistance as a positive weight; the exercise type gives the sign.
    weightG: integer('weight_g'),
    durationS: real('duration_s'),
    distanceM: real('distance_m'),
    // Copied from the workout item when the set was done: its values are per side.
    unilateral: integer('unilateral', { mode: 'boolean' }).notNull().default(false),
    rpe: real('rpe'),
    note: text('note'),
    completedAt: integer('completed_at').notNull(),
    createdAt: integer('created_at').notNull(),
    ...synced,
  },
  (t) => [
    index('set_logs_session').on(t.sessionId),
    index('set_logs_exercise').on(t.userId, t.exerciseId, t.completedAt),
    index('set_logs_rev').on(t.rev),
  ],
);
