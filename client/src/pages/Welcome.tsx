import { type Locale, type MessageKey, translate } from '@halko/shared/i18n';
import { useState } from 'react';
import { PrefsChoices } from '../components/PrefsChoices.tsx';
import { type DistanceUnit, type WeightUnit, browserLocale, prefs } from '../lib/i18n.ts';

// First launch on this device: the language and the units, before anything else. The texts follow the
// language as soon as it is picked.
export function Welcome() {
  const [choice, setChoice] = useState<{ locale: Locale; weight: WeightUnit; distance: DistanceUnit }>({
    locale: browserLocale(),
    weight: prefs.get().weight,
    distance: prefs.get().distance,
  });
  const t = (key: MessageKey) => translate(choice.locale, key);

  return (
    <div className="page" style={{ maxWidth: 420, minHeight: '100dvh', justifyContent: 'center' }}>
      <span className="title" style={{ color: 'var(--accent-text)' }}>
        Halko
      </span>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="title-sm">{t('welcome.title')}</h1>
        <p className="muted" style={{ margin: 0, lineHeight: 1.45 }}>
          {t('welcome.intro')}
        </p>
      </div>
      <PrefsChoices value={choice} t={t} onChange={(patch) => setChoice((c) => ({ ...c, ...patch }))} />
      <button type="button" className="btn btn-primary" onClick={() => prefs.set(choice)}>
        {t('welcome.continue')}
      </button>
    </div>
  );
}
