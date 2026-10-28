import en from './messages/en.json';
import fr from './messages/fr.json';

// Languages of the app. Adding one: a messages/<code>.json file (any missing text shows in English),
// and a line here. See docs/i18n.md.
export const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
] as const;
export type Locale = (typeof LOCALES)[number]['code'];

// The reference language: its file has every text, and a text missing elsewhere falls back to it.
export const FALLBACK_LOCALE: Locale = 'en';

// A text with plural forms: one per plural category of the language ("one", "few", "many"…; "other" always).
type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type MessageKey = keyof typeof en;
type Catalog = Partial<Record<MessageKey, string | Plural>>;

export const CATALOGS: Record<Locale, Catalog> = { en, fr };

// First of the preferred languages (as the browser gives them, "fr-CA", "en"…) that the app has.
export function matchLocale(tags: readonly string[]): Locale | undefined {
  for (const tag of tags) {
    const code = tag.toLowerCase().split('-')[0];
    const found = LOCALES.find((l) => l.code === code);
    if (found) return found.code;
  }
  return undefined;
}

// The text of `key` in `locale` (else in English), with its {placeholders} filled from `params`.
// Plural texts pick their form from params.count.
export function translate(locale: Locale, key: MessageKey, params: Record<string, string | number> = {}): string {
  const message = CATALOGS[locale][key] ?? CATALOGS[FALLBACK_LOCALE][key] ?? key;
  const text = typeof message === 'string' ? message : (message[new Intl.PluralRules(locale).select(Number(params.count ?? 0))] ?? message.other);
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] === undefined ? match : String(params[name])));
}
