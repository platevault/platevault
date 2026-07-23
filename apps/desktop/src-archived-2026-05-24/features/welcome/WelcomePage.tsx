// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FolderPlus, Loader2, X } from "lucide-react";

import {
  Accordion,
  Button,
  Dialog,
  IconButton,
  Select,
  Stepper,
  TextInput,
  Tooltip,
} from "../../ui";
import { updateSettings } from "../../data/settings";
import { checkSymlinkSupport } from "../../data/store";

/**
 * First-run setup wizard — 3 steps:
 *   0. Sources  (raw required, calibration/projects/inbox optional)
 *   1. Tools & catalogs  (foreground progress, blocking)
 *   2. Done  (summary + navigate to /inventory)
 *
 * Sources are persisted to localStorage under `alm.first-run.sources`.
 * The wizard does NOT mutate the global inventorySources mock array.
 */

const SOURCES_KEY = "alm.first-run.sources";

type SourceKind =
  | "local_disk"
  | "external_disk"
  | "removable"
  | "network_share";

interface WizardSource {
  path: string;
  kind: SourceKind;
}

interface WizardSourcesState {
  raw: WizardSource[];
  calibration: WizardSource[];
  projects: WizardSource[];
  inbox: WizardSource[];
}

function loadSources(): WizardSourcesState {
  const empty: WizardSourcesState = { raw: [], calibration: [], projects: [], inbox: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(SOURCES_KEY) ?? "null");
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Array.isArray((parsed as { raw?: unknown }).raw) &&
      Array.isArray((parsed as { calibration?: unknown }).calibration) &&
      Array.isArray((parsed as { projects?: unknown }).projects) &&
      Array.isArray((parsed as { inbox?: unknown }).inbox)
    ) {
      return parsed as WizardSourcesState;
    }
  } catch {
    // ignore
  }
  return empty;
}

// ---- Tool detection mock ----

interface ToolResult {
  name: string;
  found: boolean | null; // null = not yet checked
}

const TOOL_NAMES = ["PixInsight", "Siril", "Planetary Suite", "SharpCap"];

// ---- Step 1 ----

interface ToolsStepState {
  detectionStarted: boolean;
  detectionDone: boolean;
  toolResults: ToolResult[];
  detectionChecked: number; // how many have been checked so far
  downloadStarted: boolean;
  downloadDone: boolean;
  downloadPct: number; // 0-100
  /** Result of the symlink support check; null = not yet run. */
  symlinkResult: "supported" | "not_supported" | "disabled" | null;
}

function initialToolsState(): ToolsStepState {
  return {
    detectionStarted: false,
    detectionDone: false,
    toolResults: TOOL_NAMES.map((n) => ({ name: n, found: null })),
    detectionChecked: 0,
    downloadStarted: false,
    downloadDone: false,
    downloadPct: 0,
    symlinkResult: null,
  };
}

// ---- Step 0 — source card dialog ----

const KIND_OPTIONS: Array<{ value: SourceKind; label: string }> = [
  { value: "local_disk", label: "Local disk" },
  { value: "external_disk", label: "External disk" },
  { value: "removable", label: "Removable drive" },
  { value: "network_share", label: "Network share" },
];

type SourceCategory = "raw" | "calibration" | "projects" | "inbox";

const CATEGORY_LABELS: Record<SourceCategory, string> = {
  raw: "Raw images",
  calibration: "Calibration images",
  projects: "Projects",
  inbox: "Inbox watch folders",
};

interface AddSourceDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (src: WizardSource) => void;
  category: SourceCategory;
}

function AddSourceDialog({ open, onClose, onAdd, category }: AddSourceDialogProps) {
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<SourceKind>("local_disk");

  function handleAdd() {
    const trimmed = path.trim();
    if (!trimmed) return;
    onAdd({ path: trimmed, kind });
    setPath("");
    setKind("local_disk");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={`Add ${CATEGORY_LABELS[category].toLowerCase()} source`}
      body={
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "var(--fs-dense)",
                color: "var(--text-dim)",
                marginBottom: 4,
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
              autoFocus
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "var(--fs-dense)",
                color: "var(--text-dim)",
                marginBottom: 4,
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
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleAdd} disabled={!path.trim()}>
            Add source
          </Button>
        </>
      }
    />
  );
}

