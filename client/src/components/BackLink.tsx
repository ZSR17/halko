import type { CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon.tsx';
import { t } from '../lib/i18n.ts';

// Leaves the page the way it was entered: back in the browser history, so the previous page is not
// opened a second time (a later "back" would then return here). `to` when there is no earlier page
// in the app (opened from a link or a bookmark).
export function useLeave() {
  const navigate = useNavigate();
  const location = useLocation();
  return (to: string) => (location.key === 'default' ? navigate(to, { replace: true }) : navigate(-1));
}

// Back arrow of a page (or a cross, to cancel an edit); with `history` false, it always goes to `to`.
export function BackLink({
  to,
  label = t('common.back'),
  history = true,
  icon = 'back',
  className,
  style,
}: {
  to: string;
  label?: string;
  history?: boolean;
  icon?: IconName;
  className?: string;
  style?: CSSProperties;
}) {
  const leave = useLeave();
  return (
    <Link
      to={to}
      onClick={(e) => {
        if (!history) return;
        e.preventDefault();
        leave(to);
      }}
      className={`icon-btn${className ? ` ${className}` : ''}`}
      aria-label={label}
      style={style}
    >
      <Icon name={icon} />
    </Link>
  );
}
