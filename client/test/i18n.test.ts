import { CATALOGS, FALLBACK_LOCALE, LOCALES, matchLocale, translate } from '@halko/shared/i18n';
import { describe, expect, it } from 'vitest';

const placeholders = (message: unknown) => [...JSON.stringify(message).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('languages', () => {
  const reference = CATALOGS[FALLBACK_LOCALE];

  // A language may leave texts out (they show in English), but never invent keys or drop a {placeholder}.
  it.each(LOCALES.map((l) => l.code))('%s has only known texts, with the same placeholders', (code) => {
    for (const [key, message] of Object.entries(CATALOGS[code])) {
      expect(reference, `${code}: unknown text ${key}`).toHaveProperty([key]);
      expect(placeholders(message), `${code}: ${key}`).toEqual(placeholders(reference[key as keyof typeof reference]));
    }
  });

  it('fills placeholders, picks plural forms and falls back to English', () => {
    const catalog = CATALOGS.fr as Record<string, unknown>;
    const en = CATALOGS.en as Record<string, unknown>;
    en['test.sessions'] = { one: '{count} session', other: '{count} sessions' };
    catalog['test.sessions'] = { one: '{count} séance', other: '{count} séances' };
    const key = 'test.sessions' as Parameters<typeof translate>[1];
    expect(translate('fr', key, { count: 0 })).toBe('0 séance');
    expect(translate('en', key, { count: 0 })).toBe('0 sessions');
    expect(translate('fr', key, { count: 2 })).toBe('2 séances');
    delete catalog['test.sessions'];
    expect(translate('fr', key, { count: 1 })).toBe('1 session');
    delete en['test.sessions'];
  });

  it("finds the browser's language", () => {
    expect(matchLocale(['fr-CA', 'en'])).toBe('fr');
    expect(matchLocale(['de-DE', 'en-GB'])).toBe('en');
    expect(matchLocale(['de-DE'])).toBeUndefined();
  });
});
