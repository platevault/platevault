// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Menu as BaseMenu } from "@base-ui-components/react/menu";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import clsx from "clsx";

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect?: () => void;
}

export interface MenuGroup {
  id: string;
  label?: string;
  items: MenuItem[];
}

export interface MenuProps {
  trigger: ReactNode;
  groups: MenuGroup[];
  align?: "start" | "center" | "end";
}

/**
 * Overflow menu — used for row actions (Reveal, Reclassify, Disable, etc.)
 * and any "more actions" pattern.
 */
export function Menu({ trigger, groups, align = "end" }: MenuProps) {
  // Base UI's render prop wants a strongly-typed element; we accept any
  // children and clone if necessary.
  const triggerEl = isValidElement(trigger)
    ? (trigger as ReactElement<Record<string, unknown>>)
    : null;

  return (
    <BaseMenu.Root>
      {triggerEl ? (
        <BaseMenu.Trigger
          render={(props) => cloneElement(triggerEl, { ...props, ...triggerEl.props })}
        />
      ) : (
        <BaseMenu.Trigger>{trigger}</BaseMenu.Trigger>
      )}
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={4} align={align}>
          <BaseMenu.Popup className="alm-menu-popup">
            {groups.map((group, idx) => (
              <div key={group.id}>
                {idx > 0 ? <div className="alm-menu-separator" /> : null}
                {group.label ? (
                  <div className="alm-menu-label">{group.label}</div>
                ) : null}
                {group.items.map((item) => (
                  <BaseMenu.Item
                    key={item.id}
                    disabled={item.disabled}
                    onClick={item.onSelect}
                    className={clsx("alm-menu-item")}
                    data-tone={item.tone === "danger" ? "danger" : undefined}
                  >
                    {item.icon ? <span style={{ display: "flex" }}>{item.icon}</span> : null}
                    <span style={{ flex: 1 }}>{item.label}</span>
                  </BaseMenu.Item>
                ))}
              </div>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
