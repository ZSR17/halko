import { type Appearance, DEFAULT_APPEARANCE } from '@halko/shared';
import { useSyncExternalStore } from 'react';
import { contrastRatio, isHexColor, onColor } from './color.ts';

// Per-device appearance (localStorage). Phase 4 adds the optional cross-device sync.
const KEY = 'halko.appearance';

const THEMES = {
  dark: { bg: '#0E1012', surface: '#181B1F', surface2: '#22262B', line: '#2C3137', text: '#F2F4F5', muted: '#9AA3AD' },
  light: { bg: '#F4F5F7', surface: '#FFFFFF', surface2: '#ECEEF1', line: '#D9DDE2', text: '#111418', muted: '#57616B' },
} as const;
// With "Increase contrast" turned on: lines and secondary text stand out more (lines 3:1 on every surface).
const HIGH_CONTRAST = {
  dark: { line: '#6B737D', muted: '#C4CBD2' },
  light: { line: '#727B85', muted: '#3B434B' },
} as const;

function read(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) };
    for (const k of ['accent', 'musclePrimary', 'muscleSecondary'] as const) {
      if (!isHexColor(parsed[k])) parsed[k] = DEFAULT_APPEARANCE[k];
    }
    return parsed;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

let current = read();
const listeners = new Set<() => void>();
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const contrastQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-contrast: more)') : null;

function resolvedTheme(a: Appearance): 'dark' | 'light' {
  if (a.theme === 'auto') return darkQuery?.matches === false ? 'light' : 'dark';
  return a.theme;
}

export function applyAppearance(a: Appearance = current): void {
  const mode = resolvedTheme(a);
  const t = { ...THEMES[mode], ...(contrastQuery?.matches ? HIGH_CONTRAST[mode] : {}) };
  const s = document.documentElement.style;
  for (const [k, v] of Object.entries(t)) s.setProperty(`--${k}`, v);
  s.setProperty('--accent', a.accent);
  s.setProperty('--on-accent', onColor(a.accent));
  // Accent used as text/icon colour must stay readable on the background.
  s.setProperty('--accent-text', contrastRatio(a.accent, t.bg) >= 3 ? a.accent : t.text);
  s.setProperty('--muscle-primary', a.musclePrimary);
  s.setProperty('--muscle-secondary', a.muscleSecondary);
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
}

// Called when the user edits the appearance on this device (not when a shared one is applied).
const editListeners = new Set<(a: Appearance) => void>();
export function onAppearanceEdited(listener: (a: Appearance) => void): () => void {
  editListeners.add(listener);
  return () => editListeners.delete(listener);
}

export function getAppearance(): Appearance {
  return current;
}

// Applies the appearance shared by the user's other devices.
export function applySharedAppearance(a: Appearance): void {
  store({ ...DEFAULT_APPEARANCE, ...a });
}

export function setAppearance(patch: Partial<Appearance>): void {
  store({ ...current, ...patch });
  for (const l of editListeners) l(current);
}

function store(next: Appearance): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode / storage disabled: keep the in-memory value.
  }
  applyAppearance();
  for (const l of listeners) l();
}

export function resetColors(): void {
  setAppearance({
    accent: DEFAULT_APPEARANCE.accent,
    musclePrimary: DEFAULT_APPEARANCE.musclePrimary,
    muscleSecondary: DEFAULT_APPEARANCE.muscleSecondary,
  });
}

darkQuery?.addEventListener('change', () => {
  if (current.theme === 'auto') applyAppearance();
});
contrastQuery?.addEventListener('change', () => applyAppearance());

// Another tab/window of the app changed the colours.
addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  current = read();
  applyAppearance();
  for (const l of listeners) l();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => current);
}
