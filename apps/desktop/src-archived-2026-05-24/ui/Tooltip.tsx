// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}

export function Tooltip({ children, content, side = "top" }: TooltipProps) {
  const triggerEl = isValidElement(children)
    ? (children as ReactElement<Record<string, unknown>>)
    : null;

  return (
    <BaseTooltip.Provider delay={350}>
      <BaseTooltip.Root>
        {triggerEl ? (
          <BaseTooltip.Trigger
            render={(props) => cloneElement(triggerEl, { ...props, ...triggerEl.props })}
          />
        ) : (
          <BaseTooltip.Trigger>{children as ReactNode}</BaseTooltip.Trigger>
        )}
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner side={side} sideOffset={6}>
            <BaseTooltip.Popup className="alm-tooltip">{content}</BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
