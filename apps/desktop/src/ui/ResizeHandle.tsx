// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * ResizeHandle — vertical drag divider for the adaptive detail dock's side
 * panel (spec 054 / #936). Pairs with `useAdaptiveDock`'s `onResizeStart`.
 */
export interface ResizeHandleProps {
  onPointerDown: (event: ReactPointerEvent) => void;
  /** Accessible label for the separator. */
  label: string;
}

export function ResizeHandle({ onPointerDown, label }: ResizeHandleProps) {
  return (
    <div
      className="pv-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      data-testid="dock-resize-handle"
    />
  );
}
