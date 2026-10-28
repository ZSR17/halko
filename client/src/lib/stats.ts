import type { ExerciseType } from '@halko/shared';
import type { LocalSession, LocalSetLog } from '../db/db.ts';
import { formatNumber } from './i18n.ts';
import { setVolumeG } from './session.ts';
import { LB_G, weightUnit } from './format.ts';

export function sessionVolumeG(logs: LocalSetLog[], types: Map<string, ExerciseType>): number {
  return logs
    .filter((l) => l.kind !== 'warmup')
    .reduce((n, l) => n + setVolumeG(types.get(l.exerciseId) ?? 'weight_reps', l), 0);
}

export function sessionDurationMs(s: LocalSession): number {
  return (s.endedAt ?? s.startedAt) - s.startedAt;
}

// Monday 00:00 of the current week, local time.
export function startOfWeek(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function formatTonnage(grams: number): string {
  if (grams <= 0) return '—';
  const kg = grams / 1000;
  if (weightUnit() === 'lb') return `${formatNumber(Math.round(grams / LB_G))} lb`;
  return kg >= 10000 ? `${formatNumber(kg / 1000, 1)} t` : `${formatNumber(Math.round(kg))} kg`;
}

export function formatMinutes(ms: number): string {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}
