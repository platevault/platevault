// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Popover as BasePopover } from "@base-ui-components/react/popover";
import { ChevronDown, Check, Minus } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Optional small tone hint, rendered as a leading dot. Matches Chip tones. */
  tone?: "neutral" | "success" | "warn" | "danger";
}

export interface MultiSelectProps {
  ariaLabel: string;
  /** Currently selected option values. */
  value: string[];
  /** Full set of selectable options. */
  options: MultiSelectOption[];
  /** Fires on every add/remove. */
  onValueChange: (next: string[]) => void;
  /** Label shown on the trigger when all options are selected (e.g. "All sources"). */
  allLabel: string;
  /** Label shown when nothing is selected. Default: "None". */
  emptyLabel?: string;
  /** Min width for the trigger button. */
  minWidth?: number;
  /** Render a small tone dot before each option in the dropdown. Default false. */
  showTones?: boolean;
}

function triggerLabel(
  value: string[],
  options: MultiSelectOption[],
  allLabel: string,
  emptyLabel: string,
): string {
  if (value.length === 0) return emptyLabel;
  if (value.length === options.length) return allLabel;
  if (value.length === 1) {
    return options.find((o) => o.value === value[0])?.label ?? value[0];
  }
  const first = options.find((o) => o.value === value[0])?.label ?? value[0];
  return `${first} +${value.length - 1}`;
}

export function MultiSelect({
  ariaLabel,
  value,
  options,
  onValueChange,
  allLabel,
  emptyLabel = "None",
  minWidth,
  showTones = false,
}: MultiSelectProps) {
  const allSelected = value.length === options.length;
  const noneSelected = value.length === 0;
  const label = triggerLabel(value, options, allLabel, emptyLabel);

  // Ordered by options array, not selection time
  const selectedSet = new Set(value);

  const toggleOption = (optionValue: string) => {
    if (selectedSet.has(optionValue)) {
      onValueChange(options.map((o) => o.value).filter((v) => v !== optionValue && selectedSet.has(v)));
    } else {
      onValueChange(options.map((o) => o.value).filter((v) => v === optionValue || selectedSet.has(v)));
    }
  };

  const toggleAll = () => {
    if (allSelected) {
      onValueChange([]);
    } else {
      onValueChange(options.map((o) => o.value));
    }
  };

  // Keyboard navigation state
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-ms-row]");
    if (!items || items.length === 0) return;
    const focused = document.activeElement as HTMLElement;
    const currentIdx = Array.from(items).indexOf(focused as HTMLButtonElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
      items[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
      items[prev]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focused && "click" in focused) {
        (focused as HTMLButtonElement).click();
      }
    }
  };

  // Focus first row when popover opens
  const handlePopupFocus = () => {
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-ms-row]");
    if (items && items.length > 0) {
      items[0]?.focus();
    }
  };

  return (
    <BasePopover.Root>
      <BasePopover.Trigger
        className="alm-select-trigger"
        aria-label={ariaLabel}
        style={minWidth ? { minWidth } : undefined}
        render={(props) => (
          <button type="button" {...props} />
        )}
      >
        <span className="alm-select-trigger__value">{label}</span>
        <span className="alm-select-trigger__icon">
          <ChevronDown size={14} />
        </span>
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={4} align="start" className="alm-multiselect-positioner">
          <BasePopover.Popup
            className="alm-multiselect-popup"
            onAnimationEnd={handlePopupFocus}
          >
            <div
              ref={listRef}
              onKeyDown={handleKeyDown}
            >
              {/* Select all / Deselect all row */}
              <button
                type="button"
                className="alm-multiselect-row alm-multiselect-row--all"
                data-ms-row
                onClick={toggleAll}
              >
                <span className="alm-multiselect-row__check" aria-hidden="true">
                  {allSelected ? (
                    <Check size={13} />
                  ) : noneSelected ? (
                    <span className="alm-multiselect-row__check-empty" />
                  ) : (
                    <Minus size={13} />
                  )}
                </span>
                <span className="alm-multiselect-row__label">
                  {allSelected ? "Deselect all" : "Select all"}
                </span>
              </button>

              <div className="alm-multiselect-separator" />

              {/* Option rows */}
              {options.map((option) => {
                const checked = selectedSet.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className="alm-multiselect-row"
                    data-ms-row
                    data-checked={checked ? "true" : undefined}
                    onClick={() => toggleOption(option.value)}
                    aria-pressed={checked}
                  >
                    <span className="alm-multiselect-row__check" aria-hidden="true">
                      {checked ? <Check size={13} /> : <span className="alm-multiselect-row__check-empty" />}
                    </span>
                    {showTones && option.tone ? (
                      <span
                        className="alm-multiselect-row__dot"
                        data-tone={option.tone}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className="alm-multiselect-row__label">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
