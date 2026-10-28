import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type Crop, EQUIPMENT_IDS, EXERCISE_TYPE_IDS, MUSCLE_IDS, type MuscleId, type UploadResponse } from '@halko/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink.tsx';
import { BodyMap } from '../components/BodyMap.tsx';
import { ask } from '../components/Dialog.tsx';
import { CropSheet } from '../components/CropSheet.tsx';
import { thumbUrl } from '../components/ExerciseMedia.tsx';
import { Icon } from '../components/Icon.tsx';
import { db } from '../db/db.ts';
import {
  type ExerciseFields,
  UploadError,
  createExercise,
  deleteExercise,
  importMediaFromUrl,
  importMotionFromUrl,
  resetExercise,
  updateExercise,
  uploadMedia,
} from '../db/exercises.ts';
import { Select } from '../components/Select.tsx';
import { equipmentName, exerciseTypeName, muscleName, t } from '../lib/i18n.ts';

const EMPTY: ExerciseFields = {
  name: '',
  exerciseType: 'weight_reps',
  equipment: [],
  primaryMuscles: [],
  secondaryMuscles: [],
  instructions: [],
  mediaIds: [],
  mediaUrls: [],
};

type Level = 'primary' | 'secondary' | null;

// A video comes with its poster image: they are shown, and removed, together.
function mediaGroups(f: Pick<ExerciseFields, 'mediaIds' | 'mediaUrls'>) {
  const groups: { ids: string[]; urls: string[] }[] = [];
  for (let i = 0; i < f.mediaUrls.length; i++) {
    const n = f.mediaUrls[i]!.endsWith('.mp4') && i + 1 < f.mediaUrls.length ? 2 : 1;
    groups.push({ ids: f.mediaIds.slice(i, i + n), urls: f.mediaUrls.slice(i, i + n) });
    i += n - 1;
  }
  return groups;
}

type MediaGroup = ReturnType<typeof mediaGroups>[number];

// A photo or video of the exercise. With two photos, dragging one (or Space on it, then arrows) swaps
// them: the first is the start of the movement, the second its end.
function MediaTile({ group, label, onRemove }: { group: MediaGroup; label: string | null; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.ids[0]! });
  const video = group.urls[0]!.endsWith('.mp4');
  return (
    <div
      ref={setNodeRef}
      className="media-tile"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 2 : undefined,
        cursor: label ? (isDragging ? 'grabbing' : 'grab') : undefined,
        touchAction: 'none',
      }}
      {...attributes}
      {...listeners}
      aria-roledescription={t('editor.photoDraggable')}
      aria-label={video ? t('editor.video') : label ? t('editor.photoOf', { position: label.toLowerCase() }) : t('editor.photo')}
    >
      <img src={thumbUrl(group.urls)} alt="" draggable={false} />
      {(video || label) && <span className="badge">{video ? t('editor.video') : label}</span>}
      <button
        type="button"
        className="remove"
        aria-label={t('editor.remove')}
        onClick={onRemove}
        // The button's own presses, not a move of the tile.
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

