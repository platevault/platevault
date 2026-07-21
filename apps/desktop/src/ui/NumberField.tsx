// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NumberField — labelled numeric text input.
 *
 * One parameterised component for the label + input pair rather than a
 * per-feature clone of the `pv-field-label` / `pv-input` markup. It reuses
 * those existing classes and introduces no new CSS.
 *
 * The value stays a string: an empty string means "not provided", which the
 * caller maps to an absent value. Parsing and range checks belong to the
 * caller so it can distinguish absent from invalid.
 */

export interface NumberFieldProps {
  id: string;
  /** Already-translated label, including its unit. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Already-translated hint, rendered beside the label. */
  hint?: string;
  /** Smallest accepted value, forwarded to the input for browser/AT hints. */
  min?: number;
  /** `any` allows decimals (pixel size); omit for integer-only fields. */
  step?: number | 'any';
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  min,
  step,
}: NumberFieldProps) {
  return (
    <div className="pv-stack-1">
      <label className="pv-field-label" htmlFor={id}>
        {label}
        {hint && <span className="pv-field-hint"> ({hint})</span>}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className="pv-input"
        aria-label={label}
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
