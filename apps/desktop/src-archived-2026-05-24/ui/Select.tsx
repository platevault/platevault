import { Select as BaseSelect } from "@base-ui-components/react/select";
import { ChevronDown, Check } from "lucide-react";
import type { ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value: string | null;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  minWidth?: number;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  ariaLabel,
  minWidth,
}: SelectProps) {
  return (
    <BaseSelect.Root
      value={value ?? ""}
      onValueChange={(v) => {
        if (v != null) onValueChange(v);
      }}
    >
      <BaseSelect.Trigger
        className="alm-select-trigger"
        aria-label={ariaLabel}
        style={minWidth ? { minWidth } : undefined}
      >
        <BaseSelect.Value className="alm-select-trigger__value">
          {value
            ? options.find((option) => option.value === value)?.label ?? placeholder
            : placeholder}
        </BaseSelect.Value>
        <BaseSelect.Icon className="alm-select-trigger__icon">
          <ChevronDown size={14} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="alm-select-positioner">
          <BaseSelect.Popup className="alm-select-popup">
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="alm-select-item"
              >
                <span style={{ flex: 1 }}>{option.label}</span>
                <BaseSelect.ItemIndicator>
                  <Check size={14} />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
