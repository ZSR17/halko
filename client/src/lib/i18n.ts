import type { EquipmentId, ExerciseType, MuscleId } from '@halko/shared';
import { FALLBACK_LOCALE, type Locale, type MessageKey, matchLocale, translate } from '@halko/shared/i18n';
import { createStore } from './store.ts';
import { EQUIPMENT_IDS } from '@halko/shared';

export type WeightUnit = 'kg' | 'lb';
export type DistanceUnit = 'km' | 'mi';

// Language and units of this device. `locale` is null until chosen on the first launch.
export const prefs = createStore<{ locale: Locale | null; weight: WeightUnit; distance: DistanceUnit }>(
  { locale: null, weight: 'kg', distance: 'km' },
  'halko.prefs',
);

// The browser's language if the app has it, else English: offered on the first launch.
export const browserLocale = (): Locale => matchLocale(navigator.languages ?? [navigator.language]) ?? FALLBACK_LOCALE;

const EQUIPMENT = new Set<string>(EQUIPMENT_IDS);

export const currentLocale = (): Locale => prefs.get().locale ?? browserLocale();

// A text in the device's language. The whole app is drawn again when the language changes (App), so
// components and helpers can simply call it.
export const t = (key: MessageKey, params?: Record<string, string | number>) => translate(currentLocale(), key, params);

export const exerciseTypeName = (id: ExerciseType) => t(`exerciseType.${id}`);
export const muscleName = (id: MuscleId) => t(`muscle.${id}`);
// Equipment outside the known list (an older or custom value) shows as it is.
export const equipmentName = (id: string) => (EQUIPMENT.has(id) ? t(`equipment.${id as EquipmentId}`) : id);
export const levelName = (id: string) => (id === 'beginner' || id === 'intermediate' || id === 'expert' ? t(`level.${id}`) : id);

const formats = new Map<string, Intl.DateTimeFormat>();
// A date in the device's language (formats are cached per language and options).
export function formatDate(ts: number, options: Intl.DateTimeFormatOptions): string {
  const locale = currentLocale();
  const id = `${locale}|${JSON.stringify(options)}`;
  let format = formats.get(id);
  if (!format) formats.set(id, (format = new Intl.DateTimeFormat(locale, options)));
  return format.format(ts);
}

// A number in the device's language: "82,5" in French, "82.5" in English.
export const formatNumber = (n: number, maximumFractionDigits = 0) => n.toLocaleString(currentLocale(), { maximumFractionDigits });
