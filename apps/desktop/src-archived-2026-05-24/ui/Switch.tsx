// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Switch as BaseSwitch } from "@base-ui-components/react/switch";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

export function Switch({ checked, onCheckedChange, ariaLabel, disabled }: SwitchProps) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className="alm-switch"
    >
      <BaseSwitch.Thumb className="alm-switch__thumb" />
    </BaseSwitch.Root>
  );
}
