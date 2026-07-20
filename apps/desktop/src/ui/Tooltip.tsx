// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';

export interface TooltipProps
  extends Omit<ComponentPropsWithoutRef<'span'>, 'content'> {
  /** Content revealed in the popup on hover/focus. */
  content: ReactNode;
  /** Trigger content (glyph, icon, or label). */
  children: ReactNode;
  /** Popup offset from the trigger, in px. */
  sideOffset?: number;
}

/**
 * Single token-styled tooltip wrapper over base-ui. The trigger renders as a
 * `<span>` so it can wrap inline affordances (Lock glyph, InfoTip icon);
 * `className` and any extra span attributes (aria-label, tabIndex, data-*)
 * pass through to that trigger span. Popup styling lives in `.pv-tooltip`.
 */
export function Tooltip({
  content,
  children,
  className,
  sideOffset = 4,
  ...rest
}: TooltipProps) {
  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger className={className} render={<span {...rest} />}>
          {children}
        </BaseTooltip.Trigger>
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner sideOffset={sideOffset}>
            <BaseTooltip.Popup className="pv-tooltip">
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
