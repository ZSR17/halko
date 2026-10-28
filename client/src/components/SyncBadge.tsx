import { useId } from 'react';
import { Link } from 'react-router-dom';
import { type SyncState, syncStatus } from '../sync/engine.ts';
import { t } from '../lib/i18n.ts';
import type { MessageKey } from '@halko/shared/i18n';

const LABELS: Record<SyncState, MessageKey> = {
  idle: 'sync.idle',
  syncing: 'sync.syncing',
  synced: 'sync.synced',
  offline: 'sync.offline',
  error: 'sync.error',
};

const TONE: Record<SyncState, 'ok' | 'wait' | 'bad'> = {
  idle: 'ok',
  syncing: 'ok',
  synced: 'ok',
  offline: 'wait',
  error: 'bad',
};

// Short labels for cramped headers (live session in a narrow window).
const SHORT: Record<SyncState, MessageKey> = {
  idle: 'sync.shortIdle',
  syncing: 'sync.shortSyncing',
  synced: 'sync.shortIdle',
  offline: 'sync.offline',
  error: 'sync.shortError',
};

const LEGEND: Record<'ok' | 'busy' | 'wait' | 'bad', MessageKey> = {
  ok: 'sync.legendOk',
  busy: 'sync.legendBusy',
  wait: 'sync.legendWait',
  bad: 'sync.legendBad',
};

export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const status = syncStatus.use();
  const tipId = useId();
  const { pending, download } = status;
  // Up to date, it just says « Sync » (the dot tells the state); a routine sync (after a first one) only
  // makes the dot pulse, so the text, and the buttons beside it, do not move at each change. The text
  // changes for what matters (offline, error, download).
  const routine = status.state === 'syncing' && status.lastSyncAt !== null && !download;
  const state = routine ? 'synced' : status.state;
  // Syncing, whatever it says (the first one, or a download): the dot pulses.
  const busy = status.state === 'syncing' || status.state === 'idle';
  const showPending = pending > 0 && state !== 'syncing' && state !== 'synced';
  const pct = download && download.total ? Math.round((download.done / download.total) * 100) : null;
  // What screen readers hear: the state as it is.
  const label = pct !== null ? t('sync.download', { pct }) : t(LABELS[status.state]) + (showPending ? ` · ${t('sync.pending', { count: pending })}` : '');
  const shown = state === 'synced' ? t('sync.shortIdle') : label;
  // The legend of the dot, shown on hover or focus, the current state first among them.
  const now = busy ? 'busy' : TONE[state];
  const legend = (['ok', 'busy', 'wait', 'bad'] as const).map((k) => ({ k, on: k === now }));
  return (
    <span className="sync-wrap">
      <Link to="/settings" className={`sync-badge ${TONE[state]}${busy ? ' busy' : ''}`} aria-label={t('sync.badge', { label })} aria-describedby={tipId}>
        <span className="dot" aria-hidden="true" />
        {compact ? (pct !== null ? `${pct} %` : t(SHORT[state]) + (showPending ? ` · ${pending}` : '')) : shown}
      </Link>
      <span className="sync-tip" role="tooltip" id={tipId}>
        <span className="small muted">{t('sync.legendTitle')}</span>
        {legend.map(({ k, on }) => (
          <span key={k} className={`row small${on ? ' on' : ''}`} style={{ gap: 8 }}>
            <span className={`sync-badge-dot ${k}`} aria-hidden="true" />
            {t(LEGEND[k])}
          </span>
        ))}
      </span>
    </span>
  );
}
