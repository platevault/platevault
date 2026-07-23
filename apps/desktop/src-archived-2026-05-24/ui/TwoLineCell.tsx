// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";

export interface TwoLineCellProps {
  primary: ReactNode;
  secondary?: ReactNode;
}

/**
 * Two-line table cell.
 * Primary line uses default cell text; secondary line uses dim micro text.
 * Replaces inline `.alm-table__cell--twolines` + `.alm-table__cell--twolines-sub`.
 */
export function TwoLineCell({ primary, secondary }: TwoLineCellProps) {
  return (
    <div className="alm-table__cell--twolines">
      <span>{primary}</span>
      {secondary ? (
        <span className="alm-table__cell--twolines-sub">{secondary}</span>
      ) : null}
    </div>
  );
}
