// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { HTMLAttributes } from 'react';
import { Tooltip } from './Tooltip';
import { m } from '@/lib/i18n';

export interface LockProps extends HTMLAttributes<HTMLSpanElement> {
  reason?: string;
}

/**
 * Padlock glyph whose tooltip explains why a row or category is protected.
 *
 * `role="note"` + `tabIndex={0}` mirror `InfoTip`, and both are load-bearing
 * (WCAG 1.4.13 / 2.1.1, same defect class as #1103):
 *
 * - The shared `Tooltip` renders its trigger as a bare `<span>` and base-ui
 *   adds no `tabIndex`, so without one the reason is reachable by pointer
 *   hover only — and the reason is not redundant prose. The cleanup-row hint
 *   ("requires explicit acknowledgement during plan review") states a
 *   consequence that appears nowhere else on screen; the adjacent pill says
 *   only "Protected".
 * - `aria-label` on a role-less `<span>` is not reliably exposed — naming
 *   applies to elements with a role that supports it — so the role is what
 *   makes the label reach assistive tech at all.
 */
export function Lock({ reason, className, ...rest }: LockProps) {
  const label = reason ?? m.settings_cleanup_protection_protected();
  const cls = ['pv-lock', className].filter(Boolean).join(' ');
  return (
    <Tooltip
      content={label}
      className={cls}
      role="note"
      tabIndex={0}
      aria-label={label}
      {...rest}
    >
      &#x1F512;
    </Tooltip>
  );
}
