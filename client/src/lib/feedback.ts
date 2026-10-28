import { useEffect, useState } from 'react';
import { createStore } from './store.ts';

// Per-device end-of-rest beep. Volume is relative to the system volume (0.1 to 1).
export const soundSettings = createStore<{ volume: number }>({ volume: 0.4 }, 'halko.sound');

// Browsers only let a page play sound after a user gesture: unlockAudio() is called from the
// "Validate" / "Start" clicks so the end-of-rest beep can play later without a click.
let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
}

export function beep(times = 3): void {
  if (!ctx) return;
  const { volume } = soundSettings.get();
  // The browser may suspend the context after a while.
  if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  const start = ctx.currentTime;
  for (let i = 0; i < times; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = i === times - 1 ? 1320 : 880;
    const t = start + i * 0.28;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.min(1, Math.max(0.05, volume)), t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  }
}

// From a click (settings): unlocks the sound and plays the end-of-rest beep.
export function testBeep(): void {
  unlockAudio();
  beep();
}

export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
