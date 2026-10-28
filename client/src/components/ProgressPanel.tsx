import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LocalSession } from '../db/db.ts';
import { createStore } from '../lib/store.ts';
import { LineChart } from './LineChart.tsx';
import { formatDate, t } from '../lib/i18n.ts';
import type { MessageKey } from '@halko/shared/i18n';

// Months shown by the chart, counted back from today (0 = since the first session).
const PERIODS = {
  '3m': { label: 'progress.period3m', months: 3 },
  '1y': { label: 'progress.period1y', months: 12 },
  all: { label: 'progress.periodAll', months: 0 },
} as const satisfies Record<string, { label: MessageKey; months: number }>;
type Period = keyof typeof PERIODS;
// The chart's period, remembered on the device.
const chartSettings = createStore<{ period: Period }>({ period: '3m' }, 'halko.chart');

// Sessions listed under the chart before "See the … other sessions".
const LISTED = 5;

const shortFmt = (ts: number) => formatDate(ts, { day: 'numeric', month: 'short', year: 'numeric' });
const fullFmt = (ts: number) => formatDate(ts, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// One measure of the sessions (charge, volume, duration…): its value for each session, oldest first.
export interface PanelMetric {
  id: string;
  label: string;
  format: (v: number) => string;
  // Stored units in one unit shown (see LineChart).
  scale?: number;
  higherIsBetter: boolean;
  // Whether its best value is a record (not for an estimate, or a duration).
  record: boolean;
  rows: { session: LocalSession; value: number; detail?: string }[];
}

// Records, then the chart of one measure at a time over a chosen period, and with `detailLabel`, the
// table of its sessions (that column showing each row's `detail`).
export function ProgressPanel({ name, metrics, detailLabel }: { name: string; metrics: PanelMetric[]; detailLabel?: string }) {
  const [metricId, setMetricId] = useState<string | null>(null);
  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
  const { period } = chartSettings.use();
  const [expanded, setExpanded] = useState(false);
  if (!metric) return null;

  const best = (m: PanelMetric) =>
    m.rows.reduce<PanelMetric['rows'][number] | undefined>(
      // The first session to reach it, on a tie.
      (top, r) => (!top || (m.higherIsBetter ? r.value > top.value : r.value < top.value) ? r : top),
      undefined,
    );
  const records = metrics.filter((m) => m.record).map((m) => ({ metric: m, best: best(m) })).filter((r) => r.best);
  const record = best(metric);

  const since = new Date();
  since.setMonth(since.getMonth() - PERIODS[period].months);
  const shown = PERIODS[period].months ? metric.rows.filter((r) => r.session.startedAt >= since.getTime()) : metric.rows;
  // The table follows the chart's period, latest first.
  const latest = [...shown].reverse();
  const listed = expanded ? latest : latest.slice(0, LISTED);

  return (
    <>
      {records.length > 0 && (
        <div className="stats" aria-label={t('progress.records')}>
          {records.map(({ metric: m, best: b }) => (
            <Link key={m.id} to={`/history/${b!.session.id}`} className="stat record-stat">
              <span className="small muted">{m.label}</span>
              <span className="value">{m.format(b!.value)}</span>
              <span className="small muted">{shortFmt(b!.session.startedAt)}</span>
            </Link>
          ))}
        </div>
      )}
      {metrics.length > 1 && (
        <div className="chips" role="group" aria-label={t('progress.measure')}>
          {metrics.map((m) => (
            <button key={m.id} type="button" className="chip" aria-pressed={m.id === metric.id} onClick={() => setMetricId(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      )}
      <div className="card stack">
        <div className="row between wrap">
          <h2 style={{ fontSize: '0.9375rem' }}>
            {metric.label} · {name}
          </h2>
          {record && (
            // Hidden rather than removed when it is not a record, so the chart does not move when switching.
            <span className="record" style={metric.record ? undefined : { visibility: 'hidden' }} aria-hidden={!metric.record}>
              {t('progress.record', { value: metric.format(record.value) })}
            </span>
          )}
        </div>
        <div className="seg" role="group" aria-label={t('progress.period')}>
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <button key={p} type="button" aria-pressed={p === period} onClick={() => (chartSettings.set({ period: p }), setExpanded(false))}>
              {t(PERIODS[p].label)}
            </button>
          ))}
        </div>
        {shown.length < 2 && (
          <p className="small muted" style={{ margin: 0 }}>
            {metric.rows.length < 2 ? t('progress.needTwo') : t('progress.needLonger')}
          </p>
        )}
        {shown.length >= 2 && (
          <LineChart points={shown.map((r) => ({ t: r.session.startedAt, y: r.value }))} format={metric.format} scale={metric.scale} label={`${metric.label}, ${name}`} />
        )}
      </div>
      {detailLabel && listed.length > 0 && (
        <div className="card stack" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('progress.date')}</th>
                <th scope="col">{metric.label}</th>
                <th scope="col">{detailLabel}</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((r) => (
                <tr key={r.session.id}>
                  <td>
                    <Link to={`/history/${r.session.id}`}>{fullFmt(r.session.startedAt)}</Link>
                  </td>
                  <td style={{ fontWeight: 700 }}>{metric.format(r.value)}</td>
                  <td className="small muted">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > LISTED && (
            <button type="button" className="btn btn-ghost" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
              {expanded ? t('progress.less') : t('progress.more', { count: shown.length - LISTED })}
            </button>
          )}
        </div>
      )}
    </>
  );
}