// ---- Source card (one accordion panel body) ----

interface SourceCardBodyProps {
  category: SourceCategory;
  sources: WizardSource[];
  onAdd: (src: WizardSource) => void;
  onRemove: (path: string) => void;
}

function SourceCardBody({ category, sources, onAdd, onRemove }: SourceCardBodyProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      {sources.length === 0 ? (
        <p
          style={{
            fontSize: "var(--fs-small)",
            color: "var(--text-faint)",
            margin: "0 0 8px",
          }}
        >
          No sources added yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0 }}>
          {sources.map((s) => (
            <li
              key={s.path}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px",
                borderRadius: "var(--r-xs)",
                background: "var(--surface-2)",
                marginBottom: 4,
                gap: 8,
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span
                  className="alm-mono"
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {s.path}
                </span>
                <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-faint)" }}>
                  {KIND_OPTIONS.find((o) => o.value === s.kind)?.label ?? s.kind}
                </span>
              </span>
              <IconButton
                aria-label={`Remove ${s.path}`}
                size="sm"
                onClick={() => onRemove(s.path)}
              >
                <X size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Button
        leadingIcon={<FolderPlus size={14} />}
        onClick={() => setDialogOpen(true)}
      >
        Add {CATEGORY_LABELS[category].toLowerCase()} source…
      </Button>
      <AddSourceDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onAdd={onAdd}
        category={category}
      />
    </>
  );
}

// ---- Step 0 — Sources ----

interface SourcesStepProps {
  sources: WizardSourcesState;
  onChange: (next: WizardSourcesState) => void;
}

function SourcesStep({ sources, onChange }: SourcesStepProps) {
  function addTo(cat: SourceCategory, src: WizardSource) {
    onChange({ ...sources, [cat]: [...sources[cat], src] });
  }
  function removeFrom(cat: SourceCategory, path: string) {
    onChange({ ...sources, [cat]: sources[cat].filter((s) => s.path !== path) });
  }

  const sections = [
    {
      id: "raw",
      title: (
        <span>
          Raw images{" "}
          <span style={{ fontSize: "var(--fs-dense)", color: "var(--danger)", fontWeight: 400 }}>
            Required
          </span>
        </span>
      ),
      count: sources.raw.length || undefined,
      defaultOpen: true,
      body: (
        <SourceCardBody
          category="raw"
          sources={sources.raw}
          onAdd={(s) => addTo("raw", s)}
          onRemove={(p) => removeFrom("raw", p)}
        />
      ),
    },
    {
      id: "calibration",
      title: (
        <span>
          Calibration images{" "}
          <span style={{ fontSize: "var(--fs-dense)", color: "var(--text-faint)", fontWeight: 400 }}>
            Optional
          </span>
        </span>
      ),
      count: sources.calibration.length || undefined,
      defaultOpen: false,
      body: (
        <>
          <p style={{ fontSize: "var(--fs-dense)", color: "var(--text-dim)", margin: "0 0 8px" }}>
            Dedicated locations for calibration libraries — darks, flats, biases. Skip if your
            calibration lives alongside raw data. You can add this later in Settings.
          </p>
          <SourceCardBody
            category="calibration"
            sources={sources.calibration}
            onAdd={(s) => addTo("calibration", s)}
            onRemove={(p) => removeFrom("calibration", p)}
          />
        </>
      ),
    },
    {
      id: "projects",
      title: (
        <span>
          Projects{" "}
          <span style={{ fontSize: "var(--fs-dense)", color: "var(--text-faint)", fontWeight: 400 }}>
            Optional
          </span>
        </span>
      ),
      count: sources.projects.length || undefined,
      defaultOpen: false,
      body: (
        <>
          <p style={{ fontSize: "var(--fs-dense)", color: "var(--text-dim)", margin: "0 0 8px" }}>
            Where the app stores per-project envelopes — source views, manifests, notes. You can
            add this later in Settings.
          </p>
          <SourceCardBody
            category="projects"
            sources={sources.projects}
            onAdd={(s) => addTo("projects", s)}
            onRemove={(p) => removeFrom("projects", p)}
          />
        </>
      ),
    },
    {
      id: "inbox",
      title: (
        <span>
          Inbox watch folders{" "}
          <span style={{ fontSize: "var(--fs-dense)", color: "var(--text-faint)", fontWeight: 400 }}>
            Optional
          </span>
        </span>
      ),
      count: sources.inbox.length || undefined,
      defaultOpen: false,
      body: (
        <>
          <p style={{ fontSize: "var(--fs-dense)", color: "var(--text-dim)", margin: "0 0 8px" }}>
            Folders to watch for newly-captured data. Items detected here appear on the Inbox page
            for review. You can add this later in Settings.
          </p>
          <SourceCardBody
            category="inbox"
            sources={sources.inbox}
            onAdd={(s) => addTo("inbox", s)}
            onRemove={(p) => removeFrom("inbox", p)}
          />
        </>
      ),
    },
  ];

  return (
    <div>
      <p
        style={{
          fontSize: "var(--fs-base)",
          color: "var(--text-dim)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Tell ALM where your astrophotography lives. Nothing moves during setup — the app only
        indexes what it finds. You can change every choice later in Settings.
      </p>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-1)",
          padding: "0 16px",
          marginBottom: 8,
        }}
      >
        <Accordion sections={sections} openMultiple />
      </div>
      <p style={{ fontSize: "var(--fs-dense)", color: "var(--text-faint)", marginTop: 8 }}>
        The app does not move, copy, or modify these files during setup. Indexing only.
      </p>
    </div>
  );
}

