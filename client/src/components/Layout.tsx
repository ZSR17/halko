import { useLiveQuery } from 'dexie-react-hooks';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { db } from '../db/db.ts';
import { Icon, type IconName } from './Icon.tsx';
import { t } from '../lib/i18n.ts';
import type { MessageKey } from '@halko/shared/i18n';

// `short` replaces the label in the bottom tab bar, where long labels do not fit.
const NAV: { to: string; label: MessageKey; short?: MessageKey; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'nav.workouts', icon: 'home', end: true },
  { to: '/exercises', label: 'nav.exercises', icon: 'dumbbell' },
  { to: '/history', label: 'nav.history', icon: 'chart' },
  { to: '/plates', label: 'nav.plates', short: 'nav.platesShort', icon: 'plate' },
  { to: '/1rm', label: 'nav.oneRm', short: 'nav.oneRmShort', icon: 'percent' },
  { to: '/settings', label: 'nav.settings', icon: 'settings' },
];

// Bottom tab bar in narrow windows, sidebar on wide screens (same app, see styles.css).
export function Layout() {
  const { pathname } = useLocation();
  const live = useLiveQuery(() => db.meta.get('live'), []);
  const showLive = !!live && pathname !== '/session';

  return (
    <div className="shell">
      <nav className="sidebar" aria-label={t('nav.main')}>
        <span className="brand">Halko</span>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
            <Icon name={n.icon} size={20} />
            {t(n.label)}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        {showLive && (
          <Link to="/session" className="live-banner">
            <span className="dot" aria-hidden="true" />
            {t('nav.liveSession')}
            <span className="grow" />
            {t('nav.resume')}
            <Icon name="chevron" size={18} />
          </Link>
        )}
        <Outlet />
      </main>
      <nav className="tabbar" aria-label={t('nav.main')}>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <Icon name={n.icon} size={24} />
            {t(n.short ?? n.label)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
