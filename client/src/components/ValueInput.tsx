import { useEffect, useState } from 'react';

// Text input that shows a formatted value and commits a parsed one on blur / Enter.
// Invalid input is reverted instead of being saved; `parse` may also cap it.
export function ValueInput({
  value,
  format,
  parse,
  onCommit,
  label,
  inputMode = 'decimal',
  className = 'cell-input',
  disabled = false,
  title,
}: {
  value: number | undefined;
  format: (v: number | undefined) => string;
  parse: (s: string) => number | null;
  onCommit: (v: number) => void;
  label: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [text, setText] = useState(format(value));
  useEffect(() => setText(format(value)), [value, format]);

  const commit = () => {
    const parsed = parse(text);
    if (parsed === null) return setText(format(value));
    // Shows the value as kept (a capped or normalised one), even when it does not change.
    setText(format(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <input
      className={className}
      aria-label={label}
      title={title}
      inputMode={inputMode}
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
