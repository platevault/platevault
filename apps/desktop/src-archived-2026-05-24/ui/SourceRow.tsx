import type { ReactNode } from "react";

export interface SourceRowProps {
  path: string;
  kind: string;
  state?: ReactNode;
  meta?: ReactNode;
  actions: ReactNode;
}

/**
 * A single data-source row: mono path + kind sub-line + state/actions on the right.
 * Used by Settings → Data Sources and the wizard source lists.
 */
export function SourceRow({ path, kind, state, meta, actions }: SourceRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "var(--space-2) var(--space-3) var(--space-2) 0",
        gap: "var(--space-3)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          className="alm-mono"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--text)",
          }}
        >
          {path}
        </span>
        <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-faint)" }}>
          {kind}
          {meta ? <> · {meta}</> : null}
        </span>
        {state ? <div style={{ marginTop: 2 }}>{state}</div> : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
        {actions}
      </div>
    </div>
  );
}
