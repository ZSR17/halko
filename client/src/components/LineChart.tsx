import { useEffect, useRef, useState } from 'react';
import { formatDate, t } from '../lib/i18n.ts';

interface Point {
  t: number;
  y: number;
}

const H = 220;
const PAD = { top: 16, right: 56, bottom: 28, left: 44 };

// Round steps; whole ones only when the values are whole (reps), so the axis shows no "2.5 reps".
function niceTicks(min: number, max: number, whole: boolean, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * mag).filter((s) => !whole || Number.isInteger(s));
  const step = steps.find((s) => s >= raw) ?? (whole ? Math.ceil(raw) : raw);
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

const dateFmt = (ts: number) => formatDate(ts, { day: 'numeric', month: 'short' });

// Single-series progression chart: 2px line with a light wash, end value labelled, crosshair +
// tooltip on hover and arrow keys. The values are also listed in a table under the chart.
export function LineChart({
  points,
  format,
  axisFormat = format,
  scale = 1,
  label,
}: {
  points: Point[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  // Stored units in one unit shown (1000 g in a kg, 453.59 g in a lb): the axis steps are round in that unit.
  scale?: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  const empty = points.length === 0;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);

  if (empty) return null;

  const ys = points.map((p) => p.y);
  const low = Math.min(...ys);
  const high = Math.max(...ys);
  // Room under the lowest point, so it does not sit on the bottom edge as if it were 0 (never below 0).
  const room = (high - low) * 0.2 || Math.abs(high) * 0.1 || 1;
  const bottom = low >= 0 ? Math.max(0, low - room) : low - room;
  const ticks = niceTicks(bottom / scale, high / scale, scale === 1 && ys.every(Number.isInteger)).map((v) => v * scale);
  const yMin = Math.min(ticks[0]!, ...ys);
  const yMax = Math.max(ticks[ticks.length - 1]!, ...ys);
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const x = (t: number) => (t1 === t0 ? (PAD.left + width - PAD.right) / 2 : PAD.left + ((t - t0) / (t1 - t0)) * (width - PAD.left - PAD.right));
  const y = (v: number) => (yMax === yMin ? H / 2 : PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const area = `${path}L${x(t1).toFixed(1)},${H - PAD.bottom}L${x(t0).toFixed(1)},${H - PAD.bottom}Z`;
  const last = points[points.length - 1]!;
  const hovered = active !== null ? points[active] : undefined;

  const nearest = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(points[best]!.t) - px)) best = i;
    });
    setActive(best);
  };

  return (
    <div
      ref={box}
      className="chart"
      tabIndex={0}
      role="img"
      aria-label={t('chart.label', { label, from: format(points[0]!.y), to: format(last.y), count: points.length })}
      onPointerMove={(e) => nearest(e.clientX)}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
        if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? points.length) - 1));
      }}
    >
      <svg width={width} height={H} aria-hidden="true">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="axis">
              {axisFormat(v)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 8} className="axis">
          {dateFmt(t0)}
        </text>
        {t1 !== t0 && (
          <text x={width - PAD.right} y={H - 8} textAnchor="end" className="axis">
            {dateFmt(t1)}
          </text>
        )}
        <path d={area} fill="var(--accent)" opacity="0.1" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hovered && <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth="1" />}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(p.t)}
            cy={y(p.y)}
            r={i === active || i === points.length - 1 ? 5 : 4}
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth="2"
          />
        ))}
        <text x={x(last.t) + 10} y={y(last.y)} dy="0.32em" className="end-label">
          {format(last.y)}
        </text>
      </svg>
      {hovered && (
        <div
          className="tooltip"
          style={{ left: Math.min(Math.max(x(hovered.t), 70), width - 70), top: Math.max(0, y(hovered.y) - 58) }}
        >
          <strong>{format(hovered.y)}</strong>
          <span>{dateFmt(hovered.t)}</span>
        </div>
      )}
    </div>
  );
}
