import type { ReactNode } from 'react';

// A setting turned on or off: a row with its title, its explanation and a switch.
export function Toggle({ on, onChange, title, text }: { on: boolean; onChange: () => void; title: string; text: ReactNode }) {
  return (
    <button type="button" className="toggle-row" aria-pressed={on} onClick={onChange}>
      <span className="grow stack" style={{ gap: 3 }}>
        <span style={{ fontWeight: 700 }}>{title}</span>
        <span className="small muted" style={{ lineHeight: 1.4 }}>
          {text}
        </span>
      </span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}
