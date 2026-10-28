import { type Appearance, type StorageResponse } from '@halko/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BodyMap } from '../components/BodyMap.tsx';
import { ask } from '../components/Dialog.tsx';
import { Icon } from '../components/Icon.tsx';
import { PrefsChoices } from '../components/PrefsChoices.tsx';
import { Progress } from '../components/Progress.tsx';
import { Toggle } from '../components/Toggle.tsx';
import { db } from '../db/db.ts';
import { resetColors, setAppearance, useAppearance } from '../lib/appearance.ts';
import { api, logout, serverVersion } from '../lib/api.ts';
import { BackupError, backupFileName, exportData, importData, saveJsonAs } from '../lib/backup.ts';
import { onColor } from '../lib/color.ts';
import { soundSettings, testBeep, useNow } from '../lib/feedback.ts';
import { browserLocale, prefs, t } from '../lib/i18n.ts';
import { formatBytes } from '../lib/format.ts';
import { type SyncState, enableSharedAppearance, syncStatus } from '../sync/engine.ts';
import { syncSettings } from '../sync/settings.ts';
import type { MessageKey } from '@halko/shared/i18n';

const STATUS: Record<SyncState, MessageKey> = {
  idle: 'settings.syncIdle',
  syncing: 'settings.syncing',
  synced: 'settings.synced',
  offline: 'settings.offline',
  error: 'settings.syncError',
};

function ago(ts: number | null, now: number): string {
  if (!ts) return t('time.never');
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.minutes', { n: Math.round(s / 60) });
  if (s < 86400) return t('time.hours', { n: Math.round(s / 3600) });
  return t('time.days', { n: Math.round(s / 86400) });
}

// The version running, and what each one brought.
function VersionLine() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void serverVersion().then(setVersion);
  }, []);
  if (!version) return null;
  return (
    <span>
      {t('settings.version', { version })} ·{' '}
      <a href="https://github.com/ZSR17/halko/releases" target="_blank" rel="noreferrer">
        {t('settings.whatsNew')}
      </a>
    </span>
  );
}

function LanguageSection() {
  const { locale, weight, distance } = prefs.use();
  return (
    <section className="stack">
      <h2 className="section-title">{t('prefs.section')}</h2>
      <div className="card">
        <PrefsChoices value={{ locale: locale ?? browserLocale(), weight, distance }} t={t} onChange={(patch) => prefs.set(patch)} />
      </div>
    </section>
  );
}

function SoundSection() {
  const { volume } = soundSettings.use();
  return (
    <section className="stack">
      <h2 className="section-title">{t('settings.beep')}</h2>
      <div className="card stack" style={{ gap: 12 }}>
        <label className="stack" style={{ gap: 8 }}>
          <span className="row between">
            <span style={{ fontWeight: 700 }}>{t('settings.volume')}</span>
            <span className="small muted">{Math.round(volume * 100)} %</span>
          </span>
          <input
            type="range"
            className="range"
            min={10}
            max={100}
            step={10}
            value={Math.round(volume * 100)}
            onChange={(e) => soundSettings.set({ volume: Number(e.target.value) / 100 })}
          />
        </label>
        <span className="small muted" style={{ lineHeight: 1.45 }}>
          {t('settings.volumeHelp')}
        </span>
        <button type="button" className="btn" onClick={testBeep}>
          {t('settings.testBeep')}
        </button>
      </div>
    </section>
  );
}

function SyncSection() {
  const status = syncStatus.use();
  const now = useNow(15_000);
  return (
    <section className="stack">
      <h2 className="section-title">{t('settings.sync')}</h2>
      <div className="card stack">
        <div className="row">
          <span className="icon-btn" style={{ background: 'var(--surface2)', color: status.state === 'synced' ? 'var(--accent-text)' : 'var(--warn)' }} aria-hidden="true">
            <Icon name="cloud" />
          </span>
          <div className="grow stack" style={{ gap: 2 }} role="status">
            <span style={{ fontWeight: 700 }}>{t(STATUS[status.state])}</span>
            <span className="small muted">
              {t('settings.lastSync', { when: ago(status.lastSyncAt, now) })}
              {` · ${status.pending > 0 ? t('settings.pending', { count: status.pending }) : t('settings.nothingPending')}`}
            </span>
          </div>
        </div>
        {status.rejected > 0 && (
          <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>
            {t('settings.rejected', { count: status.rejected })}
          </p>
        )}
      </div>
    </section>
  );
}

interface Device {
  id: string;
  name: string;
  lastSeenAt: number;
  current: boolean;
}

