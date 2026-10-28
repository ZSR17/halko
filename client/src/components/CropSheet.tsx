import type { Crop } from '@halko/shared';
import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { t } from '../lib/i18n.ts';

const MIN = 0.05;
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Selection moved or resized by (dx, dy), fractions of the picture, staying inside it.
function dragged(start: Crop, handle: Handle, dx: number, dy: number): Crop {
  if (handle === 'move') return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
  let { x, y, w, h } = start;
  if (handle.includes('w')) {
    const left = clamp(x + dx, 0, x + w - MIN);
    w += x - left;
    x = left;
  }
  if (handle.includes('e')) w = clamp(w + dx, MIN, 1 - x);
  if (handle.includes('n')) {
    const top = clamp(y + dy, 0, y + h - MIN);
    h += y - top;
    y = top;
  }
  if (handle.includes('s')) h = clamp(h + dy, MIN, 1 - y);
  return { x, y, w, h };
}

// Choosing the part of a photo to keep, any shape: drag the frame to move it, its edges and corners to
// resize it (arrows move it, Shift + arrows resize it). `src` is a link or an object URL; when the
// picture cannot be shown here, it can still be sent whole.
export function CropSheet({ src, onCancel, onConfirm }: { src: string; onCancel: () => void; onConfirm: (crop: Crop | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState<Crop>(FULL);
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Crop } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // Inner width (padding excluded), so the handles on the right edge stay visible.
    const observer = new ResizeObserver(([entry]) => setRoom(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The whole picture, as large as the sheet allows, and short enough for the buttons to fit below.
  const scale = natural ? Math.min(room / natural.w, (innerHeight * 0.5) / natural.h) : 0;
  const shownW = natural ? natural.w * scale : 0;
  const shownH = natural ? natural.h * scale : 0;

  const start = (handle: Handle) => (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: sel };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || !shownW) return;
    setSel(dragged(d.start, d.handle, (e.clientX - d.x) / shownW, (e.clientY - d.y) / shownH));
  };
  const stop = () => (drag.current = null);
  const onKey = (e: KeyboardEvent) => {
    const step = 0.01;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    setSel((s) => dragged(s, e.shiftKey ? 'se' : 'move', delta[0]!, delta[1]!));
  };

  const whole = sel.x < 0.001 && sel.y < 0.001 && sel.w > 0.999 && sel.h > 0.999;
  const pixels = natural && `${Math.round(sel.w * natural.w)} × ${Math.round(sel.h * natural.h)} px`;

  return (
    <Sheet title={t('crop.title')} onClose={onCancel}>
      <span className="small muted">{t('crop.help')}</span>
      <div ref={box} className="crop-box">
        {!failed && (
          <div className="crop-stage" style={natural ? { width: shownW, height: shownH } : { visibility: 'hidden' }}>
            <img
              src={src}
              alt={t('crop.picture')}
              draggable={false}
              referrerPolicy="no-referrer"
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
            />
            <div
              className="crop-selection"
              role="slider"
              tabIndex={0}
              aria-label={t('crop.selection')}
              aria-valuetext={pixels ?? undefined}
              style={{ left: sel.x * shownW, top: sel.y * shownH, width: sel.w * shownW, height: sel.h * shownH }}
              onPointerDown={start('move')}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerCancel={stop}
              onKeyDown={onKey}
            >
              {HANDLES.map((h) => (
                <span
                  key={h}
                  className={`crop-handle ${h}`}
                  onPointerDown={start(h)}
                  onPointerMove={move}
                  onPointerUp={stop}
                  onPointerCancel={stop}
                />
              ))}
            </div>
          </div>
        )}
        {failed && (
          <p className="small muted" style={{ margin: 0, padding: 16, textAlign: 'center' }}>
            {t('crop.noPreview')}
          </p>
        )}
      </div>
      {pixels && !failed && (
        <div className="row between">
          <span className="small muted">{t('crop.kept', { size: pixels })}</span>
          <button type="button" className="btn btn-ghost" disabled={whole} onClick={() => setSel(FULL)}>
            {t('crop.keepAll')}
          </button>
        </div>
      )}
      <button type="button" className="btn btn-primary" disabled={!natural && !failed} onClick={() => onConfirm(failed || whole ? null : sel)}>
        {failed ? t('crop.addUncropped') : t('crop.confirm')}
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </Sheet>
  );
}
