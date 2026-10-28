import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { type FormEvent, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { ImportButton } from '../components/ShareSheets.tsx';
import { SyncBadge } from '../components/SyncBadge.tsx';
import { WorkoutGrid, useWorkoutSummaries } from '../components/WorkoutGrid.tsx';
import { db } from '../db/db.ts';
import { createFolder } from '../db/folders.ts';
import { createWorkout } from '../db/workouts.ts';
import type { EditState } from './WorkoutEditor.tsx';
import { formatDate, t } from '../lib/i18n.ts';

export function Home() {
  const navigate = useNavigate();
  const workouts = useWorkoutSummaries(null);
  const folders = useLiveQuery(async () => {
    const list = await db.folders.orderBy('position').filter((f) => !f.deleted).toArray();
    const all = await db.workouts.filter((w) => !w.deleted).toArray();
    return list.map((folder) => ({ folder, count: all.filter((w) => w.folderId === folder.id).length }));
  }, []);
  const [naming, setNaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const today = formatDate(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' });

  const create = async () => {
    const state: EditState = { created: true };
    navigate(`/workouts/${await createWorkout(t('workout.newName'))}/edit`, { state });
  };

  return (
    <div className="page">
      {/* The buttons go under the title when both do not fit side by side (a phone held upright). */}
      <header className="row between wrap" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted" style={{ fontWeight: 600, textTransform: 'capitalize' }}>
            {today}
          </span>
          <h1 className="title">{t('home.title')}</h1>
        </div>
        <div className="row wrap" style={{ gap: 4 }}>
          <ImportButton />
          {/* Reordering, and folders, are for the edit mode: the list stays still otherwise. */}
          {/* One button, as wide for « Edit » as for « Done » (both labels take room, one shows): the
              others do not move when it changes. */}
          <button type="button" className={`btn btn-compact ${editing ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEditing(!editing)}>
            <span className="swap">
              <span className={editing ? 'off' : undefined} aria-hidden={editing}>
                <Icon name="pencil" size={18} />
                {t('workout.edit')}
              </span>
              <span className={editing ? undefined : 'off'} aria-hidden={!editing}>
                <Icon name="check" size={18} />
                {t('home.done')}
              </span>
            </span>
          </button>
          <span style={{ marginLeft: 8 }}>
            <SyncBadge />
          </span>
        </div>
      </header>

      {workouts?.length === 0 && folders?.length === 0 && (
        <div className="card stack" style={{ alignItems: 'flex-start' }}>
          <h2 className="title-sm">{t('home.firstTitle')}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {t('home.firstText')}
          </p>
        </div>
      )}

      {editing && (
        <div className="edit-strip">
          <span className="row grow small" style={{ gap: 8 }}>
            <Icon name="grip" size={18} />
            {t('home.editHint')}
          </span>
          <button type="button" className="btn btn-primary btn-compact" onClick={() => setNaming(true)}>
            <Icon name="folder" size={18} />
            {t('home.newFolder')}
          </button>
        </div>
      )}

      {workouts && folders && <WorkoutGrid workouts={workouts} folders={folders} fixed={!editing} />}

      {!editing && (
        <button type="button" className="btn btn-dashed" onClick={create}>
          <Icon name="plus" size={20} />
          {t('home.newWorkout')}
        </button>
      )}
      {naming && <NewFolderSheet onClose={() => setNaming(false)} />}
    </div>
  );
}

// Asks the name of a new folder; it is made only when saved.
function NewFolderSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createFolder(name);
    onClose();
  };
  return (
    <Sheet title={t('folder.newTitle')} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <input
          className="input"
          aria-label={t('folder.name')}
          placeholder={t('folder.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          <Icon name="check" size={18} />
          {t('workout.save')}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </form>
    </Sheet>
  );
}
