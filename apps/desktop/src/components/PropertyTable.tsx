// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PropertyTable — key-value property display supporting both read-only and
 * editable modes. Used for session details, inbox review, and equipment.
 *
 * Source badge colors: fits=blue, user=green, inferred=amber, default=gray.
 * Uses @base-ui-components/react/checkbox for confirm toggles.
 */

import { Checkbox } from '@base-ui-components/react/checkbox';
import { Select } from '@base-ui-components/react/select';
import { clsx } from 'clsx';
import { m } from '@/lib/i18n';

export interface PropertyDef {
  key: string;
  label: string;
  value: string | number | boolean | null;
  editable?: boolean;
  source?: 'fits' | 'user' | 'inferred' | 'default';
  confirmed?: boolean;
  onConfirmToggle?: () => void;
  onChange?: (newValue: string) => void;
  type?: 'text' | 'number' | 'select' | 'boolean';
  options?: { value: string; label: string }[];
}

export interface PropertyTableProps {
  properties: PropertyDef[];
  mode: 'view' | 'edit';
  showSource?: boolean;
  showConfirm?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  fits: 'FITS',
  user: 'User',
  inferred: 'Inferred',
  default: 'Default',
};

function formatDisplayValue(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function PropertyValueEditor({ prop }: { prop: PropertyDef }) {
  const { type = 'text', value, onChange, options } = prop;

  if (type === 'select' && options) {
    return (
      <Select.Root
        value={value !== null ? String(value) : ''}
        onValueChange={(v: string | null) => {
          if (v !== null) onChange?.(v);
        }}
      >
        <Select.Trigger
          className="alm-select alm-select--sm"
          aria-label={prop.label}
        >
          <Select.Value />
          <Select.Icon className="alm-select__icon" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner>
            <Select.Popup className="alm-select__popup">
              {options.map((opt) => (
                <Select.Item
                  key={opt.value}
                  value={opt.value}
                  className="alm-select__item"
                >
                  <Select.ItemText>{opt.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    );
  }

  if (type === 'boolean') {
    return (
      <Checkbox.Root
        className="alm-checkbox"
        checked={value === true}
        onCheckedChange={(checked) => onChange?.(String(checked))}
        aria-label={prop.label}
      >
        <Checkbox.Indicator className="alm-checkbox__indicator">
          &#x2713;
        </Checkbox.Indicator>
      </Checkbox.Root>
    );
  }

  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      className="alm-input alm-input--sm"
      value={value !== null && value !== undefined ? String(value) : ''}
      onChange={(e) => onChange?.(e.target.value)}
      aria-label={prop.label}
    />
  );
}

export function PropertyTable({
  properties,
  mode,
  showSource = false,
  showConfirm = false,
}: PropertyTableProps) {
  return (
    <div
      className="alm-property-table"
      role="table"
      aria-label={m.cmp_property_table_aria()}
    >
      {/* Header row */}
      <div className="alm-property-table__header" role="row">
        <span
          className="alm-property-table__cell alm-property-table__cell--label"
          role="columnheader"
        >
          {m.cmp_property_table_col_property()}
        </span>
        <span
          className="alm-property-table__cell alm-property-table__cell--value"
          role="columnheader"
        >
          {m.cmp_property_table_col_value()}
        </span>
        {showSource && (
          <span
            className="alm-property-table__cell alm-property-table__cell--source"
            role="columnheader"
          >
            {m.projects_wizard_col_source()}
          </span>
        )}
        {showConfirm && (
          <span
            className="alm-property-table__cell alm-property-table__cell--confirm"
            role="columnheader"
          >
            {m.cmp_property_table_col_confirmed()}
          </span>
        )}
      </div>

      {/* Data rows */}
      {properties.map((prop) => {
        const isEditing = mode === 'edit' && prop.editable;

        return (
          <div key={prop.key} className="alm-property-table__row" role="row">
            <span
              className="alm-property-table__cell alm-property-table__cell--label"
              role="rowheader"
            >
              {prop.label}
            </span>

            <span
              className="alm-property-table__cell alm-property-table__cell--value"
              role="cell"
            >
              {isEditing ? (
                <PropertyValueEditor prop={prop} />
              ) : (
                formatDisplayValue(prop.value)
              )}
            </span>

            {showSource && (
              <span
                className="alm-property-table__cell alm-property-table__cell--source"
                role="cell"
              >
                {prop.source && (
                  <span
                    className={clsx(
                      'alm-property-table__source-badge',
                      `alm-property-table__source-badge--${prop.source}`,
                    )}
                  >
                    {SOURCE_LABELS[prop.source] ?? prop.source}
                  </span>
                )}
              </span>
            )}

            {showConfirm && (
              <span
                className="alm-property-table__cell alm-property-table__cell--confirm"
                role="cell"
              >
                {prop.onConfirmToggle !== undefined && (
                  <Checkbox.Root
                    className="alm-checkbox"
                    checked={prop.confirmed ?? false}
                    onCheckedChange={() => prop.onConfirmToggle?.()}
                    aria-label={m.proptable_confirm_aria({ label: prop.label })}
                  >
                    <Checkbox.Indicator className="alm-checkbox__indicator">
                      &#x2713;
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