// Creates a custom exercise (/exercises/new) or edits one (/exercises/:id/edit).
// Editing a built-in exercise keeps a personal version that can be reverted.
export function ExerciseEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Opened from the exercise's page: leaving goes back to it, rather than opening it again.
  const fromDetail = !!(useLocation().state as { fromDetail?: boolean } | null)?.fromDetail;
  const showExercise = (target: string) => (fromDetail ? navigate(-1) : navigate(`/exercises/${target}`, { replace: true }));
  const existing = useLiveQuery(() => (id ? db.exercises.get(id) : undefined), [id]);
  const [f, setF] = useState<ExerciseFields | null>(id ? null : EMPTY);
  const [steps, setSteps] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  // Photo waiting for its framing before being sent: `send` sends it with the part chosen, `release`
  // frees its preview whatever happens, `added` runs once it is in the exercise.
  const [cropping, setCropping] = useState<{
    src: string;
    message: string;
    send: (crop: Crop | null) => Promise<{ ids: string[]; urls: string[] }>;
    release?: () => void;
    added?: () => void;
  } | null>(null);
  // Last photo or video removed, until it is put back or another one is added.
  const [removed, setRemoved] = useState<{ ids: string[]; urls: string[]; at: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Load once: later sync updates must not overwrite what is being typed.
  useEffect(() => {
    if (existing && !f) {
      setF({
        name: existing.name,
        exerciseType: existing.exerciseType,
        equipment: existing.equipment,
        primaryMuscles: existing.primaryMuscles,
        secondaryMuscles: existing.secondaryMuscles,
        instructions: existing.instructions,
        mediaIds: existing.mediaIds,
        mediaUrls: existing.mediaUrls,
      });
      setSteps(existing.instructions.join('\n'));
    }
  }, [existing, f]);

  if (id && existing === null) return <div className="page">{t('exercise.notFound')}</div>;
  if (!f) return <div className="page muted">{t('common.loading')}</div>;

  const set = (patch: Partial<ExerciseFields>) => setF({ ...f, ...patch });
  const level = (m: MuscleId): Level =>
    f.primaryMuscles.includes(m) ? 'primary' : f.secondaryMuscles.includes(m) ? 'secondary' : null;
  // Click: none -> main -> secondary -> none.
  const cycle = (m: MuscleId) => {
    const l = level(m);
    set({
      primaryMuscles: l === null ? [...f.primaryMuscles, m] : f.primaryMuscles.filter((x) => x !== m),
      secondaryMuscles: l === 'primary' ? [...f.secondaryMuscles, m] : f.secondaryMuscles.filter((x) => x !== m),
    });
  };
  const toggleEquipment = (q: string) =>
    set({ equipment: f.equipment.includes(q) ? f.equipment.filter((x) => x !== q) : [...f.equipment, q] });

  const groups = mediaGroups(f);
  const hasVideo = f.mediaUrls.some((u) => u.endsWith('.mp4'));
  const photos = groups.length;
  // A video, or two photos, fill the exercise: one is removed before another is added.
  const full = hasVideo || photos >= 2;
  const onMediaMoved = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = groups.map((g) => g.ids[0]);
    const moved = arrayMove(groups, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setRemoved(null);
    set({ mediaIds: moved.flatMap((g) => g.ids), mediaUrls: moved.flatMap((g) => g.urls) });
  };
  const removeGroup = (g: { ids: string[]; urls: string[] }) => {
    setRemoved({ ...g, at: f.mediaIds.indexOf(g.ids[0]!) });
    set({
      mediaIds: f.mediaIds.filter((x) => !g.ids.includes(x)),
      mediaUrls: f.mediaUrls.filter((_, i) => !g.ids.includes(f.mediaIds[i]!)),
    });
  };
  const undoRemove = () => {
    if (!removed) return;
    const putBack = (list: string[], items: string[]) => [...list.slice(0, removed.at), ...items, ...list.slice(removed.at)];
    set({ mediaIds: putBack(f.mediaIds, removed.ids), mediaUrls: putBack(f.mediaUrls, removed.urls) });
    setRemoved(null);
  };

  // Sends a file or a link to the server, then adds what it kept: one video, or up to two photos
  // (start and end position, shown in a loop).
  const addMedia = async (message: string, send: () => Promise<{ ids: string[]; urls: string[] }>) => {
    setError(null);
    setBusy(message);
    try {
      const res = await send();
      setRemoved(null);
      if (res.ids.length === 2 || hasVideo) set({ mediaIds: res.ids, mediaUrls: res.urls });
      else set({ mediaIds: [...f.mediaIds, ...res.ids].slice(-2), mediaUrls: [...f.mediaUrls, ...res.urls].slice(-2) });
      return true;
    } catch (err) {
      setError(err instanceof UploadError ? err.message : t('editor.sendFailed'));
      return false;
    } finally {
      setBusy(null);
    }
  };
  // Photos are framed first; videos and GIFs go as they are.
  const onFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    if (file.type.startsWith('video/') || file.type === 'image/gif') {
      await addMedia(t('editor.sendingVideo'), () => uploadMedia(file));
      return;
    }
    const src = URL.createObjectURL(file);
    setCropping({
      src,
      message: t('editor.sendingPhoto'),
      send: (crop) => uploadMedia(file, crop ?? undefined),
      release: () => URL.revokeObjectURL(src),
    });
  };
  // A GIF or video is kept at once; a still photo is framed first, like a photo from a file.
  const onLink = async () => {
    const url = link.trim();
    if (!url) return;
    setError(null);
    setBusy(t('editor.importingLink'));
    let motion: UploadResponse | null;
    try {
      motion = await importMotionFromUrl(url);
    } catch (err) {
      setError(err instanceof UploadError ? err.message : t('editor.importFailed'));
      return;
    } finally {
      setBusy(null);
    }
    if (motion) {
      const kept = motion;
      if (await addMedia(t('editor.importingLink'), async () => kept)) setLink('');
      return;
    }
    setCropping({
      src: url,
      message: t('editor.importingImage'),
      send: (crop) => importMediaFromUrl(url, crop ?? undefined),
      added: () => setLink(''),
    });
  };
  // `crop` undefined: framing cancelled (a link stays in its field, to be tried again).
  const closeCrop = async (crop: Crop | null | undefined) => {
    const c = cropping;
    setCropping(null);
    if (!c) return;
    if (crop !== undefined && (await addMedia(c.message, () => c.send(crop)))) c.added?.();
    c.release?.();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setError(t('editor.nameRequired'));
    const fields = { ...f, instructions: steps.split('\n').map((s) => s.trim()).filter(Boolean) };
    const target = id ? (await updateExercise(id, fields), id) : await createExercise(fields);
    showExercise(target);
  };

  const builtin = existing?.source === 'builtin';

  return (
    <form className="page" style={{ maxWidth: 720 }} onSubmit={save}>
      <header className="row between">
        <BackLink to={id ? `/exercises/${id}` : '/exercises'} label={t('common.cancel')} icon="close" />
        <div className="row" style={{ gap: 4 }}>
          {builtin && existing?.customized && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!!busy}
              onClick={async () => {
                const sure = await ask({
                  title: t('editor.resetTitle'),
                  message: t('editor.resetMessage'),
                  confirm: t('editor.reset'),
                  danger: true,
                });
                if (!sure) return;
                setBusy(t('editor.resetting'));
                try {
                  await resetExercise(id!);
                  showExercise(id!);
                } catch {
                  setError(t('editor.offline'));
                  setBusy(null);
                }
              }}
            >
              {t('editor.reset')}
            </button>
          )}
          {existing?.source === 'custom' && (
            <button
              type="button"
              className="btn btn-ghost btn-danger"
              onClick={async () => {
                const sure = await ask({
                  title: t('editor.deleteTitle', { name: existing.name }),
                  message: t('editor.deleteMessage'),
                  confirm: t('editor.delete'),
                  danger: true,
                });
                if (sure) {
                  await deleteExercise(existing.id);
                  navigate('/exercises', { replace: true });
                }
              }}
            >
              <Icon name="trash" size={18} />
              {t('editor.delete')}
            </button>
          )}
        </div>
      </header>

      <h1 className="title">{id ? t('editor.titleEdit') : t('editor.titleNew')}</h1>
      {builtin && (
        <p className="small muted" style={{ margin: 0, lineHeight: 1.45 }}>
          {t('editor.builtinNote')}
        </p>
      )}

      <label className="stack" style={{ gap: 6 }}>
        <span className="label">{t('editor.name')}</span>
        <input className="input" value={f.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} placeholder={t('editor.namePlaceholder')} />
      </label>

      <div className="stack" style={{ gap: 6 }}>
        <span className="label">{t('exercise.type')}</span>
        <Select
          label={t('exercise.type')}
          value={f.exerciseType}
          options={EXERCISE_TYPE_IDS.map((type) => ({ value: type, label: exerciseTypeName(type) }))}
          onChange={(exerciseType) => set({ exerciseType })}
        />
      </div>

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="label">{t('editor.muscles')}</h2>
        <span className="small muted">{t('editor.musclesHelp')}</span>
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div className="chips-wrap grow" role="group" aria-label={t('editor.musclesWorked')} style={{ flexBasis: 280 }}>
            {MUSCLE_IDS.map((m) => {
              const l = level(m);
              return (
                <button
                  key={m}
                  type="button"
                  className="chip"
                  data-level={l ?? undefined}
                  aria-label={t('editor.muscleState', { muscle: muscleName(m), state: l === 'primary' ? t('editor.musclePrimary') : l === 'secondary' ? t('editor.muscleSecondary') : t('editor.muscleOff') })}
                  onClick={() => cycle(m)}
                >
                  {muscleName(m)}
                </button>
              );
            })}
          </div>
          <div className="card" style={{ display: 'flex', justifyContent: 'center', margin: '0 auto' }}>
            <BodyMap primary={f.primaryMuscles} secondary={f.secondaryMuscles} height={180} />
          </div>
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="label">{t('editor.equipment')}</h2>
        <div className="chips-wrap" role="group" aria-label={t('editor.equipment')}>
          {EQUIPMENT_IDS.map((q) => (
            <button key={q} type="button" className="chip" aria-pressed={f.equipment.includes(q)} onClick={() => toggleEquipment(q)}>
              {equipmentName(q)}
            </button>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="label">{t('editor.media')}</h2>
        <span className="small muted" style={{ lineHeight: 1.45 }}>
          {t('editor.mediaHelp')}
        </span>
        <div className="row wrap" style={{ gap: 10 }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onMediaMoved}>
            <SortableContext items={groups.map((g) => g.ids[0]!)} strategy={horizontalListSortingStrategy}>
              {groups.map((g, k) => (
                <MediaTile
                  key={g.ids[0]}
                  group={g}
                  label={photos === 2 && !hasVideo ? (k === 0 ? t('editor.start') : t('editor.end')) : null}
                  onRemove={() => removeGroup(g)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {!full && (
            // The whole tile adds a picture; after a removal, its corner (where the remove button of a
            // picture is) puts the removed one back.
            <div className="media-tile add-tile">
              <button
                type="button"
                className="add"
                disabled={!!busy}
                onClick={() => fileInput.current?.click()}
                aria-label={t('editor.addMedia')}
              >
                <Icon name="plus" size={24} />
              </button>
              {removed && (
                <button
                  type="button"
                  className="remove"
                  aria-label={removed.urls[0]!.endsWith('.mp4') ? t('editor.restoreVideo') : t('editor.restorePhoto')}
                  onClick={undoRemove}
                >
                  <Icon name="undo" size={16} />
                </button>
              )}
            </div>
          )}
        </div>
        {full ? (
          <span className="small muted">
            {hasVideo ? t('editor.fullVideo') : t('editor.fullPhotos')}
          </span>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input grow"
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                // Enter imports from the link instead of saving the whole exercise.
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void onLink();
              }}
              placeholder={t('editor.linkPlaceholder')}
              aria-label={t('editor.linkLabel')}
              disabled={!!busy}
            />
            <button type="button" className="btn" disabled={!!busy || !link.trim()} onClick={() => void onLink()}>
              {t('editor.import')}
            </button>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {busy && (
          <span className="small" role="status" style={{ color: 'var(--accent-text)' }}>
            {busy}
          </span>
        )}
      </section>

      <label className="stack" style={{ gap: 6 }}>
        <span className="label">{t('editor.steps')}</span>
        <textarea
          className="input"
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          placeholder={t('editor.stepsPlaceholder')}
        />
      </label>

      {error && (
        <p className="small" role="alert" style={{ margin: 0, color: 'var(--warn)' }}>
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={!!busy}>
        <Icon name="check" size={20} />
        {t('editor.save')}
      </button>
      {cropping && (
        <CropSheet src={cropping.src} onCancel={() => void closeCrop(undefined)} onConfirm={(crop) => void closeCrop(crop)} />
      )}
    </form>
  );
}
