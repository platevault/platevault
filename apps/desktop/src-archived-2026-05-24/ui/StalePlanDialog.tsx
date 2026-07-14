// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Dialog } from "./Dialog";
import { Button } from "./Button";

export interface StalePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planNumber: number;
  driftEntries: string[];
  onRegenerate: () => void;
}

/**
 * Dialog shown when a plan's pre-apply revalidation detects filesystem drift.
 * Used by Inbox and Activity drawers.
 */
export function StalePlanDialog({
  open,
  onOpenChange,
  planNumber,
  driftEntries,
  onRegenerate,
}: StalePlanDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Plan is stale"
      body={
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p style={{ margin: 0, fontSize: "var(--fs-small)", color: "var(--text-dim)" }}>
            Since this plan was approved, the filesystem has changed:
          </p>
          <div
            style={{
              background: "var(--surface-2)",
              borderRadius: "var(--r-sm)",
              padding: "var(--space-2) var(--space-3)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)",
            }}
          >
            {driftEntries.map((entry) => (
              <code
                key={entry}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-micro)",
                  color: "var(--warn, #d97706)",
                  display: "block",
                }}
              >
                {entry}
              </code>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: "var(--fs-dense)", color: "var(--text-faint)" }}>
            Plan #{planNumber} cannot be safely applied as-is. Regenerate it to resolve the drift,
            then re-approve before applying.
          </p>
        </div>
      }
      footer={
        <>
          <Button variant="primary" onClick={onRegenerate}>
            Regenerate plan
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    />
  );
}
