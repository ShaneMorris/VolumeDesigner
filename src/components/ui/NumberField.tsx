import { useState } from 'react';

interface NumberFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  suffix?: string;
  min?: number;
  max?: number;
}

/**
 * A numeric field that keeps its own text while focused (so the user can type freely,
 * e.g. "1.2" mid-edit without it snapping back) and only commits — and only re-syncs from
 * `value` — once the field loses focus or Enter is pressed. This is what keeps typed
 * values exact instead of being rounded by a live-formatted display.
 */
export function NumberField({ label, value, onCommit, step = 0.01, suffix, min, max }: NumberFieldProps) {
  const [text, setText] = useState(() => formatNumber(value));
  const [focused, setFocused] = useState(false);
  const [syncedValue, setSyncedValue] = useState(value);

  // Re-sync the displayed text when `value` changes externally (e.g. a drag elsewhere
  // moved this same edge) — but never while the user is actively typing in this field.
  if (!focused && value !== syncedValue) {
    setSyncedValue(value);
    setText(formatNumber(value));
  }

  const commit = () => {
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed)) {
      let clamped = parsed;
      if (min !== undefined) clamped = Math.max(min, clamped);
      if (max !== undefined) clamped = Math.min(max, clamped);
      onCommit(clamped);
      setText(formatNumber(clamped));
    } else {
      setText(formatNumber(value));
    }
    setFocused(false);
  };

  return (
    <label className="number-field">
      <span className="number-field-label">{label}</span>
      <span className="number-field-input-wrap">
        <input
          type="number"
          step={step}
          value={text}
          onFocus={() => setFocused(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(formatNumber(value));
              setFocused(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {suffix && <span className="number-field-suffix">{suffix}</span>}
      </span>
    </label>
  );
}

function formatNumber(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : '';
}
