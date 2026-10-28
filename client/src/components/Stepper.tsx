import { ValueInput } from './ValueInput.tsx';

// Big −/+ buttons around a typed value, quick to use during a set.
export function Stepper({
  label,
  unit,
  value,
  step,
  min = 0,
  max = Infinity,
  format,
  parse,
  onChange,
  inputMode = 'decimal',
  disabled = false,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  step: number;
  min?: number;
  max?: number;
  format: (v: number | undefined) => string;
  parse: (s: string) => number | null;
  onChange: (v: number) => void;
  inputMode?: 'decimal' | 'numeric' | 'text';
  disabled?: boolean;
}) {
  const v = value ?? 0;
  return (
    <div className="stepper">
      <button type="button" disabled={disabled} onClick={() => onChange(Math.max(min, v - step))} aria-label={`${label} : moins`}>
        −
      </button>
      <span className="stepper-value">
        <ValueInput value={value} format={format} parse={parse} onCommit={onChange} label={label} inputMode={inputMode} disabled={disabled} />
        <span className="small muted">{unit}</span>
      </span>
      <button type="button" disabled={disabled || v >= max} onClick={() => onChange(Math.min(max, v + step))} aria-label={`${label} : plus`}>
        +
      </button>
    </div>
  );
}
