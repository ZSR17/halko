import { EQUIPMENT_IDS, type EquipmentId, MUSCLE_GROUPS, type MuscleId } from '@halko/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigationType } from 'react-router-dom';
import { type LocalExercise, db } from '../db/db.ts';
import { type MuscleProfile, worksAsPicked } from '../lib/muscles.ts';
import { createStore } from '../lib/store.ts';
import { syncStatus } from '../sync/engine.ts';
import { BodyMap } from './BodyMap.tsx';
import { ExerciseMedia, thumbUrl } from './ExerciseMedia.tsx';
import { Icon } from './Icon.tsx';
import { Progress } from './Progress.tsx';
import { currentLocale, equipmentName, exerciseTypeName, muscleName, t } from '../lib/i18n.ts';

const PAGE = 40;

function muscleLine(e: LocalExercise): string {
  const p = e.primaryMuscles.map(muscleName).join(', ');
  const s = e.secondaryMuscles.map((m) => muscleName(m).toLowerCase()).join(', ');
  return s ? `${p} · ${s}` : p;
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const PREVIEW_W = 300;
const PREVIEW_H = 270;

// Hovering a row with the mouse shows the movement next to it (after a short pause, so
// sweeping the list does not flash previews). Hidden when the list scrolls.
function usePreview() {
  const [preview, setPreview] = useState<{ exercise: LocalExercise; top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hide = () => {
    clearTimeout(timer.current);
    setPreview(null);
  };
  useEffect(() => {
    if (!preview) return;
    addEventListener('scroll', hide, true);
    return () => removeEventListener('scroll', hide, true);
  }, [preview]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (exercise: LocalExercise, e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const left = r.right + 12 + PREVIEW_W <= innerWidth ? r.right + 12 : r.left - 12 - PREVIEW_W;
    if (left < 0) return;
    const top = Math.min(Math.max(8, r.top + r.height / 2 - PREVIEW_H / 2), innerHeight - PREVIEW_H - 8);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPreview({ exercise, top, left }), 250);
  };

  const card =
    preview &&
    createPortal(
      <div className="exercise-preview" style={{ top: preview.top, left: preview.left, width: PREVIEW_W }} aria-hidden="true">
        <ExerciseMedia urls={preview.exercise.mediaUrls} name={preview.exercise.name} style={{ height: PREVIEW_H - 46 }} />
        <span className="ellipsis" style={{ fontWeight: 700, padding: '0 12px' }}>
          {preview.exercise.name}
        </span>
      </div>,
      document.body,
    );
  return { show, hide, card };
}

function useExercises(): LocalExercise[] | undefined {
  // Alphabetical order of the chosen language: the index would sort "Écarté" after "Z".
  return useLiveQuery(async () => {
    const all = await db.exercises.filter((e) => !e.deleted).toArray();
    return all.sort((a, b) => a.name.localeCompare(b.name, currentLocale(), { sensitivity: 'base' }));
  }, []);
}

interface Filters {
  query: string;
  group: string;
  picked: MuscleProfile;
  // The equipment at hand: only the exercises it is all there for are shown, those needing none when
  // 'body only' is among it.
  equipment: EquipmentId[];
}
const NO_FILTERS: Filters = { query: '', group: 'all', picked: { primary: [], secondary: [] }, equipment: [] };

// The exercises page as it was left, while the app is open: its filters, and on « back » from an
// exercise, how far down the list was.
const libraryState = createStore<Filters & { shown: number; scrollY: number }>({ ...NO_FILTERS, shown: PAGE, scrollY: 0 });

// Library list with search and muscle-group filters. Links to the exercise page, or calls
// `onSelect` when used as a picker. Main and secondary muscles are also picked on a body map next to the
// list, which then shows the exercises working them so (and maybe others).
export function ExerciseList({
  onSelect,
  header,
}: {
  onSelect?: (e: LocalExercise) => void;
  // On the exercises page: shown above the search, and like it, kept in view (the page title).
  header?: ReactNode;
}) {
  const all = useExercises();
  const { download } = syncStatus.use();
  const sentinel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // The exercises page keeps its state; a picker starts afresh each time.
  const remember = !onSelect;
  const back = useNavigationType() === 'POP';
  const [filters, setFilterState] = useState<Filters>(() => {
    if (!remember) return NO_FILTERS;
    const { query, group, picked, equipment } = libraryState.get();
    return { query, group, picked, equipment };
  });
  const { query, group, picked, equipment } = filters;
  const anyPicked = picked.primary.length + picked.secondary.length > 0;
  const [shown, setShown] = useState(() => (remember && back ? libraryState.get().shown : PAGE));
  const setFilters = (patch: Partial<Filters>) => {
    setFilterState((f) => ({ ...f, ...patch }));
    setShown(PAGE);
    // The filters stay at the top of the exercises page: the new list is shown from its start. A picker
    // scrolls in its sheet.
    if (remember) window.scrollTo(0, 0);
    else root.current?.closest('.sheet-body')?.scrollTo(0, 0);
  };
  useEffect(() => {
    if (remember) libraryState.set(filters);
  }, [remember, filters]);

  // How far down the page is, noted when an exercise is opened; coming back to the page from it, once the
  // list is there, scrolls there again.
  useEffect(() => {
    if (remember) libraryState.set({ shown });
  }, [remember, shown]);
  // Read at once: the page is short until the list is there, which can scroll it back to the top meanwhile.
  const restoreTo = useRef(remember && back ? libraryState.get().scrollY : null);
  useLayoutEffect(() => {
    if (restoreTo.current === null || !all) return;
    window.scrollTo(0, restoreTo.current);
    restoreTo.current = null;
  }, [all]);
  const preview = usePreview();
  // On a large screen the body map sits in the empty space left of the search, which stays at the top:
  // it is pulled up by the height of the search block, and stays in view just below the title.
  const head = useRef<HTMLDivElement>(null);
  const headControls = useRef<HTMLDivElement>(null);
  const [bodyPlace, setBodyPlace] = useState({ top: 0, pull: 0 });
  useEffect(() => {
    const el = head.current;
    const controlsBox = headControls.current;
    if (!el || !controlsBox) return;
    const ro = new ResizeObserver(() => setBodyPlace({ top: controlsBox.offsetTop, pull: el.offsetHeight - controlsBox.offsetTop }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The exercises of the muscles chosen (`pool`, what the search looks among: a muscle group, or those
  // working the main and secondary muscles picked on the body map), and those of them the search finds.
  const { pool, filtered } = useMemo(() => {
    if (!all) return { pool: 0, filtered: [] };
    const groupMuscles = MUSCLE_GROUPS.find((g) => g.id === group)?.muscles as readonly MuscleId[] | undefined;
    let chosen = groupMuscles ? all.filter((e) => e.primaryMuscles.some((m) => groupMuscles.includes(m))) : all;
    if (anyPicked) chosen = chosen.filter((e) => worksAsPicked(picked, { primary: e.primaryMuscles, secondary: e.secondaryMuscles }));
    if (equipment.length) {
      const needs = (e: LocalExercise) => e.equipment.filter((q) => q !== 'body only');
      chosen = chosen.filter((e) => {
        const needed = needs(e);
        return needed.length ? needed.every((q) => (equipment as string[]).includes(q)) : equipment.includes('body only');
      });
    }
    const q = normalize(query.trim());
    // By its name in the language chosen, or in English.
    const found = (e: LocalExercise) => normalize(e.name).includes(q) || (!!e.library && normalize(e.library.en.name).includes(q));
    return { pool: chosen.length, filtered: q ? chosen.filter(found) : chosen };
  }, [all, query, group, picked, anyPicked, equipment]);

  // A region stands for one muscle or more (upper back: lats and middle back): picked again, it is let go.
  // A region is picked as a main muscle, clicked again as a secondary one, and a third time let go. It can
  // stand for more than one muscle (upper back: lats and middle back).
  const pick = (region: readonly MuscleId[]) => {
    const has = (list: readonly MuscleId[]) => region.some((m) => list.includes(m));
    const primary = picked.primary.filter((m) => !region.includes(m));
    const secondary = picked.secondary.filter((m) => !region.includes(m));
    setFilters({
      group: 'all',
      picked: has(picked.primary)
        ? { primary, secondary: [...secondary, ...region] }
        : has(picked.secondary)
          ? { primary, secondary }
          : { primary: [...primary, ...region], secondary },
    });
  };
  const chooseGroup = (id: string) => setFilters({ group: id, picked: NO_FILTERS.picked });
  const toggleEquipment = (id: EquipmentId) =>
    setFilters({ equipment: equipment.includes(id) ? equipment.filter((q) => q !== id) : [...equipment, id] });

  // Render progressively as the user scrolls: 900 rows with images at once is heavy. Observed again after
  // each step: an end of list still in view then asks for more, and a new filter's end of list is watched.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, shown]);

  const search = (
    <label className="search">
      <Icon name="search" size={20} />
      <span className="sr-only">{t('library.search')}</span>
      <input
        type="search"
        value={query}
        onChange={(e) => setFilters({ query: e.target.value })}
        placeholder={all ? t('library.searchAmong', { count: pool }) : t('library.searchShort')}
      />
    </label>
  );
  const filterChips = (
    <>
      <div className="chips" role="group" aria-label={t('library.filter')}>
        <button type="button" className="chip" aria-pressed={group === 'all' && !anyPicked} onClick={() => chooseGroup('all')}>
          {t('library.all')}
        </button>
        {MUSCLE_GROUPS.map((g) => (
          <button key={g.id} type="button" className="chip" aria-pressed={group === g.id} onClick={() => chooseGroup(g.id)}>
            {t(`muscleGroup.${g.id}`)}
          </button>
        ))}
      </div>
      {/* Always in view, under the muscle groups: what is at hand is ticked without opening anything. */}
      <div className="stack" style={{ gap: 6 }}>
        <span className="label">{t('library.equipment')}</span>
        <div className="chips-wrap" role="group" aria-label={t('library.equipment')}>
          {EQUIPMENT_IDS.map((id) => (
            <button key={id} type="button" className="chip" aria-pressed={equipment.includes(id)} onClick={() => toggleEquipment(id)}>
              {id === 'body only' ? t('library.noEquipment') : equipmentName(id)}
            </button>
          ))}
          {equipment.length > 0 && (
            <button type="button" className="link-btn row" style={{ gap: 4 }} onClick={() => setFilters({ equipment: [] })}>
              <Icon name="close" size={14} />
              {t('library.clearMuscles')}
            </button>
          )}
        </div>
      </div>
      <span className="label">
        {all === undefined ? t('common.loading') : t('library.count', { count: filtered.length })}
      </span>
      {download && <Progress label={t('library.downloading')} done={download.done} total={download.total} />}
      {all?.length === 0 && !download && (
        <p className="muted">{t('library.firstDownload')}</p>
      )}
    </>
  );
  const list = (
    <div className="stack">
      <div className="stack" style={{ gap: 8 }}>
        {filtered.slice(0, shown).map((e) => {
          const content = (
            <>
              <img className="thumb" src={thumbUrl(e.mediaUrls)} alt="" loading="lazy" />
              <div className="grow stack" style={{ gap: 3 }}>
                <span className="ellipsis" style={{ fontWeight: 700 }}>
                  {e.name}
                </span>
                <span className="small muted ellipsis">{muscleLine(e)}</span>
                <span className="small muted ellipsis">
                  {e.equipment.map(equipmentName).join(', ') || t('equipment.body only')}
                </span>
              </div>
              <span className="tag" style={{ color: 'var(--muted)' }}>
                {exerciseTypeName(e.exerciseType)}
              </span>
            </>
          );
          return onSelect ? (
            <button
              key={e.id}
              type="button"
              className="list-item"
              onClick={() => (preview.hide(), onSelect(e))}
              onPointerEnter={(ev) => preview.show(e, ev)}
              onPointerLeave={preview.hide}
            >
              {content}
            </button>
          ) : (
            <Link
              key={e.id}
              to={`/exercises/${e.id}`}
              className="list-item"
              onClick={() => (preview.hide(), libraryState.set({ scrollY: window.scrollY }))}
              onPointerEnter={(ev) => preview.show(e, ev)}
              onPointerLeave={preview.hide}
            >
              {content}
            </Link>
          );
        })}
        {shown < filtered.length && <div ref={sentinel} style={{ height: 1 }} />}
      </div>
      {preview.card}
    </div>
  );
  const body = (
    <>
      <BodyMap primary={picked.primary} secondary={picked.secondary} height={300} legend={false} onPick={pick} />
      {anyPicked ? (
        <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
          {(['primary', 'secondary'] as const).map(
            (role) =>
              picked[role].length > 0 && (
                <span key={role} className="small" style={{ textAlign: 'center' }}>
                  <i
                    style={{ display: 'inline-block', width: 10, height: 10, marginRight: 6, borderRadius: 3, background: `var(--muscle-${role})` }}
                  />
                  {t(role === 'primary' ? 'library.pickedPrimary' : 'library.pickedSecondary', {
                    names: picked[role].map(muscleName).join(', '),
                  })}
                </span>
              ),
          )}
          <button type="button" className="link-btn row" style={{ gap: 4 }} onClick={() => setFilters({ picked: NO_FILTERS.picked })}>
            <Icon name="close" size={14} />
            {t('library.clearMuscles')}
          </button>
        </div>
      ) : (
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>
          {t('library.pickHint')}
        </p>
      )}
    </>
  );
  // In a sheet: the body map next to the list on a large screen (kept in view), above it otherwise.
  if (!remember) {
    return (
      <div className="picker-layout" ref={root}>
        <aside className="picker-body stack">{body}</aside>
        <div className="stack">
          {search}
          {filterChips}
          {list}
        </div>
      </div>
    );
  }
  return (
    <>
      {/* The title and the search stay at the top while the list scrolls, the body map just below them; the
          filters scroll away with the list. */}
      <div className="library-head" ref={head}>
        {header}
        <div className="library-layout">
          <span className="library-spacer" />
          <div className="stack" ref={headControls}>
            {search}
          </div>
        </div>
      </div>
      <div
        className="library-layout"
        style={{ '--body-top': `${bodyPlace.top}px`, '--body-pull': `${bodyPlace.pull}px` } as CSSProperties}
      >
        <aside className="library-body stack">{body}</aside>
        <div className="stack">
          {filterChips}
          {list}
        </div>
      </div>
    </>
  );
}