function DevicesSection() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNow(60_000);
  const load = useCallback(() => {
    api<Device[]>('/devices')
      .then((d) => {
        setDevices(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="stack">
      <h2 className="section-title">{t('settings.devices')}</h2>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {failed && <p className="small muted" style={{ margin: 0, padding: 14 }}>{t('settings.devicesOffline')}</p>}
        {devices?.map((d) => (
          <div key={d.id} className="toggle-row" style={{ cursor: 'default' }}>
            <span className="grow stack" style={{ gap: 2 }}>
              <span style={{ fontWeight: 700 }}>
                {d.name}
                {d.current && t('settings.thisDevice')}
              </span>
              <span className="small muted">{t('settings.seen', { when: ago(d.lastSeenAt, now) })}</span>
            </span>
            {!d.current && (
              <button
                type="button"
                className="btn btn-ghost btn-danger"
                onClick={async () => {
                  const sure = await ask({
                    title: t('settings.disconnectTitle', { name: d.name }),
                    message: t('settings.disconnectMessage'),
                    confirm: t('settings.disconnect'),
                    danger: true,
                  });
                  if (sure) {
                    await api(`/devices/${d.id}`, { method: 'DELETE' });
                    load();
                  }
                }}
              >
                {t('settings.disconnect')}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function StorageSection() {
  const [server, setServer] = useState<StorageResponse | null | 'offline'>(null);
  const [device, setDevice] = useState<{ usage: number; persisted: boolean } | null>(null);
  useEffect(() => {
    api<StorageResponse>('/storage')
      .then(setServer)
      .catch(() => setServer('offline'));
    void (async () => {
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
      if (estimate?.usage !== undefined) setDevice({ usage: estimate.usage, persisted });
    })();
  }, []);

  return (
    <section className="stack">
      <h2 className="section-title">{t('settings.storage')}</h2>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="toggle-row" style={{ cursor: 'default' }}>
          <span className="grow stack" style={{ gap: 2 }}>
            <span style={{ fontWeight: 700 }}>{t('settings.server')}</span>
            <span className="small muted">
              {server === null
                ? t('settings.computing')
                : server === 'offline'
                  ? t('settings.storageOffline')
                  : t('settings.serverUsage', { files: server.media.files, media: formatBytes(server.media.bytes), data: formatBytes(server.databaseBytes) })}
            </span>
          </span>
          {server && server !== 'offline' && (
            <span style={{ fontWeight: 700 }}>{formatBytes(server.media.bytes + server.databaseBytes)}</span>
          )}
        </div>
        <div className="toggle-row" style={{ cursor: 'default' }}>
          <span className="grow stack" style={{ gap: 2 }}>
            <span style={{ fontWeight: 700 }}>{t('settings.device')}</span>
            <span className="small muted">
              {device === null
                ? t('settings.unknown')
                : device.persisted
                  ? t('settings.persisted')
                  : t('settings.notPersisted')}
            </span>
          </span>
          {device && <span style={{ fontWeight: 700 }}>{formatBytes(device.usage)}</span>}
        </div>
      </div>
      <span className="small muted">{t('settings.mediaCleanup')}</span>
    </section>
  );
}

function BackupSection() {
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const { imported } = await importData(JSON.parse(await f.text()));
      setMessage({ text: imported ? t('settings.imported', { count: imported }) : t('settings.nothingNew') });
    } catch (err) {
      setMessage({ text: err instanceof BackupError ? err.message : t('settings.unreadable'), bad: true });
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <section className="stack">
      <h2 className="section-title">{t('settings.data')}</h2>
      <div className="card stack">
        <span className="small muted" style={{ lineHeight: 1.45 }}>
          {t('settings.dataHelp')}
        </span>
        <div className="row wrap" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn grow"
            onClick={async () => {
              const save = await saveJsonAs(backupFileName());
              if (save) await save(await exportData());
            }}
          >
            {t('settings.export')}
          </button>
          <button type="button" className="btn grow" onClick={() => file.current?.click()}>
            {t('settings.import')}
          </button>
        </div>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
        {message && (
          <p className="small" role="status" style={{ margin: 0, color: message.bad ? 'var(--warn)' : 'var(--accent-text)' }}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}

type ColorKey = 'accent' | 'musclePrimary' | 'muscleSecondary';

// Each swatch has a name, read out by screen readers instead of its code.
const COLOR_NAMES: Record<string, MessageKey> = {
  '#D4FF3A': 'color.lime',
  '#7CC4FF': 'color.sky',
  '#FF8A3D': 'color.orange',
  '#B79CFF': 'color.lavender',
  '#4BE3A4': 'color.mint',
  '#FF5C8A': 'color.pink',
  '#F2F4F5': 'color.white',
  '#FF4D2E': 'color.redOrange',
  '#E63946': 'color.red',
  '#C77DFF': 'color.purple',
  '#3A86FF': 'color.blue',
  '#06D6A0': 'color.green',
  '#FFD166': 'color.yellow',
  '#FFE8A3': 'color.paleYellow',
  '#9BE7FF': 'color.lightBlue',
  '#B8F2C9': 'color.paleGreen',
  '#FFB3C1': 'color.lightPink',
};

const ROWS: { key: ColorKey; label: MessageKey; swatches: string[] }[] = [
  { key: 'accent', label: 'settings.accent', swatches: ['#D4FF3A', '#7CC4FF', '#FF8A3D', '#B79CFF', '#4BE3A4', '#FF5C8A', '#F2F4F5'] },
  { key: 'musclePrimary', label: 'settings.musclePrimary', swatches: ['#FF4D2E', '#E63946', '#FF8A3D', '#C77DFF', '#3A86FF', '#06D6A0'] },
  { key: 'muscleSecondary', label: 'settings.muscleSecondary', swatches: ['#FFD166', '#FFE8A3', '#9BE7FF', '#B8F2C9', '#FFB3C1', '#FF8A3D'] },
];

const THEMES: { id: Appearance['theme']; label: MessageKey }[] = [
  { id: 'dark', label: 'settings.dark' },
  { id: 'light', label: 'settings.light' },
  { id: 'auto', label: 'settings.auto' },
];

export function Settings() {
  const a = useAppearance();
  const shared = syncSettings.use().shareAppearance;

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="title">{t('settings.title')}</h1>

      <LanguageSection />

      <SyncSection />

      <SoundSection />

      <section className="stack">
        <h2 className="section-title">{t('settings.appearance')}</h2>
        <div className="seg" role="group" aria-label={t('settings.theme')} style={{ background: 'var(--surface)' }}>
          {THEMES.map((theme) => (
            <button key={theme.id} type="button" aria-pressed={a.theme === theme.id} onClick={() => setAppearance({ theme: theme.id })}>
              {t(theme.label)}
            </button>
          ))}
        </div>

        <div className="card stack" style={{ gap: 16 }}>
          {ROWS.map((row) => {
            const custom = !row.swatches.includes(a[row.key].toUpperCase());
            return (
              <fieldset key={row.key} className="stack" style={{ gap: 8, border: 0, margin: 0, padding: 0 }}>
                <legend style={{ fontWeight: 700, padding: 0, marginBottom: 8 }}>{t(row.label)}</legend>
                <div className="row wrap" style={{ gap: 8 }}>
                  {row.swatches.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="swatch"
                      style={{ background: c }}
                      aria-pressed={a[row.key].toUpperCase() === c}
                      aria-label={t('settings.swatch', { label: t(row.label), color: t(COLOR_NAMES[c]!) })}
                      onClick={() => setAppearance({ [row.key]: c })}
                    />
                  ))}
                  <label
                    className="swatch swatch-custom"
                    style={custom ? { background: a[row.key], borderStyle: 'solid', borderColor: 'var(--text)' } : undefined}
                  >
                    {!custom && '+'}
                    <span className="sr-only">{t(custom ? 'settings.customColorChosen' : 'settings.customColor', { label: t(row.label) })}</span>
                    <input type="color" value={a[row.key]} onChange={(e) => setAppearance({ [row.key]: e.target.value.toUpperCase() })} />
                  </label>
                </div>
              </fieldset>
            );
          })}

          <div className="row" style={{ padding: 12, borderRadius: 14, background: 'var(--bg)' }}>
            <div className="grow stack" style={{ gap: 8 }}>
              <span className="label">{t('settings.preview')}</span>
              <span
                className="btn"
                style={{ background: a.accent, color: onColor(a.accent), borderColor: a.accent, minHeight: 42 }}
              >
                {t('settings.previewButton')}
              </span>
            </div>
            <BodyMap
              primary={['quads']}
              secondary={['glutes', 'hamstrings', 'calves', 'lowerback']}
              height={92}
              legend={false}
              colors={{ primary: a.musclePrimary, secondary: a.muscleSecondary }}
            />
          </div>
          <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', color: 'var(--muted)' }} onClick={resetColors}>
            {t('settings.resetColors')}
          </button>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <Toggle
            on={shared}
            onChange={() => (shared ? syncSettings.set({ shareAppearance: false }) : void enableSharedAppearance())}
            title={t('settings.sharedColors')}
            text={
              shared
                ? t('settings.sharedOn')
                : t('settings.sharedOff')
            }
          />
        </div>
      </section>

      <StorageSection />

      <BackupSection />

      <DevicesSection />

      <section className="stack">
        <h2 className="section-title">{t('settings.account')}</h2>
        <button
          type="button"
          className="btn btn-danger-solid"
          onClick={async () => {
            const sure = await ask({
              title: t('settings.logoutTitle'),
              confirm: t('settings.logoutConfirm'),
              danger: true,
            });
            if (sure) logout();
          }}
        >
          {t('settings.logout')}
        </button>
      </section>

      <section className="stack small muted" style={{ gap: 4 }}>
        <h2 className="section-title">{t('settings.about')}</h2>
        <VersionLine />
        <span>{t('settings.creditLibrary')}</span>
        <span>{t('settings.creditBody')}</span>
      </section>
    </div>
  );
}
