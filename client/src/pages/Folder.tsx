import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink, useLeave } from '../components/BackLink.tsx';
import { ask } from '../components/Dialog.tsx';
import { Icon } from '../components/Icon.tsx';
import { WorkoutGrid, useWorkoutSummaries } from '../components/WorkoutGrid.tsx';
import { db } from '../db/db.ts';
import { deleteFolder, saveFolder } from '../db/folders.ts';
import { createWorkout } from '../db/workouts.ts';
import type { EditState } from './WorkoutEditor.tsx';
import { t } from '../lib/i18n.ts';

// A folder: its workouts, and a new workout made in it. « Modifier » renames it and takes workouts out of
// it (back to the workouts page), saved with « Enregistrer » or dropped with the cross.
export function Folder() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const leave = useLeave();
  // null once looked up and not found (undefined while loading).
  const folder = useLiveQuery(async () => {
    const f = await db.folders.get(id);
    return f && !f.deleted ? f : null;
  }, [id]);
  const workouts = useWorkoutSummaries(id);
  // While editing: the name typed and the workouts taken out.
  const [draft, setDraft] = useState<{ name: string; takenOut: string[] } | null>(null);

  if (folder === undefined || workouts === undefined) return <div className="page muted">{t('common.loading')}</div>;
  if (folder === null) return <div className="page">{t('folder.notFound')}</div>;

  const create = async () => {
    const state: EditState = { created: true };
    navigate(`/workouts/${await createWorkout(t('workout.newName'), db, id)}/edit`, { state });
  };
  const save = async () => {
    if (!draft) return;
    await saveFolder(id, draft.name, draft.takenOut);
    setDraft(null);
  };
  // The same page while editing: the name can be typed, and each workout has a cross to take it out.
  const shown = draft ? workouts.filter((w) => !draft.takenOut.includes(w.id)) : workouts;
  return (
    <div className="page">
      <header className="row between">
        {draft ? (
          <>
            <button type="button" className="icon-btn" onClick={() => setDraft(null)} aria-label={t('common.cancel')}>
              <Icon name="close" />
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>
              <Icon name="check" size={18} />
              {t('workout.save')}
            </button>
          </>
        ) : (
          <>
            <BackLink to="/" />
            <div className="row" style={{ gap: 4 }}>
              <button
                type="button"
                className="icon-btn btn-danger"
                aria-label={t('folder.delete')}
                onClick={async () => {
                  const sure = await ask({
                    title: t('folder.deleteTitle', { name: folder.name }),
                    message: t('folder.deleteMessage'),
                    confirm: t('editor.delete'),
                    danger: true,
                  });
                  if (!sure) return;
                  await deleteFolder(id);
                  leave('/');
                }}
              >
                <Icon name="trash" size={18} />
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft({ name: folder.name, takenOut: [] })}>
                <Icon name="pencil" size={18} />
                {t('workout.edit')}
              </button>
            </div>
          </>
        )}
      </header>
      {draft ? (
        <input
          className="input title-input"
          aria-label={t('folder.name')}
          placeholder={t('folder.name')}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      ) : (
        <h1 className="title">{folder.name}</h1>
      )}
      {draft && draft.takenOut.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          {t('folder.removedHint')}
        </p>
      )}
      {workouts.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {t('folder.empty')}
        </p>
      )}
      <WorkoutGrid workouts={shown} onTakeOut={draft ? (w) => setDraft({ ...draft, takenOut: [...draft.takenOut, w] }) : undefined} />
      {!draft && (
        <button type="button" className="btn btn-dashed" onClick={create}>
          <Icon name="plus" size={20} />
          {t('home.newWorkout')}
        </button>
      )}
    </div>
  );
}
