// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { resolveFailedItem } from "../data/store";
import type { Plan, PlanItem } from "../data/mock";

export interface ResolveFailedItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan;
}

/**
 * Dialog for resolving per-item failures (Skip / Rename / Overwrite).
 * Used by Activity drawer (and Inbox if per-item flow surfaces there).
 */
export function ResolveFailedItemsDialog({
  open,
  onOpenChange,
  plan,
}: ResolveFailedItemsDialogProps) {
  const failedItems = plan.items.filter((it) => it.state === "failed");
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleApply = () => {
    onOpenChange(false);
    setEditingId(null);
    setRenames({});
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Resolve failed items"
      body={
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {failedItems.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-faint)", fontSize: "var(--fs-dense)" }}>
              No failed items remaining.
            </p>
          ) : (
            failedItems.map((item) => (
              <ResolveItemRow
                key={item.id}
                item={item}
                planId={plan.id}
                renameValue={renames[item.id] ?? item.to.split("/").pop() ?? item.name}
                isEditing={editingId === item.id}
                onStartEdit={() => setEditingId(item.id)}
                onRenameChange={(v) => setRenames((prev) => ({ ...prev, [item.id]: v }))}
                onRenameConfirm={() => {
                  const newTo = item.to.replace(/[^/]+$/, renames[item.id] ?? item.name);
                  resolveFailedItem(plan.id, item.id, "rename", { to: newTo });
                  setEditingId(null);
                }}
              />
            ))
          )}
        </div>
      }
      footer={
        <>
          <Button variant="primary" onClick={handleApply}>
            Apply resolutions
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    />
  );
}

function ResolveItemRow({
  item,
  planId,
  renameValue,
  isEditing,
  onStartEdit,
  onRenameChange,
  onRenameConfirm,
}: {
  item: PlanItem;
  planId: string;
  renameValue: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onRenameChange: (v: string) => void;
  onRenameConfirm: () => void;
}) {
  if (item.state !== "failed") return null;

  return (
    <div
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r-sm)",
        padding: "var(--space-2) var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-micro)",
            color: "var(--text)",
          }}
        >
          {item.action} {item.name}
        </code>
        {item.failureReason ? (
          <span style={{ fontSize: "var(--fs-micro)", color: "var(--danger, #e5484d)" }}>
            — {item.failureReason}
          </span>
        ) : null}
      </div>
      {isEditing ? (
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <input
            type="text"
            className="alm-textinput"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-dense)", flex: 1 }}
            aria-label={`New filename for ${item.name}`}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <Button variant="primary" onClick={onRenameConfirm}>
            Save
          </Button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="ghost" onClick={() => resolveFailedItem(planId, item.id, "skip")}>
            Skip
          </Button>
          <Button variant="ghost" onClick={onStartEdit}>
            Rename…
          </Button>
          <Button
            variant="ghost"
            onClick={() => resolveFailedItem(planId, item.id, "overwrite")}
          >
            Overwrite
          </Button>
        </div>
      )}
    </div>
  );
}
