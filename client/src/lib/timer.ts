// What the set timer shows at a given moment. A set done one side at a time (`switchS` given) runs
// side 1, the time to change sides, then side 2: as a countdown, each side lasts `targetS`; as a
// stopwatch, side 1 ends when the user says so (`side1Ms`: the elapsed time then, null before).
// `valueS` is the duration to record: the side under way, never more than side 1 once on side 2 (the
// values are per side, so a side held for less counts for both).

type TimerPhase = 'single' | 'side1' | 'switch' | 'side2' | 'done';

interface TimerView {
  phase: TimerPhase;
  shownS: number;
  // Of the ring: how far the phase is (a stopwatch side goes round once a minute).
  progress: number;
  valueS: number;
}

const secs = (ms: number) => Math.floor(ms / 1000);
const lap = (ms: number) => (ms % 60000) / 60000;

// Elapsed time after which a countdown has nothing left to run.
export function countdownTotalS(targetS: number, switchS: number | null): number {
  return switchS === null ? targetS : 2 * targetS + switchS;
}

export function timerView(
  elapsedMs: number,
  targetS: number | undefined,
  switchS: number | null,
  side1Ms: number | null = null,
): TimerView {
  if (targetS) {
    const sideMs = targetS * 1000;
    const countdown = (phase: TimerPhase, ms: number, lengthMs: number, valueS: number): TimerView => ({
      phase,
      shownS: Math.max(0, secs(lengthMs) - secs(ms)),
      progress: Math.min(1, ms / lengthMs),
      valueS,
    });
    if (switchS === null) return countdown('single', elapsedMs, sideMs, Math.min(secs(elapsedMs), targetS));
    const switchMs = switchS * 1000;
    if (elapsedMs < sideMs) return countdown('side1', elapsedMs, sideMs, secs(elapsedMs));
    if (elapsedMs < sideMs + switchMs) return countdown('switch', elapsedMs - sideMs, switchMs, targetS);
    const side2 = elapsedMs - sideMs - switchMs;
    if (side2 < sideMs) return countdown('side2', side2, sideMs, secs(side2));
    return { phase: 'done', shownS: 0, progress: 1, valueS: targetS };
  }

  if (switchS === null) return { phase: 'single', shownS: secs(elapsedMs), progress: lap(elapsedMs), valueS: secs(elapsedMs) };
  if (side1Ms === null) return { phase: 'side1', shownS: secs(elapsedMs), progress: lap(elapsedMs), valueS: secs(elapsedMs) };
  const switchMs = switchS * 1000;
  const intoSwitch = elapsedMs - side1Ms;
  if (intoSwitch < switchMs) {
    return { phase: 'switch', shownS: switchS - secs(intoSwitch), progress: intoSwitch / switchMs, valueS: secs(side1Ms) };
  }
  const side2 = intoSwitch - switchMs;
  return { phase: 'side2', shownS: secs(side2), progress: lap(side2), valueS: Math.min(secs(side1Ms), secs(side2)) };
}
