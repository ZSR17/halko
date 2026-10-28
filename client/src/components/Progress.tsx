// Thin progress bar with its label and counts ("Downloading the library · 500 / 876").
export function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="stack" style={{ gap: 6 }} role="status">
      <div className="row between small">
        <span style={{ fontWeight: 700 }}>{label}</span>
        <span className="muted">
          {done} / {total}
        </span>
      </div>
      <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
