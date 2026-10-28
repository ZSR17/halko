import { createStore } from '../lib/store.ts';

// Per-device sync preferences (never synced themselves).
interface SyncSettings {
  // Use the appearance shared by all devices instead of this device's own.
  shareAppearance: boolean;
}

export const syncSettings = createStore<SyncSettings>({ shareAppearance: false }, 'halko.sync');
