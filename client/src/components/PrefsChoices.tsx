import { LOCALES, type Locale, type MessageKey } from '@halko/shared/i18n';
import type { DistanceUnit, WeightUnit } from '../lib/i18n.ts';
import { Select } from './Select.tsx';

type Choice = { locale: Locale; weight: WeightUnit; distance: DistanceUnit };

// Language, weight unit and distance unit, each chosen on its own (kilos with miles is fine): on the
// first launch and in the settings.
export function PrefsChoices({ value, t, onChange }: { value: Choice; t: (key: MessageKey) => string; onChange: (patch: Partial<Choice>) => void }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="label">{t('prefs.language')}</span>
        <Select
          label={t('prefs.language')}
          value={value.locale}
          // Each language written in itself, so it can be found whatever is shown.
          options={LOCALES.map((l) => ({ value: l.code, label: l.name, lang: l.code }))}
          onChange={(locale) => onChange({ locale })}
        />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="label">{t('prefs.weight')}</span>
        <div className="choice-row" role="group" aria-label={t('prefs.weight')}>
          {(['kg', 'lb'] as const).map((u) => (
            <button key={u} type="button" aria-pressed={value.weight === u} onClick={() => onChange({ weight: u })}>
              {u}
            </button>
          ))}
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="label">{t('prefs.distance')}</span>
        <div className="choice-row" role="group" aria-label={t('prefs.distance')}>
          {(['km', 'mi'] as const).map((u) => (
            <button key={u} type="button" aria-pressed={value.distance === u} onClick={() => onChange({ distance: u })}>
              {u}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
