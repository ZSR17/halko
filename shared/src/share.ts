import { z } from 'zod';
import { EXERCISE_TYPE_IDS, type ExerciseType, MUSCLE_IDS } from './domain.ts';
import { setTarget, wireSchemas } from './sync.ts';

// A workout shared as a file, to be imported on another server: its exercises are named in a way every
// server understands (a library exercise by its free-exercise-db id, a custom one by its whole content).

const exercise = wireSchemas.exercises.shape;

// A photo (WebP) or a video (MP4), in base64. A video comes without its poster image: the importing
// server makes it again.
const sharedMedia = z.object({ mime: z.enum(['image/webp', 'video/mp4']), data: z.string().min(1) });

const sharedExercise = z.union([
  // `name` is only there to talk about it (the library may be missing on the importing device).
  z.object({ ref: z.string().min(1).max(200), name: z.string().max(200) }),
  z.object({
    custom: z.object({
      name: exercise.name,
      exerciseType: z.enum(EXERCISE_TYPE_IDS as [ExerciseType, ...ExerciseType[]]),
      equipment: exercise.equipment,
      primaryMuscles: z.array(z.enum(MUSCLE_IDS)).max(17),
      secondaryMuscles: z.array(z.enum(MUSCLE_IDS)).max(17),
      instructions: exercise.instructions,
      media: z.array(sharedMedia).max(10).optional(),
    }),
  }),
]);

export const sharedWorkoutSchema = z.object({
  app: z.literal('halko'),
  kind: z.literal('workout'),
  version: z.literal(1),
  exportedAt: z.number().int().nonnegative(),
  workout: z.object({
    name: z.string().trim().min(1).max(200),
    note: z.string().max(5000).nullable(),
    items: z
      .array(
        z.object({
          // Index in `exercises`.
          exercise: z.number().int().nonnegative(),
          mode: z.enum(['simple', 'per_set']),
          // Items with the same letter are a superset.
          superset: z.string().max(10).nullable(),
          targets: z.array(setTarget).max(100),
          bySide: z.boolean().nullable().optional(),
          switchS: z.number().int().nonnegative().max(600).nullable().optional(),
          note: z.string().max(5000).nullable(),
        }),
      )
      .max(200),
  }),
  exercises: z.array(sharedExercise).max(200),
});

export type SharedWorkout = z.infer<typeof sharedWorkoutSchema>;
export type SharedExercise = SharedWorkout['exercises'][number];
