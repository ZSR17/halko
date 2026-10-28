import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

interface Option<T extends string> {
  value: T;
  label: string;
  // Language of the label (a language's own name), for screen readers.
  lang?: string;
}

// Drop-down list drawn by the app, in its colours (a native <select> opens a list drawn by the system).
// Keyboard: arrows, Home/End, Enter or Space to pick, Escape to close.
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const selected = options.findIndex((o) => o.value === value);
  const id = useId();

  // Closes on a tap or click anywhere else.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', outside);
    list.current?.focus();
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, selected));
    setOpen(true);
  };
  const pick = (v: T) => {
    setOpen(false);
    button.current?.focus();
    if (v !== value) onChange(v);
  };
  const onListKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: options.length - 1 };
    if (e.key in moves) {
      e.preventDefault();
      setActive(Math.min(options.length - 1, Math.max(0, moves[e.key]!)));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(options[active]!.value);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <div className="select" ref={box}>
      <button
        ref={button}
        type="button"
        className="input select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label} : ${options[selected]?.label ?? ''}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
      >
        <span className="grow ellipsis" lang={options[selected]?.lang}>
          {options[selected]?.label}
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <ul ref={list} className="select-list" role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={`${id}-${active}`} onKeyDown={onListKey}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === selected}
              lang={o.lang}
              className={i === active ? 'active' : undefined}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              <span className="grow ellipsis">{o.label}</span>
              {i === selected && <Icon name="check" size={16} strokeWidth={3} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
