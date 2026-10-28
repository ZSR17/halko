import { createStore } from './store.ts';

// One-rep max estimates from a set of `reps` at `w` (any unit). Most of them assume a set taken close to failure.
export const FORMULAS = {
  brzycki: { label: 'Brzycki', estimate: (w: number, reps: number) => (w * 36) / (37 - reps) },
  epley: { label: 'Epley', estimate: (w: number, reps: number) => w * (1 + reps / 30) },
  mcglothin: { label: 'McGlothin', estimate: (w: number, reps: number) => (100 * w) / (101.3 - 2.67123 * reps) },
  lombardi: { label: 'Lombardi', estimate: (w: number, reps: number) => w * reps ** 0.1 },
  mayhew: { label: 'Mayhew', estimate: (w: number, reps: number) => (100 * w) / (52.2 + 41.9 * Math.exp(-0.055 * reps)) },
  oconner: { label: 'O’Conner', estimate: (w: number, reps: number) => w * (1 + 0.025 * reps) },
  wathen: { label: 'Wathen', estimate: (w: number, reps: number) => (100 * w) / (48.8 + 53.8 * Math.exp(-0.075 * reps)) },
} as const;

export type Formula = keyof typeof FORMULAS;

// Brzycki divides by (37 - reps): past this, its estimate is meaningless.
export const MAX_REPS = 30;

export const PERCENTAGES = [100, 95, 90, 85, 80, 75, 70, 65, 60, 50];

// The set entered (or the exercise it comes from) is kept too: it is still there when the page is reopened.
export const oneRmSettings = createStore<{ formula: Formula; exerciseId: string; weightG?: number; reps?: number; reserve: number }>(
  { formula: 'brzycki', exerciseId: '', reserve: 0 },
  'halko.oneRm',
);

// A single rep is the max itself, whatever the formula.
export function oneRepMax(weightG: number, reps: number, formula: Formula): number {
  return reps <= 1 ? weightG : Math.round(FORMULAS[formula].estimate(weightG, Math.min(reps, MAX_REPS)));
}

// Reps the formula expects at `percent` of the max, rounded down (those can be done), or null past MAX_REPS.
export function repsAt(percent: number, formula: Formula): number | null {
  if (percent >= 100) return 1;
  const ratio = 100 / percent;
  const estimate = FORMULAS[formula].estimate;
  if (estimate(1, MAX_REPS) < ratio) return null;
  let low = 1;
  let high = MAX_REPS;
  while (high - low > 0.001) {
    const mid = (low + high) / 2;
    if (estimate(1, mid) < ratio) low = mid;
    else high = mid;
  }
  return Math.max(1, Math.floor(high + 1e-6));
}
