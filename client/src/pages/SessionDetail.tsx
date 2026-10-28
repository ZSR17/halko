import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, useLeave } from '../components/BackLink.tsx';
import { ask } from '../components/Dialog.tsx';
import { thumbUrl } from '../components/ExerciseMedia.tsx';
import { Icon } from '../components/Icon.tsx';
import { type LocalExercise, type LocalSetLog, db } from '../db/db.ts';
import { deleteSession, exerciseHistory, sessionLogs } from '../db/sessions.ts';
import { formatSetValues } from '../lib/format.ts';
import { metricsForType, recordFor } from '../lib/progress.ts';
import { formatMinutes, formatTonnage, sessionDurationMs, sessionVolumeG } from '../lib/stats.ts';
import { formatDate, t } from '../lib/i18n.ts';

const dateFmt = (ts: number) => formatDate(ts, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Group {
  exercise: LocalExercise | undefined;
  exerciseId: string;
  sets: LocalSetLog[];
  records: string[];
}

export function SessionDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const leave = useLeave();
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(id);
    if (!session || session.deleted) return null;
    const logs = await sessionLogs(id);
    const ids = [...new Set(logs.sort((a, b) => a.position - b.position || a.setIndex - b.setIndex).map((l) => l.exerciseId))];
    const exercises = await db.exercises.bulkGet(ids);
    const groups: Group[] = [];
    for (const [k, exerciseId] of ids.entries()) {
      const exercise = exercises[k];
      const sets = logs.filter((l) => l.exerciseId === exerciseId).sort((a, b) => a.setIndex - b.setIndex);
      const earlier = (await exerciseHistory(exerciseId)).filter((h) => h.session.startedAt < session.startedAt).map((h) => h.sets);
      const records = exercise
        ? metricsForType(exercise.exerciseType).flatMap((m) => {
            const r = recordFor(m, earlier, sets);
            return r ? [t('sessionDetail.record', { label: m.label, value: m.format(r.value), previous: m.format(r.previous) })] : [];
          })
        : [];
      groups.push({ exercise, exerciseId, sets, records });
    }
    const types = new Map(exercises.filter((e) => !!e).map((e) => [e!.id, e!.exerciseType]));
    return { session, logs, groups, volume: sessionVolumeG(logs, types) };
  }, [id]);

  if (data === undefined) return <div className="page muted">{t('common.loading')}</div>;
  if (data === null) {
    return (
      <div className="page">
        <p>{t('sessionDetail.notFound')}</p>
        <Link to="/history">{t('sessionDetail.backToHistory')}</Link>
      </div>
    );
  }
  const { session, logs, groups, volume } = data;
  const records = groups.flatMap((g) => g.records.map((r) => `${g.exercise?.name ?? ''} — ${r}`));

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <header className="row">
        {/* Back where the session was opened from (an exercise, the progress…); the history after
            finishing a session, or when opened directly. */}
        <BackLink to="/history" history={!params.get('done')} />
        <div className="grow" />
        <button
          type="button"
          className="btn btn-ghost btn-danger"
          onClick={async () => {
            const sure = await ask({
              title: t('sessionDetail.deleteTitle'),
              message: t('sessionDetail.deleteMessage'),
              confirm: t('editor.delete'),
              danger: true,
            });
            if (sure) {
              await deleteSession(id);
              if (params.get('done')) navigate('/history', { replace: true });
              else leave('/history');
            }
          }}
        >
          <Icon name="trash" size={18} />
          {t('editor.delete')}
        </button>
      </header>

      {params.get('done') && (
        <p role="status" className="record" style={{ alignSelf: 'flex-start', fontSize: '0.875rem' }}>
          <Icon name="check" size={16} strokeWidth={3} />
          {t('sessionDetail.saved')}
        </p>
      )}
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="title">{session.name}</h1>
        <span className="muted">{capitalize(dateFmt(session.startedAt))}</span>
      </div>

      <section className="stats">
        <div className="stat">
          <span className="value">{formatMinutes(sessionDurationMs(session))}</span>
          <span className="small muted">{t('sessionDetail.duration')}</span>
        </div>
        <div className="stat">
          <span className="value">{logs.length}</span>
          <span className="small muted">{t('sessionDetail.sets')}</span>
        </div>
        {volume > 0 && (
          <div className="stat">
            <span className="value">{formatTonnage(volume)}</span>
            <span className="small muted">{t('sessionDetail.volume')}</span>
          </div>
        )}
      </section>

      {records.length > 0 && (
        <section className="card stack" style={{ gap: 8 }}>
          <h2 className="label">{t('sessionDetail.records')}</h2>
          {records.map((r) => (
            <span key={r} className="row" style={{ gap: 8, fontWeight: 600 }}>
              <span className="check on" aria-hidden="true">
                <Icon name="chart" size={14} />
              </span>
              {r}
            </span>
          ))}
        </section>
      )}

      {groups.map((g) => (
        <section key={g.exerciseId} className="card stack" style={{ gap: 10 }}>
          <Link to={`/exercises/${g.exerciseId}`} className="row" style={{ textDecoration: 'none', color: 'var(--text)' }}>
            <img className="thumb thumb-sm" src={thumbUrl(g.exercise?.mediaUrls ?? [])} alt="" />
            <span className="grow" style={{ fontWeight: 700 }}>
              {g.exercise?.name ?? t('exercise.fallbackName')}
            </span>
          </Link>
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {g.sets.map((s, k) => (
              <li key={s.id} className="row small" style={{ gap: 12 }}>
                <span style={{ width: 52, fontWeight: 700, color: s.kind === 'warmup' ? 'var(--warn)' : 'var(--muted)' }}>
                  {s.kind === 'warmup' ? t('sets.warmupShort') : t('sessionDetail.set', { n: g.sets.slice(0, k + 1).filter((x) => x.kind !== 'warmup').length })}
                </span>
                <span className="num" style={{ fontSize: '1.0625rem' }}>
                  {g.exercise ? formatSetValues(g.exercise.exerciseType, s) : ''}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
