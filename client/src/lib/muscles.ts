import type { MuscleId } from '@halko/shared';

// Body-map regions (react-native-body-highlighter slugs) -> our muscle ids.
// Regions not listed (head, hands, knees…) are drawn as plain body.
const REGION_MUSCLES: Record<string, readonly MuscleId[]> = {
  chest: ['chest'],
  abs: ['abs'],
  obliques: ['abs'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearm: ['forearms'],
  deltoids: ['shoulders'],
  trapezius: ['traps'],
  neck: ['neck'],
  'upper-back': ['lats', 'middleback'],
  'lower-back': ['lowerback'],
  gluteal: ['glutes', 'abductors'],
  adductors: ['adductors'],
  quadriceps: ['quads'],
  hamstring: ['hamstrings'],
  calves: ['calves'],
  tibialis: [],
};

// Muscles a region of the body map stands for (none for head, hands, knees…).
export const regionMuscles = (region: string): readonly MuscleId[] => REGION_MUSCLES[region] ?? [];

// Areas as the body map draws them: muscles of one region count as one (upper back: lats and middle
// back; glutes and abductors), and two regions with the same muscles as one (abs and obliques).
const AREAS = [...new Set(Object.values(REGION_MUSCLES).filter((m) => m.length).map((m) => m.join('+')))];
const areasOf = (muscles: readonly MuscleId[]) => new Set(muscles.map((m) => AREAS.find((a) => a.split('+').includes(m))!));

// Muscles picked on the body map, as main or secondary muscles.
export interface MuscleProfile {
  primary: readonly MuscleId[];
  secondary: readonly MuscleId[];
}

// Whether an exercise works the muscles picked on the body map in the roles picked (main or secondary), area
// by area as the map draws them; it may work others too. An area that is a main muscle of the exercise does
// not count as a secondary one.
export function worksAsPicked(picked: MuscleProfile, exercise: MuscleProfile): boolean {
  const primary = areasOf(exercise.primary);
  const secondary = new Set([...areasOf(exercise.secondary)].filter((a) => !primary.has(a)));
  return [...areasOf(picked.primary)].every((a) => primary.has(a)) && [...areasOf(picked.secondary)].every((a) => secondary.has(a));
}

export type RegionState = 'primary' | 'secondary' | 'idle' | 'body';

export function regionState(region: string, primary: readonly string[], secondary: readonly string[]): RegionState {
  const muscles = REGION_MUSCLES[region];
  if (!muscles) return 'body';
  if (muscles.some((m) => primary.includes(m))) return 'primary';
  if (muscles.some((m) => secondary.includes(m))) return 'secondary';
  return 'idle';
}
