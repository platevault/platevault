// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Check, AlertTriangle, X, Minus } from "lucide-react";
import { Tooltip } from "./Tooltip";
import type { InventorySession } from "../data/mock";

export interface CalibrationCellProps {
  row: InventorySession;
}

/**
 * Cal column cell for the Inventory table.
 * Shows: check / warn triangle / X / orphan / usage count / dash.
 * Keeps all the branching logic out of the column definition.
 */
export function CalibrationCell({ row }: CalibrationCellProps) {
  const { type, calibrationMatch: match, usedByLightSessions } = row;
  const isCalibrationRow = type === "dark" || type === "flat" || type === "bias";

  if (isCalibrationRow) {
    if (usedByLightSessions == null || usedByLightSessions === 0) {
      return (
        <Tooltip content="Not referenced by any light session">
          <span className="alm-text-faint alm-table__cell--micro">orphan</span>
        </Tooltip>
      );
    }
    return (
      <Tooltip
        content={`Referenced by ${usedByLightSessions} light session${usedByLightSessions === 1 ? "" : "s"}`}
      >
        <span className="alm-table__cell--dim alm-table__cell--micro alm-table__cell--tabnum">
          → {usedByLightSessions}
        </span>
      </Tooltip>
    );
  }

  if (type !== "light" && type !== "mixed") {
    return (
      <span className="alm-text-faint" aria-label="not applicable">
        —
      </span>
    );
  }
  if (match === "ok") {
    return (
      <Tooltip content="Calibration frames matched">
        <Check
          size={14}
          style={{ color: "var(--success, #2f9e44)" }}
          aria-label="calibration matched"
        />
      </Tooltip>
    );
  }
  if (match === "partial") {
    return (
      <Tooltip content="Some calibration frames missing">
        <AlertTriangle
          size={13}
          style={{ color: "var(--warn, #d97706)" }}
          aria-label="calibration partial"
        />
      </Tooltip>
    );
  }
  if (match === "missing") {
    return (
      <Tooltip content="No matching calibration frames">
        <X
          size={14}
          style={{ color: "var(--danger, #e5484d)" }}
          aria-label="calibration missing"
        />
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Calibration not yet evaluated">
      <Minus size={13} className="alm-text-faint" aria-label="calibration unknown" />
    </Tooltip>
  );
}
