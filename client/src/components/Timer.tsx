import { useEffect, useRef, useState } from 'react';
import { beep, unlockAudio, useNow } from '../lib/feedback.ts';
import { formatDuration } from '../lib/format.ts';
import { countdownTotalS, timerView } from '../lib/timer.ts';
import { Ring } from './Ring.tsx';
import { t } from '../lib/i18n.ts';

// Countdown to the set's duration, or a free stopwatch. Reports the elapsed seconds to the parent
// while running so "Validate" always records what was actually held. Until it starts, the countdown
// follows `targetS` (the value shown for the set, adjustable with −/+); then it stays fixed.
// `onStartedChange` reports whether it has been started (running or paused): the duration is then its own.
// With `switchS`, the set is done one side at a time: side 1, `switchS` seconds to change sides, side 2
// (the duration is per side; see timerView).
export function Timer({
  targetS: shownTargetS,
  switchS = null,
  onChange,
  onStartedChange,
}: {
  targetS: number | undefined;
  switchS?: number | null;
  onChange: (seconds: number) => void;
  onStartedChange: (started: boolean) => void;
}) {
  const [chosenMode, setMode] = useState<'countdown' | 'stopwatch' | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [accMs, setAccMs] = useState(0);
  const [fixedS, setFixedS] = useState<number | undefined>(undefined);
  // Stopwatch done one side at a time: the elapsed time when side 1 ended.
  const [side1Ms, setSide1Ms] = useState<number | null>(null);
  const now = useNow(200);
  const finished = useRef(false);

  const running = startedAt !== null;
  // `now` ticks every 200 ms and can lag the moment the timer started: never count negative time.
  const elapsedMs = accMs + (running ? Math.max(0, now - startedAt) : 0);
  const elapsedS = Math.floor(elapsedMs / 1000);
  const started = running || elapsedMs > 0;
  const targetS = started ? fixedS : shownTargetS;
  const mode = chosenMode ?? (targetS ? 'countdown' : 'stopwatch');
  const countdown = mode === 'countdown' && !!targetS;
  const totalS = countdown ? countdownTotalS(targetS, switchS) : 0;
  const view = timerView(elapsedMs, countdown ? targetS : undefined, switchS, side1Ms);

  useEffect(() => onStartedChange(started), [started, onStartedChange]);

  useEffect(() => {
    if (running) onChange(view.valueS);
  }, [view.valueS, running, onChange]);

  // A beep when side 1 ends and when side 2 starts (once only when there is no time to change sides).
  const phase = useRef(view.phase);
  useEffect(() => {
    const was = phase.current;
    phase.current = view.phase;
    if (running && was !== view.phase && (view.phase === 'switch' || view.phase === 'side2')) beep();
  }, [view.phase, running]);

  useEffect(() => {
    if (countdown && running && elapsedS >= totalS && !finished.current) {
      finished.current = true;
      setAccMs(totalS * 1000);
      setStartedAt(null);
      onChange(targetS);
      beep();
    }
  }, [countdown, running, elapsedS, totalS, targetS, onChange]);

  const toggle = () => {
    unlockAudio();
    if (running) {
      setAccMs(accMs + Date.now() - startedAt);
      setStartedAt(null);
    } else {
      finished.current = false;
      if (!started) setFixedS(shownTargetS);
      if (countdown && elapsedS >= totalS) setAccMs(0);
      setStartedAt(Date.now());
    }
  };
  // Back to the duration the set had before the timer overwrote it with the elapsed time.
  const reset = () => {
    finished.current = false;
    setStartedAt(null);
    setAccMs(0);
    setSide1Ms(null);
    if (fixedS !== undefined) onChange(fixedS);
    setFixedS(undefined);
  };
  const nextSide = () => {
    setSide1Ms(elapsedMs);
    beep();
  };

  const sideLabel = view.phase === 'side1' ? t('timer.side1') : view.phase === 'switch' ? t('timer.switch') : view.phase === 'side2' ? t('timer.side2') : null;
  const switching = view.phase === 'switch';

  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      {targetS ? (
        <div className="seg" role="group" aria-label={t('timer.mode')} style={{ width: '100%', background: 'var(--surface)' }}>
          <button type="button" aria-pressed={mode === 'countdown'} onClick={() => (reset(), setMode('countdown'))}>
            {t('timer.countdown')}
          </button>
          <button type="button" aria-pressed={mode === 'stopwatch'} onClick={() => (reset(), setMode('stopwatch'))}>
            {t('timer.stopwatch')}
          </button>
        </div>
      ) : null}
      <Ring size={220} progress={view.progress} color={switching ? 'var(--warn)' : 'var(--time)'}>
        {sideLabel && (
          <span className="small" style={{ fontWeight: 700, color: switching ? 'var(--warn)' : 'var(--time)' }}>
            {sideLabel}
          </span>
        )}
        <span className="num" style={{ fontSize: 'min(4.5rem, 88px)', lineHeight: 1 }} aria-live="off">
          {formatDuration(view.shownS)}
        </span>
        {!switching && (
          <span className="small muted">{countdown ? t('timer.left', { target: formatDuration(targetS) }) : t('timer.elapsed')}</span>
        )}
      </Ring>
      <div className="row" style={{ width: '100%' }}>
        <button type="button" className="icon-btn" style={{ width: 60, height: 60 }} onClick={reset} aria-label={t('timer.reset')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5" />
          </svg>
        </button>
        {!countdown && running && view.phase === 'side1' ? (
          <button type="button" className="btn grow" style={{ minHeight: 60 }} onClick={nextSide}>
            {t('timer.nextSide')}
          </button>
        ) : null}
        <button type="button" className="btn grow btn-time" style={{ minHeight: 60, background: 'var(--time)', color: 'var(--on-time)', borderColor: 'transparent' }} onClick={toggle}>
          {running ? t('timer.pause') : elapsedMs > 0 ? t('timer.resume') : t('timer.start')}
        </button>
      </div>
    </div>
  );
}
