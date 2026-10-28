// Domain vocabulary shared by the server and the clients.
// Units stored everywhere: grams, metres, seconds; timestamps are epoch milliseconds (UTC).

export const SPORTS = ['strength', 'running', 'cycling', 'cardio', 'other'] as const;
export type Sport = (typeof SPORTS)[number];

export type Metric = 'reps' | 'weight' | 'duration' | 'distance';

// Names of types, muscles, groups and equipment are in the app's language files, by id.
export const EXERCISE_TYPES = {
  weight_reps: { metrics: ['weight', 'reps'] },
  bw_reps: { metrics: ['reps'] },
  weighted_bw: { metrics: ['weight', 'reps'] },
  assisted_bw: { metrics: ['weight', 'reps'] },
  duration: { metrics: ['duration'] },
  duration_weight: { metrics: ['weight', 'duration'] },
  distance_duration: { metrics: ['duration', 'distance'] },
  weight_distance: { metrics: ['weight', 'distance'] },
} as const satisfies Record<string, { metrics: readonly Metric[] }>;
export type ExerciseType = keyof typeof EXERCISE_TYPES;
export const EXERCISE_TYPE_IDS = Object.keys(EXERCISE_TYPES) as ExerciseType[];

// Same granularity as free-exercise-db; the body map groups some of them (lats + middleback).
export const MUSCLE_IDS = [
  'abs',
  'abductors',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'forearms',
  'glutes',
  'hamstrings',
  'lats',
  'lowerback',
  'middleback',
  'neck',
  'quads',
  'shoulders',
  'traps',
  'triceps',
] as const;
export type MuscleId = (typeof MUSCLE_IDS)[number];

// Coarse groups used by the library filters.
export const MUSCLE_GROUPS = [
  { id: 'legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'] },
  { id: 'chest', muscles: ['chest'] },
  { id: 'back', muscles: ['lats', 'middleback', 'lowerback', 'traps'] },
  { id: 'core', muscles: ['abs'] },
  { id: 'arms', muscles: ['biceps', 'triceps', 'forearms'] },
  { id: 'shoulders', muscles: ['shoulders', 'neck'] },
] as const satisfies readonly { id: string; muscles: readonly MuscleId[] }[];

// Equipment as free-exercise-db names it.
export const EQUIPMENT_IDS = [
  'body only',
  'barbell',
  'dumbbell',
  'kettlebells',
  'cable',
  'machine',
  'bands',
  'medicine ball',
  'exercise ball',
  'e-z curl bar',
  'foam roll',
  'other',
] as const;
export type EquipmentId = (typeof EQUIPMENT_IDS)[number];

export const SET_KINDS =['warmup', 'normal', 'drop', 'failure'] as const;
export type SetKind = (typeof SET_KINDS)[number];

// Colours are kept per device. A device with appearance sync turned on follows (and writes) the
// shared "appearance" user setting instead of its local copy.
export interface Appearance {
  theme: 'dark' | 'light' | 'auto';
  accent: string;
  musclePrimary: string;
  muscleSecondary: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'auto',
  accent: '#D4FF3A',
  musclePrimary: '#FF4D2E',
  muscleSecondary: '#FFD166',
};

// Synced per-user settings, stored as JSON values under these keys.
export interface UserSettings {
  appearance: Appearance;
}
export type UserSettingKey = keyof UserSettings;

// One planned set inside a workout item. Simple mode just repeats identical targets.
// A warm-up without weightG (weight_reps, duration_weight, weight_distance) or reps (weight_reps) has it
// worked out from the first working set: from the empty bar (barbell exercises) or 40 %, in even steps
// up to 85 % of the working weight, reps 10 first then 5 up to 60 %, 3 up to 75 %, 2 above
// (client/src/lib/targets.ts, warmupPlan). A value present was typed in and is kept. In a session, a
// warm-up starts from last time's, worked out again only when the working weight went up.
// Seconds to change sides between the two halves of a timed set done one side at a time, unless the
// workout item says otherwise.
export const SWITCH_SIDES_S = 5;

export interface SetTarget {
  kind: SetKind;
  reps?: number;
  weightG?: number;
  durationS?: number;
  distanceM?: number;
  restS?: number;
}
