import type { MuscleId } from '@halko/shared';
import bodyPaths from '../assets/body-paths.json';
import { type RegionState, regionMuscles, regionState } from '../lib/muscles.ts';
import { muscleName, t } from '../lib/i18n.ts';

// Anatomical outlines from react-native-body-highlighter (MIT, see assets/body-paths.LICENSE).
const PATHS = bodyPaths as { front: { r: string; d: string }[]; back: { r: string; d: string }[] };

const FILL: Record<RegionState, string> = {
  primary: 'var(--muscle-primary)',
  secondary: 'var(--muscle-secondary)',
  idle: 'var(--muscle-idle)',
  body: 'var(--body)',
};

interface Props {
  primary: readonly MuscleId[];
  secondary: readonly MuscleId[];
  height?: number;
  legend?: boolean;
  // Lets the settings preview show colours that are not applied yet.
  colors?: { primary: string; secondary: string };
  // Makes the muscles clickable: called with the muscles of the region clicked.
  onPick?: (muscles: readonly MuscleId[]) => void;
}

// Paths of one side grouped by region, in drawing order, so a clickable region is a single target.
function regions(side: 'front' | 'back') {
  const out = new Map<string, string[]>();
  for (const p of PATHS[side]) out.set(p.r, [...(out.get(p.r) ?? []), p.d]);
  return [...out];
}

function describe(primary: readonly MuscleId[], secondary: readonly MuscleId[]) {
  const names = (ids: readonly MuscleId[]) => ids.map((m) => muscleName(m).toLowerCase()).join(', ');
  const parts = [];
  if (primary.length) parts.push(t('bodyMap.primary', { names: names(primary) }));
  if (secondary.length) parts.push(t('bodyMap.secondary', { names: names(secondary) }));
  return `${t('bodyMap.label')}${parts.length ? ` — ${parts.join(' ; ')}` : ''}`;
}

export function BodyMap({ primary, secondary, height = 220, legend = true, colors, onPick }: Props) {
  const fill = (s: RegionState) =>
    colors && s === 'primary' ? colors.primary : colors && s === 'secondary' ? colors.secondary : FILL[s];
  const view = (side: 'front' | 'back') => (
    <svg
      width={height / 2}
      height={height}
      viewBox={side === 'front' ? '0 0 724 1448' : '724 0 724 1448'}
      aria-hidden={onPick ? undefined : true}
    >
      {onPick
        ? regions(side).map(([region, paths]) => {
            const muscles = regionMuscles(region);
            const state = regionState(region, primary, secondary);
            const shapes = paths.map((d, i) => <path key={i} d={d} fill={fill(state)} />);
            if (!muscles.length) return <g key={region}>{shapes}</g>;
            const pick = () => onPick(muscles);
            const role = state === 'primary' ? t('bodyMap.primaryLegend') : state === 'secondary' ? t('bodyMap.secondaryLegend') : '';
            const label = muscles.map(muscleName).join(', ') + (role && ` (${role.toLowerCase()})`);
            return (
              <g
                key={region}
                className="body-region"
                role="button"
                tabIndex={0}
                aria-pressed={!!role}
                aria-label={label}
                onClick={pick}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  pick();
                }}
              >
                <title>{label}</title>
                {shapes}
              </g>
            );
          })
        : PATHS[side].map((p, i) => <path key={i} d={p.d} fill={fill(regionState(p.r, primary, secondary))} />)}
    </svg>
  );
  return (
    <figure role={onPick ? 'group' : 'img'} aria-label={onPick ? t('library.pickMuscles') : describe(primary, secondary)} style={{ margin: 0 }}>
      <div style={{ display: 'flex', gap: height < 140 ? 2 : 16, justifyContent: 'center' }}>
        {view('front')}
        {view('back')}
      </div>
      {legend && (
        <figcaption className="row small" style={{ justifyContent: 'center', gap: 14, marginTop: 6 }}>
          <span className="row" style={{ gap: 5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: fill('primary') }} />
            {t('bodyMap.primaryLegend')}
          </span>
          <span className="row" style={{ gap: 5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: fill('secondary') }} />
            {t('bodyMap.secondaryLegend')}
          </span>
        </figcaption>
      )}
    </figure>
  );
}
