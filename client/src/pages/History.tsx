import type { ExerciseType } from '@halko/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon.tsx';
import { ExerciseProgress } from '../components/ExerciseProgress.tsx';
import { type LocalExercise, type LocalSession, type LocalSetLog, db } from '../db/db.ts';
import { exerciseHistory, finishedSessions } from '../db/sessions.ts';
import { formatMinutes, formatTonnage, sessionDurationMs, sessionVolumeG, startOfWeek } from '../lib/stats.ts';
import { formatDate, t } from '../lib/i18n.ts';
import { Select } from '../components/Select.tsx';

const dayFmt = (ts: number) => formatDate(ts, { day: 'numeric' });
const monthFmt = (ts: number) => formatDate(ts, { month: 'short' });
const monthYearFmt = (ts: number) => formatDate(ts, { month: 'long', year: 'numeric' });
const fullFmt = (ts: number) => formatDate(ts, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function useHistoryData() {
  return useLiveQuery(async () => {
    const sessions = await finishedSessions();
    const ids = new Set(sessions.map((s) => s.id));
    const logs = (await db.setLogs.toArray()).filter((l) => !l.deleted && ids.has(l.sessionId));
    const exerciseIds = [...new Set(logs.map((l) => l.exerciseId))];
    const exercises = (await db.exercises.bulkGet(exerciseIds)).filter((e): e is LocalExercise => !!e);
    return { sessions, logs, exercises };
  }, []);
}

export function History() {
  const data = useHistoryData();
  const [tab, setTab] = useState<'sessions' | 'progress'>('sessions');

  const types = useMemo(() => new Map<string, ExerciseType>(data?.exercises.map((e) => [e.id, e.exerciseType]) ?? []), [data]);
  const bySession = useMemo(() => {
    const m = new Map<string, NonNullable<typeof data>['logs']>();
    for (const l of data?.logs ?? []) m.set(l.sessionId, [...(m.get(l.sessionId) ?? []), l]);
    return m;
  }, [data]);

  if (!data) return <div className="page muted">{t('common.loading')}</div>;

  const week = data.sessions.filter((s) => s.startedAt >= startOfWeek());
  const months: { key: string; sessions: LocalSession[]; volume: number }[] = [];
  for (const s of data.sessions) {
    const d = new Date(s.startedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (months.at(-1)?.key !== key) months.push({ key, sessions: [], volume: 0 });
    const month = months.at(-1)!;
    month.sessions.push(s);
    month.volume += sessionVolumeG(bySession.get(s.id) ?? [], types);
  }
  const weekLogs = week.flatMap((s) => bySession.get(s.id) ?? []);

  return (
    <div className="page">
      <h1 className="title">{t('history.title')}</h1>

      <section className="stats" aria-label={t('history.thisWeek')}>
        <div className="stat">
          <span className="value">{week.length}</span>
          <span className="small muted">{t('history.weekSessions', { count: week.length })}</span>
        </div>
        <div className="stat">
          <span className="value">{formatTonnage(sessionVolumeG(weekLogs, types))}</span>
          <span className="small muted">{t('history.volumeLifted')}</span>
        </div>
        <div className="stat">
          <span className="value">{formatMinutes(week.reduce((n, s) => n + sessionDurationMs(s), 0))}</span>
          <span className="small muted">{t('history.training')}</span>
        </div>
      </section>

      <div className="seg" role="group" aria-label={t('history.display')} style={{ background: 'var(--surface)' }}>
        <button type="button" aria-pressed={tab === 'sessions'} onClick={() => setTab('sessions')}>
          {t('history.sessions')}
        </button>
        <button type="button" aria-pressed={tab === 'progress'} onClick={() => setTab('progress')}>
          {t('history.progress')}
        </button>
      </div>

      {tab === 'sessions' ? (
        <div className="stack" style={{ gap: 8 }}>
          {data.sessions.length === 0 && <p className="muted">{t('history.none')}</p>}
          {months.map((m, i) => (
            // Months are folded, except the latest: a long history stays short to scroll.
            <details key={m.key} className="month" open={i === 0}>
              <summary className="month-head">
                <span className="grow" style={{ fontWeight: 700, textTransform: 'capitalize' }}>
                  {monthYearFmt(m.sessions[0]!.startedAt)}
                </span>
                <span className="small muted">
                  {t('history.monthSessions', { count: m.sessions.length })}
                  {m.volume > 0 && ` · ${formatTonnage(m.volume)}`}
                </span>
                <Icon name="chevron" size={18} />
              </summary>
              <div className="stack" style={{ gap: 8 }}>
                {m.sessions.map((s) => (
                  <SessionRow key={s.id} session={s} logs={bySession.get(s.id) ?? []} types={types} />
                ))}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <Progress exercises={data.exercises} logs={data.logs} />
      )}
    </div>
  );
}

function SessionRow({ session: s, logs, types }: { session: LocalSession; logs: LocalSetLog[]; types: Map<string, ExerciseType> }) {
  const volume = sessionVolumeG(logs, types);
  return (
    <Link to={`/history/${s.id}`} className="list-item" style={{ padding: '12px 14px' }}>
      <span className="stack" style={{ width: 44, alignItems: 'center', gap: 0 }} aria-label={fullFmt(s.startedAt)}>
        <span className="num" style={{ fontSize: '1.375rem', lineHeight: 1 }}>
          {dayFmt(s.startedAt)}
        </span>
        <span className="small muted">{monthFmt(s.startedAt)}</span>
      </span>
      <span className="grow stack" style={{ gap: 2 }}>
        <span className="ellipsis" style={{ fontWeight: 700 }}>
          {s.name}
        </span>
        <span className="small muted">
          {formatMinutes(sessionDurationMs(s))} · {t('sets.count', { count: logs.length })}
          {volume > 0 && ` · ${formatTonnage(volume)}`}
        </span>
      </span>
      <Icon name="chevron" size={18} />
    </Link>
  );
}

function Progress({ exercises, logs }: { exercises: LocalExercise[]; logs: { exerciseId: string; completedAt: number }[] }) {
  // Most recently trained first.
  const ordered = useMemo(() => {
    const last = new Map<string, number>();
    for (const l of logs) last.set(l.exerciseId, Math.max(last.get(l.exerciseId) ?? 0, l.completedAt));
    return [...exercises].sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0));
  }, [exercises, logs]);
  const [selected, setSelected] = useState<string | null>(null);
  const exercise = ordered.find((e) => e.id === selected) ?? ordered[0];
  const history = useLiveQuery(() => (exercise ? exerciseHistory(exercise.id) : []), [exercise?.id]);

  if (!exercise) return <p className="muted">{t('history.noProgress')}</p>;

  return (
    <div className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <span className="label">{t('history.exercise')}</span>
        <Select label={t('history.exercise')} value={exercise.id} options={ordered.map((e) => ({ value: e.id, label: e.name }))} onChange={setSelected} />
      </div>
      <ExerciseProgress exercise={exercise} history={history ?? []} />
    </div>
  );
}
