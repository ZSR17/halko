import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink.tsx';
import { BodyMap } from '../components/BodyMap.tsx';
import { ExerciseMedia } from '../components/ExerciseMedia.tsx';
import { ExerciseProgress } from '../components/ExerciseProgress.tsx';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { db } from '../db/db.ts';
import { exerciseHistory } from '../db/sessions.ts';
import { createWorkout } from '../db/workouts.ts';
import { metricLongLabel, metricsFor } from '../lib/targets.ts';
import type { EditState } from './WorkoutEditor.tsx';
import { equipmentName, exerciseTypeName, levelName, muscleName, t } from '../lib/i18n.ts';


export function ExerciseDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  // null once looked up and not found (undefined while loading).
  const exercise = useLiveQuery(async () => (await db.exercises.get(id)) ?? null, [id]);
  const workouts = useLiveQuery(() => db.workouts.orderBy('position').filter((w) => !w.deleted).toArray(), []);
  const history = useLiveQuery(() => exerciseHistory(id), [id]);
  const [bigMap, setBigMap] = useState(false);
  const [picking, setPicking] = useState(false);

  if (exercise === undefined) return <div className="page muted">{t('common.loading')}</div>;
  if (exercise === null) return <div className="page">{t('exercise.notFound')}</div>;

  // Opens the workout's edit page with the exercise added; cancelling there leaves the workout as it was
  // (and drops a workout created for it).
  const addTo = (workoutId: string, created = false) => {
    const state: EditState = { add: exercise.id, created };
    navigate(`/workouts/${workoutId}/edit`, { state });
  };

  return (
    <div className="page page-hero" style={{ maxWidth: 820 }}>
      <ExerciseMedia urls={exercise.mediaUrls} name={exercise.name} className="hero-media">
        {/* Back where the exercise was opened from (a workout, the history…); the library otherwise. */}
        <BackLink to="/exercises" className="on-media" style={{ position: 'absolute', top: 14, left: 16 }} />
        <Link
          to={`/exercises/${exercise.id}/edit`}
          // The editor then returns here by going back, instead of opening this page again.
          state={{ fromDetail: true }}
          className="icon-btn on-media"
          aria-label={t('exercise.edit')}
          style={{ position: 'absolute', top: 14, right: 16 }}
        >
          <Icon name="pencil" />
        </Link>
        <button
          type="button"
          onClick={() => setBigMap((v) => !v)}
          aria-label={bigMap ? t('exercise.shrinkMap') : t('exercise.growMap')}
          aria-expanded={bigMap}
          style={{ position: 'absolute', right: 12, bottom: 12, padding: 6, borderRadius: 12, border: 0, background: 'var(--surface)', cursor: 'pointer' }}
        >
          <BodyMap primary={exercise.primaryMuscles} secondary={exercise.secondaryMuscles} height={96} legend={false} />
        </button>
      </ExerciseMedia>

      <div className="stack" style={{ gap: 8 }}>
        <h1 className="title" style={{ fontSize: '2.125rem' }}>
          {exercise.name}
        </h1>
        <div className="row wrap" style={{ gap: 8 }}>
          {exercise.equipment.map((q) => (
            <span key={q} className="tag">
              {equipmentName(q)}
            </span>
          ))}
          {exercise.level && <span className="tag">{levelName(exercise.level)}</span>}
        </div>
      </div>

      {bigMap && (
        <div className="card" style={{ display: 'flex', justifyContent: 'center' }}>
          <BodyMap primary={exercise.primaryMuscles} secondary={exercise.secondaryMuscles} height={220} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <div className="card stack" style={{ gap: 6 }}>
          <span className="row small" style={{ gap: 6, fontWeight: 700 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--muscle-primary)' }} />
            {t('exercise.primary')}
          </span>
          <span style={{ fontWeight: 600 }}>{exercise.primaryMuscles.map(muscleName).join(', ') || '—'}</span>
        </div>
        <div className="card stack" style={{ gap: 6 }}>
          <span className="row small" style={{ gap: 6, fontWeight: 700 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--muscle-secondary)' }} />
            {t('exercise.secondary')}
          </span>
          <span style={{ fontWeight: 600 }}>{exercise.secondaryMuscles.map(muscleName).join(', ') || '—'}</span>
        </div>
      </div>
      {exercise.source === 'builtin' && (
        <span className="small muted">{exercise.customized ? t('exercise.yourVersion') : t('exercise.musclesSource')}</span>
      )}

      <div className="card row between wrap">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">{t('exercise.type')}</span>
          <span style={{ fontWeight: 700 }}>{exerciseTypeName(exercise.exerciseType)}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {metricsFor(exercise.exerciseType).map((m) => (
            <span key={m} className="tag">
              {metricLongLabel(m, exercise.exerciseType)}
            </span>
          ))}
          {exercise.unilateral && <span className="tag">{t('exercise.unilateral')}</span>}
        </div>
      </div>

      {!!history?.length && (
        <section className="stack">
          <h2 className="label">{t('exercise.history')}</h2>
          <ExerciseProgress exercise={exercise} history={history} />
        </section>
      )}

      {exercise.instructions.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2 className="label">{t('exercise.howTo')}</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.5, color: 'var(--muted)' }}>
            {exercise.instructions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}

      <button type="button" className="btn btn-primary" onClick={() => setPicking(true)}>
        <Icon name="plus" size={20} />
        {t('exercise.addTo')}
      </button>

      {picking && (
        <Sheet title={t('exercise.addTo')} onClose={() => setPicking(false)}>
          {workouts?.map((w) => (
            <button key={w.id} type="button" className="list-item" onClick={() => addTo(w.id)}>
              <span className="grow" style={{ fontWeight: 700 }}>
                {w.name}
              </span>
              <Icon name="chevron" size={18} />
            </button>
          ))}
          <button type="button" className="btn btn-dashed" onClick={async () => addTo(await createWorkout(t('workout.newName')), true)}>
            <Icon name="plus" size={20} />
            {t('home.newWorkout')}
          </button>
        </Sheet>
      )}
    </div>
  );
}
