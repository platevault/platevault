import { Group, Panel, Separator } from "react-resizable-panels";
import type { ReactNode } from "react";

export interface DockedDrawerProps {
  /** The main content (the ledger or main page body) */
  main: ReactNode;
  /** The drawer content. If null/undefined, drawer is closed. */
  drawer: ReactNode | null;
  /** Initial drawer panel size as a percentage of total width */
  defaultDrawerSize?: number;
  /** Minimum drawer panel size as percent */
  minDrawerSize?: number;
}

/**
 * Master-detail layout: main content on the left, optional resizable drawer
 * on the right. NOT modal — the main content stays scrollable and interactive
 * while the drawer is open.
 */
export function DockedDrawer({
  main,
  drawer,
  defaultDrawerSize = 36,
  minDrawerSize = 24,
}: DockedDrawerProps) {
  if (drawer == null) {
    return <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>{main}</div>;
  }

  return (
    <Group orientation="horizontal" style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <Panel minSize="30%">
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
          {main}
        </div>
      </Panel>
      <Separator className="alm-drawer-handle" />
      <Panel
        defaultSize={`${defaultDrawerSize}%`}
        minSize={`${minDrawerSize}%`}
        maxSize="60%"
      >
        <div style={{ height: "100%", minWidth: 0 }}>{drawer}</div>
      </Panel>
    </Group>
  );
}
