import { type ReactNode, useEffect, useRef } from 'react';
import { Icon } from './Icon.tsx';
import { t } from '../lib/i18n.ts';

// `wide`: room for content side by side on a large screen, and the same size whatever it holds.
export function Sheet({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, so a new function on each render does not set the sheet up again (focus, scroll).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    // Unless a field of the sheet took it (autoFocus).
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'sheet sheet-wide' : 'sheet'} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="row between" style={{ padding: '14px 16px' }}>
          <h2 style={{ fontSize: '1.0625rem' }}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
