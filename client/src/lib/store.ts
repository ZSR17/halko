import { useSyncExternalStore } from 'react';

// Tiny observable value, optionally persisted in localStorage (per device), with a React hook.
export function createStore<T extends object>(initial: T, storageKey?: string) {
  let value = initial;
  if (storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) value = { ...initial, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      // Storage unavailable or corrupted: keep defaults.
    }
  }
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    get: () => value,
    set(patch: Partial<T>) {
      value = { ...value, ...patch };
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(value));
        } catch {
          // ignore
        }
      }
      for (const l of listeners) l();
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}
