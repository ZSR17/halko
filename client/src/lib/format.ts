// Display / input helpers. Storage units are grams, seconds and metres (see shared/domain.ts).
import { EXERCISE_TYPES, type ExerciseType } from '@halko/shared';
import { formatNumber, prefs, t } from './i18n.ts';

function trimNumber(n: number, decimals: number): string {
  return formatNumber(Number(n.toFixed(decimals)), decimals);
}

function parseDecimal(input: string): number | null {
  const n = Number(input.trim().replace(',', '.'));
  return input.trim() === '' || Number.isNaN(n) ? null : n;
}

// Weights are stored in grams and distances in metres; they are shown and typed in the units chosen
// on the device (kg or lb, km or mi).
export const LB_G = 453.59237;
const MI_M = 1609.344;
const YD_M = 0.9144;

export const weightUnit = () => prefs.get().weight;
export const distanceUnit = () => prefs.get().distance;
// Grams in one unit of weight, metres in one unit of distance.
export const weightScale = () => (weightUnit() === 'lb' ? LB_G : 1000);
export const distanceScale = () => (distanceUnit() === 'mi' ? MI_M : 1000);

// "82.5" (kg) or "181.88" (lb): the number alone.
export function formatWeight(grams: number | undefined): string {
  return grams === undefined ? '' : trimNumber(grams / weightScale(), 2);
}

export function parseWeight(input: string): number | null {
  const n = parseDecimal(input);
  return n === null || n < 0 ? null : Math.round(n * weightScale());
}

// "82.5 kg", "45 lb".
export const weightText = (grams: number) => `${formatWeight(grams)} ${weightUnit()}`;

// One press of − / +: 0.5 kg or 2.5 lb.
export const weightStep = () => (weightUnit() === 'lb' ? Math.round(2.5 * LB_G) : 500);

// `grams` rounded to `step` of the chosen unit (0.1 kg or 0.1 lb…).
export const roundWeight = (grams: number, step: number) => Math.round(Math.round(grams / weightScale() / step) * step * weightScale());

// A default load that reads well in the chosen unit: 20 kg stays 20 kg, but becomes 45 lb rather than 44.09.
export const niceWeight = (grams: number) => (weightUnit() === 'lb' ? roundWeight(grams, 5) : grams);

export function formatDist(metres: number | undefined): string {
  return metres === undefined ? '' : trimNumber(metres / distanceScale(), 2);
}

export function parseDist(input: string): number | null {
  const n = parseDecimal(input);
  return n === null || n < 0 ? null : Math.round(n * distanceScale());
}

// 75 -> "1:15", 3725 -> "1:02:05"
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// "1:30" or, typed like a timer keypad without the colon: up to 2 digits are seconds ("25", "90"),
// beyond that the last two digits are the seconds ("130" = 1:30, "1000" = 10:00, "13000" = 1:30:00).
export function parseDuration(input: string): number | null {
  const text = input.trim();
  const parts = /^\d{3,6}$/.test(text) ? text.padStart(6, '0').match(/\d\d/g)! : text.split(':');
  if (parts.some((p) => !/^\d+$/.test(p)) || parts.length > 3) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

// Short distances (carries, sled) read better in metres, or yards.
export function distanceText(metres: number | undefined): string {
  if (metres === undefined) return '';
  if (distanceUnit() === 'mi') return metres < MI_M ? `${Math.round(metres / YD_M)} yd` : `${formatDist(metres)} mi`;
  return metres < 1000 ? `${Math.round(metres)} m` : `${formatDist(metres)} km`;
}

// "80 kg × 8", "+10 kg × 6", "12 reps", "1:00", "5.2 km · 25:00", "24 kg · 40 m"; "… each side" for a set
// done one side at a time.
export function formatSetValues(
  type: ExerciseType,
  v: { reps?: number; weightG?: number; durationS?: number; distanceM?: number; unilateral?: boolean },
): string {
  const text = valuesText(type, v);
  return v.unilateral ? t('unit.perSide', { values: text }) : text;
}

function valuesText(type: ExerciseType, v: { reps?: number; weightG?: number; durationS?: number; distanceM?: number }): string {
  const metrics = EXERCISE_TYPES[type].metrics as readonly string[];
  const sign = type === 'weighted_bw' ? '+' : type === 'assisted_bw' ? '−' : '';
  const weight = metrics.includes('weight') && v.weightG !== undefined ? `${sign}${weightText(v.weightG)}` : null;
  if (metrics.includes('reps')) return weight ? `${weight} × ${v.reps ?? 0}` : t('unit.reps', { count: v.reps ?? 0 });
  return [
    weight,
    metrics.includes('distance') ? distanceText(v.distanceM) : null,
    metrics.includes('duration') ? formatDuration(v.durationS) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function parseCount(input: string): number | null {
  return /^\d+$/.test(input.trim()) ? Number(input.trim()) : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return t('unit.kb', { n: formatNumber(Math.max(1, Math.round(bytes / 1024))) });
  if (bytes < 1024 ** 3) return t('unit.mb', { n: formatNumber(bytes / 1024 ** 2, bytes < 10 * 1024 ** 2 ? 1 : 0) });
  return t('unit.gb', { n: formatNumber(bytes / 1024 ** 3, 1) });
}