// ---- Step 1 — Symlink support check ----

type SymlinkOutcome = "supported" | "not_supported" | "disabled" | null;

interface SymlinkCheckSectionProps {
  result: SymlinkOutcome;
  onRecheck: () => void;
}

function SymlinkCheckSection({ result, onRecheck }: SymlinkCheckSectionProps) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-1)",
        padding: "14px 16px",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontWeight: "var(--fw-semibold)" as unknown as number,
            fontSize: "var(--fs-small)",
          }}
        >
          Symlink support
        </span>
        {result !== null && result !== "supported" && (
          <Button onClick={onRecheck}>Re-check</Button>
        )}
      </div>

      {result === null && (
        <p
          style={{
            margin: "var(--space-2) 0 0",
            fontSize: "var(--fs-dense)",
            color: "var(--text-faint)",
          }}
        >
          Checking…
        </p>
      )}

      {result === "supported" && (
        <p
          style={{
            margin: "var(--space-2) 0 0",
            fontSize: "var(--fs-dense)",
            color: "var(--success)",
          }}
        >
          ✓ Symlinks supported
        </p>
      )}

      {result === "disabled" && (
        <div style={{ marginTop: "var(--space-2)" }}>
          <p
            style={{
              fontSize: "var(--fs-dense)",
              color: "var(--warn)",
              margin: "0 0 var(--space-1)",
            }}
          >
            ⚠ Symlinks are not enabled. Run{" "}
            <code
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-micro)",
                background: "var(--surface-2)",
                padding: "1px 4px",
                borderRadius: "var(--r-xs)",
              }}
            >
              fsutil behavior set SymlinkEvaluation L2L:1 L2R:1
            </code>{" "}
            as administrator, then restart the wizard.
          </p>
        </div>
      )}

      {result === "not_supported" && (
        <div style={{ marginTop: "var(--space-2)" }}>
          <p
            style={{
              fontSize: "var(--fs-dense)",
              color: "var(--danger)",
              margin: "0 0 var(--space-1)",
            }}
          >
            ✕ Symlinks are not supported on this Windows configuration.
          </p>
          <p
            style={{
              fontSize: "var(--fs-dense)",
              color: "var(--text-dim)",
              margin: 0,
            }}
          >
            ALM will fall back to move / hardlink modes.
          </p>
        </div>
      )}
    </div>
  );
}

// ---- Step 1 — Tools & catalogs ----

