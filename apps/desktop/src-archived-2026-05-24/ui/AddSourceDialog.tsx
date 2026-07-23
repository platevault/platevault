// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { TextInput } from "./TextInput";
import { Select } from "./Select";

export type AddSourceCategory = "raw" | "calibration" | "project" | "inbox";

type SourceKind = "local_disk" | "external_disk" | "removable" | "network_share";

const KIND_OPTIONS: Array<{ value: SourceKind; label: string }> = [
  { value: "local_disk", label: "Local disk" },
  { value: "external_disk", label: "External disk" },
  { value: "removable", label: "Removable drive" },
  { value: "network_share", label: "Network share" },
];

const CATEGORY_LABELS: Record<AddSourceCategory, string> = {
  raw: "Raw images",
  calibration: "Calibration images",
  project: "Projects",
  inbox: "Inbox watch folder",
};

const CATEGORY_OPTIONS: Array<{ value: AddSourceCategory; label: string }> = [
  { value: "raw", label: "Raw images" },
  { value: "calibration", label: "Calibration images" },
  { value: "project", label: "Projects" },
  { value: "inbox", label: "Inbox watch folder" },
];

export interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * When provided (e.g. from the wizard), the dialog targets that category
   * and hides the category selector. When omitted (Settings flow), the dialog
   * shows a category selector and defaults to "raw".
   */
  category?: AddSourceCategory;
  onAdd: (source: { path: string; kind: string; category: AddSourceCategory }) => void;
}

/**
 * Dialog for adding a new data source.
 * Reused by the wizard (fixed category, no selector) and Settings → Data Sources
 * (no category prop → shows category selector, defaults to Raw images).
 */
export function AddSourceDialog({
  open,
  onOpenChange,
  category: fixedCategory,
  onAdd,
}: AddSourceDialogProps) {
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<SourceKind>("local_disk");
  // Only used when fixedCategory is not provided
  const [selectedCategory, setSelectedCategory] = useState<AddSourceCategory>("raw");

  const effectiveCategory = fixedCategory ?? selectedCategory;

  const handleAdd = () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    onAdd({ path: trimmed, kind, category: effectiveCategory });
    setPath("");
    setKind("local_disk");
    setSelectedCategory("raw");
    onOpenChange(false);
  };

  const handleClose = () => {
    setPath("");
    setKind("local_disk");
    setSelectedCategory("raw");
    onOpenChange(false);
  };

  const title = fixedCategory
    ? `Add ${CATEGORY_LABELS[fixedCategory].toLowerCase()} source`
    : "Add source";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
      title={title}
      body={
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {/* Category selector — only shown when no fixed category is provided */}
          {fixedCategory === undefined && (
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "var(--fs-dense)",
                  color: "var(--text-dim)",
                  marginBottom: "var(--space-1)",
                }}
              >
                Category
              </label>
              <Select
                value={selectedCategory}
                onValueChange={(v) => setSelectedCategory(v as AddSourceCategory)}
                options={CATEGORY_OPTIONS}
                ariaLabel="Source category"
              />
            </div>
          )}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "var(--fs-dense)",
                color: "var(--text-dim)",
                marginBottom: "var(--space-1)",
              }}
            >
              Path
            </label>
            <TextInput
              placeholder="/Volumes/AstroDrive/lights"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "var(--fs-dense)",
                color: "var(--text-dim)",
                marginBottom: "var(--space-1)",
              }}
            >
              Kind
            </label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as SourceKind)}
              options={KIND_OPTIONS}
              ariaLabel="Source kind"
            />
          </div>
        </div>
      }
      footer={
        <>
          <Button variant="primary" onClick={handleAdd} disabled={!path.trim()}>
            Add source
          </Button>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
        </>
      }
    />
  );
}
