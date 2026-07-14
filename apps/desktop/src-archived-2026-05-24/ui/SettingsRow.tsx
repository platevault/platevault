// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip } from "./Tooltip";

export interface SettingsRowProps {
  label: ReactNode;
  /** Tooltip body — must be a substantive explanation, not just the label restated. */
  info?: ReactNode;
  /** Dim hint text shown below the label. */
  description?: ReactNode;
  children: ReactNode;
}

/**
 * A single settings row: label (+ optional info tooltip) on the left,
 * optional description below the label, control on the right.
 * All settings autosave; no submit button here.
 */
export function SettingsRow({ label, info, description, children }: SettingsRowProps) {
  return (
    <div className="alm-setting-row">
      <div className="alm-setting-row__label">
        <span className="alm-setting-row__name">
          {label}
          {info ? (
            <Tooltip content={info} side="right">
              <Info size={12} style={{ color: "var(--text-faint)" }} />
            </Tooltip>
          ) : (
            <Info size={12} style={{ color: "var(--text-faint)" }} />
          )}
        </span>
        {description ? (
          <span className="alm-setting-row__hint">{description}</span>
        ) : null}
      </div>
      <div className="alm-setting-row__control">{children}</div>
    </div>
  );
}