const TOTAL_DOWNLOAD_MB = 12.4;
const FOUND_TOOLS = new Set(["PixInsight", "Siril", "Planetary Suite"]);

interface ToolsStepProps {
  state: ToolsStepState;
  onChange: (next: ToolsStepState | ((prev: ToolsStepState) => ToolsStepState)) => void;
}

function ToolsStep({ state, onChange }: ToolsStepProps) {
  const detectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const downloadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Run symlink check on first render
  useEffect(() => {
    if (state.symlinkResult === null) {
      const result = checkSymlinkSupport();
      onChange((prev: ToolsStepState) => ({ ...prev, symlinkResult: result }));
      // Persist the result so it's available globally
      updateSettings("symlinkSupport", result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRecheck = () => {
    const result = checkSymlinkSupport();
    onChange((prev: ToolsStepState) => ({ ...prev, symlinkResult: result }));
    updateSettings("symlinkSupport", result);
  };

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (detectionTimerRef.current != null) clearInterval(detectionTimerRef.current);
      if (downloadTimerRef.current != null) clearInterval(downloadTimerRef.current);
    };
  }, []);

  function startDetection() {
    if (state.detectionStarted) return;
    onChange({ ...state, detectionStarted: true, detectionChecked: 0 });

    const total = TOOL_NAMES.length;
    // Reveal one tool result every 750ms
    let checked = 0;
    const results: ToolResult[] = TOOL_NAMES.map((n) => ({ name: n, found: null }));

    detectionTimerRef.current = setInterval(() => {
      checked += 1;
      results[checked - 1] = {
        name: TOOL_NAMES[checked - 1],
        found: FOUND_TOOLS.has(TOOL_NAMES[checked - 1]),
      };
      if (checked >= total) {
        if (detectionTimerRef.current != null) clearInterval(detectionTimerRef.current);
        onChange((prev: ToolsStepState) => ({
          ...prev,
          detectionDone: true,
          detectionChecked: total,
          toolResults: [...results],
        }));
      } else {
        onChange((prev: ToolsStepState) => ({
          ...prev,
          detectionChecked: checked,
          toolResults: [...results],
        }));
      }
    }, 750);
  }

  function startDownload() {
    if (state.downloadStarted) return;
    onChange({ ...state, downloadStarted: true, downloadPct: 0 });

    // 10 increments over ~5 seconds (every 500ms = 10%)
    let pct = 0;
    downloadTimerRef.current = setInterval(() => {
      pct = Math.min(pct + 10, 100);
      if (pct >= 100) {
        if (downloadTimerRef.current != null) clearInterval(downloadTimerRef.current);
        onChange((prev: ToolsStepState) => ({
          ...prev,
          downloadDone: true,
          downloadPct: 100,
        }));
      } else {
        onChange((prev: ToolsStepState) => ({
          ...prev,
          downloadPct: pct,
        }));
      }
    }, 500);
  }

  const downloadedMB = ((state.downloadPct / 100) * TOTAL_DOWNLOAD_MB).toFixed(1);

  return (
    <div>
      <p
        style={{
          fontSize: "var(--fs-base)",
          color: "var(--text-dim)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        ALM works alongside your existing tools. We'll detect installed processing apps and
        download the catalog of named objects.
      </p>

      {/* Symlink support check — must be above tool detection */}
      <SymlinkCheckSection
        result={state.symlinkResult}
        onRecheck={handleRecheck}
      />

      {/* Tool detection row */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-1)",
          padding: "14px 16px",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: state.detectionStarted ? 12 : 0,
          }}
        >
          <span style={{ fontWeight: "var(--fw-semibold)" as unknown as number, fontSize: "var(--fs-small)" }}>
            Detect processing tools
          </span>
          {!state.detectionStarted ? (
            <Button onClick={startDetection}>Detect tools</Button>
          ) : !state.detectionDone ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: "var(--fs-dense)",
                color: "var(--text-dim)",
              }}
            >
              <Loader2 size={13} className="alm-log__scan-spinner" />
              {state.detectionChecked} of {TOOL_NAMES.length} checked
            </span>
          ) : (
            <span
              style={{ fontSize: "var(--fs-dense)", color: "var(--success, #2f9e44)" }}
            >
              <Check size={13} style={{ display: "inline", verticalAlign: "middle" }} /> Done
            </span>
          )}
        </div>
        {state.detectionStarted ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {state.toolResults.map((t) => (
              <li
                key={t.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "3px 0",
                  fontSize: "var(--fs-small)",
                  color: t.found === null ? "var(--text-faint)" : "var(--text)",
                }}
              >
                <span>{t.name}</span>
                {t.found === null ? (
                  <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-dense)" }}>—</span>
                ) : t.found ? (
                  <span style={{ color: "var(--success, #2f9e44)", fontSize: "var(--fs-dense)" }}>
                    ✓ Found
                  </span>
                ) : (
                  <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-dense)" }}>
                    — Not installed
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Catalog download row */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-1)",
          padding: "14px 16px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: state.downloadStarted && !state.downloadDone ? 10 : 0,
          }}
        >
          <span style={{ fontWeight: "var(--fw-semibold)" as unknown as number, fontSize: "var(--fs-small)" }}>
            Download OpenNGC catalog
          </span>
          {!state.downloadStarted ? (
            <Button onClick={startDownload}>Download</Button>
          ) : state.downloadDone ? (
            <span style={{ fontSize: "var(--fs-dense)", color: "var(--success, #2f9e44)" }}>
              ✓ OpenNGC 2024-08 (13,954 objects) · {TOTAL_DOWNLOAD_MB} MB
            </span>
          ) : (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: "var(--fs-dense)",
                color: "var(--text-dim)",
              }}
            >
              <Loader2 size={13} className="alm-log__scan-spinner" />
              {downloadedMB} / {TOTAL_DOWNLOAD_MB} MB · {state.downloadPct}%
            </span>
          )}
        </div>
        {state.downloadStarted && !state.downloadDone ? (
          <div className="alm-log__scan-bar" style={{ maxWidth: "100%" }}>
            <div
              className="alm-log__scan-bar-fill"
              style={{ width: `${state.downloadPct}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---- Step 2 — Done ----

interface DoneStepProps {
  sources: WizardSourcesState;
  toolResults: ToolResult[];
  onFinish: () => void;
}

function DoneStep({ sources, toolResults, onFinish }: DoneStepProps) {
  const foundTools = toolResults.filter((t) => t.found === true).map((t) => t.name);

  function plural(n: number, word: string) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  return (
    <div>
      <p
        style={{
          fontSize: "var(--fs-base)",
          color: "var(--text-dim)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Setup complete. Here's what was registered. You can change any of this later in Settings.
      </p>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-1)",
          padding: "16px",
          marginBottom: 24,
        }}
      >
        <h3
          style={{
            fontSize: "var(--fs-micro)",
            fontWeight: "var(--fw-semibold)" as unknown as number,
            color: "var(--text-faint)",
            margin: "0 0 12px",
            textTransform: "uppercase",
            letterSpacing: "var(--letter-wide)",
          }}
        >
          Summary
        </h3>

        {/* Sources */}
        {(["raw", "calibration", "projects", "inbox"] as const).map((cat) => {
          const list = sources[cat];
          if (list.length === 0) return null;
          return (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: "var(--fs-dense)",
                  color: "var(--text-dim)",
                  marginBottom: 4,
                }}
              >
                {plural(list.length, cat === "raw" ? "raw source" : cat === "calibration" ? "calibration source" : cat === "projects" ? "project source" : "inbox source")}
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {list.map((s) => (
                  <li
                    key={s.path}
                    className="alm-mono"
                    style={{
                      fontSize: "var(--fs-dense)",
                      color: "var(--text-dim)",
                      padding: "1px 0",
                    }}
                  >
                    {s.path}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {/* Tools */}
        {foundTools.length > 0 ? (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: "var(--fs-dense)", color: "var(--text-dim)", marginBottom: 2 }}>
              Tools detected: {foundTools.join(", ")}
            </div>
          </div>
        ) : null}

        {/* Catalog */}
        <div>
          <div style={{ fontSize: "var(--fs-dense)", color: "var(--text-dim)" }}>
            Catalog: OpenNGC 2024-08 (13,954 objects)
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <Button
          variant="primary"
          leadingIcon={<Check size={15} />}
          onClick={onFinish}
        >
          Start using Astro Library Manager
        </Button>
      </div>
    </div>
  );
}

// ---- Wizard step definitions ----

const WIZARD_STEPS = [
  { id: "sources", label: "Sources" },
  { id: "tools", label: "Tools & catalogs" },
  { id: "done", label: "Done" },
] as const;

type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

const STEP_SUBTITLES: Record<WizardStepId, string> = {
  sources: "Tell ALM where your astrophotography lives.",
  tools: "Detect installed processing apps and download the object catalog.",
  done: "You're all set.",
};

// ---- Main wizard ----

export function WelcomePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [sources, setSources] = useState<WizardSourcesState>(loadSources);
  const [toolsState, setToolsState] = useState<ToolsStepState>(initialToolsState);

  function handleSourcesChange(next: WizardSourcesState) {
    setSources(next);
    localStorage.setItem(SOURCES_KEY, JSON.stringify(next));
  }

  function handleNext() {
    if (step === 0) {
      localStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
      setStep(1);
    } else if (step === 1) {
      setStep(2);
    }
  }

  function handleBack() {
    if (step === 1) setStep(0);
    else if (step === 2) setStep(1);
  }

  function handleFinish() {
    localStorage.setItem("alm.first-run.completed", "1");
    navigate({ to: "/inventory" });
  }

  const canAdvanceStep0 = sources.raw.length > 0;
  const canAdvanceStep1 = toolsState.detectionDone && toolsState.downloadDone;

  const currentStepId = WIZARD_STEPS[step].id;

  return (
    <div className="alm-page">
      <div
        className="alm-page__body"
        style={{ display: "flex", justifyContent: "center", padding: "32px 24px 48px" }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {/* Page header */}
          <div style={{ marginBottom: 24 }}>
            <h1
              style={{
                fontSize: "var(--fs-xl)",
                fontWeight: "var(--fw-semibold)" as unknown as number,
                margin: "0 0 4px",
                letterSpacing: "var(--letter-tight)",
              }}
            >
              Welcome to Astro Library Manager
            </h1>
            <p style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)", margin: 0 }}>
              {STEP_SUBTITLES[currentStepId]}
            </p>
          </div>

          {/* Stepper */}
          <div style={{ marginBottom: 28 }}>
            <Stepper
              steps={WIZARD_STEPS.map((s) => ({ id: s.id, label: s.label }))}
              currentStepId={currentStepId}
            />
          </div>

          {/* Step body */}
          {step === 0 ? (
            <SourcesStep sources={sources} onChange={handleSourcesChange} />
          ) : step === 1 ? (
            <ToolsStep state={toolsState} onChange={setToolsState} />
          ) : (
            <DoneStep
              sources={sources}
              toolResults={toolsState.toolResults}
              onFinish={handleFinish}
            />
          )}

          {/* Bottom navigation row */}
          {step < 2 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 28,
              }}
            >
              <Button
                leadingIcon={<ArrowLeft size={14} />}
                onClick={handleBack}
                disabled={step === 0}
              >
                Back
              </Button>

              {step === 0 ? (
                canAdvanceStep0 ? (
                  <Button
                    variant="primary"
                    trailingIcon={<ArrowRight size={14} />}
                    onClick={handleNext}
                  >
                    Next: Tools &amp; catalogs
                  </Button>
                ) : (
                  <Tooltip content="Add at least one raw image source to continue">
                    <span>
                      <Button
                        variant="primary"
                        trailingIcon={<ArrowRight size={14} />}
                        disabled
                      >
                        Next: Tools &amp; catalogs
                      </Button>
                    </span>
                  </Tooltip>
                )
              ) : (
                <Button
                  variant="primary"
                  trailingIcon={<ArrowRight size={14} />}
                  onClick={handleNext}
                  disabled={!canAdvanceStep1}
                >
                  Next: Done
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
