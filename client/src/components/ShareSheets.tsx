import type { SharedWorkout } from '@halko/shared';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n.ts';
import { type ImportPreview, ShareError, importWorkout, previewImport, readSharedWorkout, saveWorkoutFile } from '../lib/workoutShare.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { Toggle } from './Toggle.tsx';
import { WorkoutItemView } from './WorkoutItemCard.tsx';

export const errorText = (err: unknown) => (err instanceof Error && err.message) || t('share.notWorkout');

// Asks whether the photos and videos of the workout's custom exercises go in the file (shown only when it
// has some: otherwise it is saved at once), then saves it.
export function ExportSheet({ workoutId, name, onClose }: { workoutId: string; name: string; onClose: () => void }) {
  const [media, setMedia] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (await saveWorkoutFile(workoutId, name, { media })) onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={t('share.exportTitle')} onClose={onClose}>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Toggle on={media} onChange={() => setMedia(!media)} title={t('share.withMedia')} text={t('share.withMediaHelp')} />
      </div>
      {error && (
        <p className="small" role="alert" style={{ margin: 0, color: 'var(--warn)' }}>
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
        <Icon name="download" size={18} />
        {busy ? t('share.exporting') : t('share.export')}
      </button>
    </Sheet>
  );
}

// « Import » button: picks a file, shows what it holds (and asks about its photos and videos), then adds
// the workout and opens it.
export function ImportButton() {
  const navigate = useNavigate();
  const file = useRef<HTMLInputElement>(null);
  const [shared, setShared] = useState<SharedWorkout | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [media, setMedia] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (f: File | undefined) => {
    if (file.current) file.current.value = '';
    if (!f) return;
    setError(null);
    setMedia(true);
    try {
      const read = readSharedWorkout(JSON.parse(await f.text()));
      setPreview(await previewImport(read));
      setShared(read);
    } catch (err) {
      setShared(null);
      setPreview(null);
      setError(err instanceof ShareError ? err.message : t('share.notWorkout'));
    }
  };
  const close = () => {
    setShared(null);
    setPreview(null);
    setError(null);
  };
  const run = async () => {
    if (!shared) return;
    setBusy(true);
    setError(null);
    try {
      const id = await importWorkout(shared, { media });
      close();
      navigate(`/workouts/${id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const custom = shared?.exercises.filter((e) => 'custom' in e) ?? [];
  const hasMedia = custom.some((e) => 'custom' in e && e.custom.media?.length);
  const missing = preview?.items.some((i) => i.status === 'missing');
  // Next to each exercise: whether it will be created, is already mine, or is missing from the library.
  const tag = ({ exercise, status }: ImportPreview['items'][number]) =>
    status === 'missing' ? (
      <span className="tag" style={{ color: 'var(--warn)' }}>{t('share.tagMissing')}</span>
    ) : status === 'new' ? (
      <span className="tag" style={{ color: 'var(--accent-text)' }}>{t('share.tagNew')}</span>
    ) : exercise?.source === 'custom' ? (
      <span className="tag" style={{ color: 'var(--muted)' }}>{t('share.tagMine')}</span>
    ) : null;
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => file.current?.click()}>
        <Icon name="upload" size={18} />
        {t('share.import')}
      </button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void open(e.target.files?.[0])} />
      {(shared || error) && (
        <Sheet title={t('share.importTitle')} onClose={close}>
          {shared && (
            <div className="stack" style={{ gap: 4 }}>
              <span style={{ fontWeight: 700 }}>{shared.workout.name}</span>
              <span className="small muted">
                {custom.length
                  ? t('share.importSummary', { count: shared.workout.items.length, custom: custom.length })
                  : t('exercises.count', { count: shared.workout.items.length })}
              </span>
            </div>
          )}
          {hasMedia && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <Toggle on={media} onChange={() => setMedia(!media)} title={t('share.importMedia')} text={t('share.importMediaHelp')} />
            </div>
          )}
          {error && (
            <p className="small" role="alert" style={{ margin: 0, color: 'var(--warn)' }}>
              {error}
            </p>
          )}
          {missing && (
            <p className="small" role="alert" style={{ margin: 0, color: 'var(--warn)' }}>
              {t('share.missingHelp')}
            </p>
          )}
          {shared && (
            <button type="button" className="btn btn-primary" onClick={run} disabled={busy || missing}>
              <Icon name="upload" size={18} />
              {busy ? t('share.importing') : t('share.import')}
            </button>
          )}
          {preview && preview.items.length > 0 && (
            <div className="stack" style={{ gap: 10 }}>
              <h3 className="label">{t('share.preview')}</h3>
              {shared?.workout.note && <p className="small muted" style={{ margin: 0 }}>{shared.workout.note}</p>}
              {preview.items.map((p) => (
                <WorkoutItemView
                  key={p.item.id}
                  item={p.item}
                  exercise={p.exercise}
                  supersetLabel={p.item.supersetGroup ? preview.labels.get(p.item.supersetGroup) : undefined}
                  tag={tag(p)}
                />
              ))}
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
