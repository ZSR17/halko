import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon.tsx';
import { Stepper } from '../components/Stepper.tsx';
import { ValueInput } from '../components/ValueInput.tsx';
import { formatWeight, parseCount, parseWeight, weightStep, weightText, weightUnit } from '../lib/format.ts';
import { type Load, type Plate, type PlateResult, defaultBar, loadPlatesIn, plateSettings } from '../lib/plates.ts';
import { t } from '../lib/i18n.ts';
import { newId } from '../lib/id.ts';

const kg = weightText;
const formatPlate = (g: number | undefined) => formatWeight(g || undefined);
const formatCount = (n: number | undefined) => String(n ?? 0);

function LoadCard({ load, onUse }: { load: Load; onUse?: () => void }) {
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row between">
        <span className="stack" style={{ gap: 2 }}>
          <span className="title-sm">{t('plates.perSide', { weight: kg(load.perSideG) })}</span>
          <span className="small muted">{t('plates.total', { weight: kg(load.totalG) })}</span>
        </span>
        {onUse && (
          <button type="button" className="btn btn-ghost" onClick={onUse}>
            {t('plates.choose')}
          </button>
        )}
      </div>
      {load.perSide.length ? (
        <ul className="plate-list">
          {load.perSide.map((p) => (
            <li key={p.weightG}>
              <span className="plate-count">{p.count} ×</span> {t('plates.plate', { weight: kg(p.weightG) })}
            </li>
          ))}
        </ul>
      ) : (
        <span className="muted">{t('plates.barOnly')}</span>
      )}
    </div>
  );
}

function Result({ result, targetG, onUse }: { result: PlateResult; targetG: number; onUse: (g: number) => void }) {
  if (result.exact) return <LoadCard load={result.load} />;
  return (
    <div className="stack">
      <div className="card notice-warn">
        {t('plates.impossible', { weight: kg(targetG) })}
      </div>
      <LoadCard load={result.below} onUse={() => onUse(result.below.totalG)} />
      {result.above ? (
        <LoadCard load={result.above} onUse={() => onUse(result.above!.totalG)} />
      ) : (
        <span className="small muted">{t('plates.noHigher')}</span>
      )}
    </div>
  );
}

function answer(barG: number, targetG: number, plates: Plate[]): { error: string } | { result: PlateResult } {
  if (targetG < barG) return { error: t('plates.lighterThanBar') };
  if (targetG > barG && !plates.some((p) => p.weightG > 0 && p.count >= 2))
    return { error: t('plates.addFirst') };
  return { result: loadPlatesIn(weightUnit(), barG, targetG, plates) };
}

export function Plates() {
  const settings = plateSettings.use();
  const { plates, targetG } = settings;
  const barG = settings.barG ?? defaultBar();
  const [params, setParams] = useSearchParams();

  // Opened from the 1RM calculator with a weight (in grams).
  useEffect(() => {
    const weight = Number(params.get('weight'));
    if (!weight) return;
    plateSettings.set({ targetG: weight });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const setPlate = (id: string, patch: Partial<Plate>) => plateSettings.set({ plates: plates.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addPlate = () => plateSettings.set({ plates: [...plates, { id: newId(), weightG: 0, count: 2 }] });
  const removePlate = (id: string) => plateSettings.set({ plates: plates.filter((p) => p.id !== id) });
  const shown = targetG !== undefined ? answer(barG, targetG, plates) : null;

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="title">{t('plates.title')}</h1>

      <section className="stack">
        <h2 className="section-title">{t('plates.load')}</h2>
        <div className="steppers">
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">{t('plates.bar')}</span>
            <Stepper
              label={t('plates.barWeight')}
              unit={weightUnit()}
              value={barG}
              step={weightStep()}
              format={formatWeight}
              parse={parseWeight}
              onChange={(v) => plateSettings.set({ barG: v })}
            />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">{t('plates.target')}</span>
            <Stepper
              label={t('plates.target')}
              unit={weightUnit()}
              value={targetG}
              step={weightStep()}
              format={formatWeight}
              parse={parseWeight}
              onChange={(v) => plateSettings.set({ targetG: v })}
            />
          </div>
        </div>
      </section>

      {shown && 'error' in shown && <div className="card notice-warn">{shown.error}</div>}
      {shown && 'result' in shown && (
        <Result result={shown.result} targetG={targetG!} onUse={(g) => plateSettings.set({ targetG: g })} />
      )}

      <section className="stack">
        <h2 className="section-title">{t('plates.mine')}</h2>
        {plates.map((p) => (
          <div key={p.id} className="card row plate-row">
            <label className="field plate-weight">
              <span>{t('plates.weight', { unit: weightUnit() })}</span>
              <ValueInput
                value={p.weightG}
                format={formatPlate}
                parse={parseWeight}
                onCommit={(weightG) => setPlate(p.id, { weightG })}
                label={t('plates.plateWeight')}
              />
            </label>
            <div className="grow">
              <Stepper
                label={t('plates.count')}
                unit={t('plates.unit')}
                value={p.count}
                step={1}
                min={1}
                format={formatCount}
                parse={parseCount}
                inputMode="numeric"
                onChange={(count) => setPlate(p.id, { count: Math.max(1, count) })}
              />
            </div>
            <button type="button" className="icon-btn" onClick={() => removePlate(p.id)} aria-label={t('plates.remove')}>
              <Icon name="trash" size={20} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-dashed" onClick={addPlate}>
          <Icon name="plus" size={20} />
          {t('plates.add')}
        </button>
      </section>
    </div>
  );
}
