// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { TextInput } from "./TextInput";
import { remapInventorySource } from "../data/store";

export interface RemapSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: string;
  currentPath: string;
  lastSeen?: string;
}

/**
 * Dialog for remapping a disconnected source to a new mount path.
 * Shared by Inventory group header and Settings → Data Sources.
 */
export function RemapSourceDialog({
  open,
  onOpenChange,
  sourceId,
  currentPath,
  lastSeen,
}: RemapSourceDialogProps) {
  const [newPath, setNewPath] = useState("");
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "ok" | "error">("idle");

  const handleVerify = () => {
    setVerifyState("checking");
    setTimeout(() => setVerifyState("ok"), 700);
  };

  const handleReconnect = () => {
    remapInventorySource(sourceId, newPath || "/Volumes/AstroDrive-2026-05");
    onOpenChange(false);
    setNewPath("");
    setVerifyState("idle");
  };

  const handleCancel = () => {
    onOpenChange(false);
    setNewPath("");
    setVerifyState("idle");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleCancel();
      }}
      title="Reconnect source"
      body={
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div>
            <div
              className="alm-setting-row__hint"
              style={{ marginBottom: "var(--space-1)" }}
            >
              Original path
            </div>
            <code
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-dense)",
                color: "var(--text)",
                background: "var(--surface-2)",
                padding: "2px 6px",
                borderRadius: "var(--r-sm)",
              }}
            >
              {currentPath}
            </code>
            {lastSeen ? (
              <span
                style={{
                  marginLeft: "var(--space-2)",
                  fontSize: "var(--fs-dense)",
                  color: "var(--text-faint)",
                }}
              >
                last seen {lastSeen}
              </span>
            ) : null}
          </div>

          <div>
            <div
              className="alm-setting-row__hint"
              style={{ marginBottom: "var(--space-1)" }}
            >
              New mount path
            </div>
            <TextInput
              value={newPath}
              onChange={(e) => {
                setNewPath(e.target.value);
                setVerifyState("idle");
              }}
              placeholder="/Volumes/AstroDrive-2026-05"
              aria-label="New mount path"
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Button onClick={handleVerify} disabled={verifyState === "checking"}>
              {verifyState === "checking" ? "Verifying…" : "Verify path"}
            </Button>
            {verifyState === "ok" ? (
              <span style={{ fontSize: "var(--fs-dense)", color: "var(--success, #2f9e44)" }}>
                Path looks good — 11 sessions will resume
              </span>
            ) : verifyState === "error" ? (
              <span style={{ fontSize: "var(--fs-dense)", color: "var(--danger, #e5484d)" }}>
                Path not found / no matching content
              </span>
            ) : null}
          </div>
        </div>
      }
      footer={
        <>
          <Button variant="primary" disabled={verifyState !== "ok"} onClick={handleReconnect}>
            Reconnect
          </Button>
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
        </>
      }
    />
  );
}
