import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, FolderPlus, X } from "lucide-react";

import { Button, IconButton, PageHeader } from "../../ui";
import { appendLog } from "../../data/store";

/**
 * First-run setup wizard (spec 003).
 *
 * Sequential one-time experience. The user moves linearly through:
 *   Welcome → Raw Sources → Calibration Sources → Project Sources →
 *   Inbox Sources → Finish.
 *
 * Sources added here are stored in localStorage under `alm.first-run.sources`
 * so later wiring can hydrate the inventory backend without re-prompting.
 * Native directory pickers are stubbed for the mockup; a real Tauri build
 * will swap the picker function with `@tauri-apps/plugin-dialog`.
 */

const STORAGE_KEY = "alm.first-run.sources";

type SourceKind = "raw" | "calibration" | "project" | "inbox";

interface SourceEntry {
  kind: SourceKind;
  path: string;
}

interface WizardStep {
  id: string;
  title: string;
  kind?: SourceKind;
  copy?: string;
  empty?: string;
}

const STEPS: WizardStep[] = [
  {
    id: "welcome",
    title: "Welcome to Astro Library Manager",
    copy: "We'll register the disk locations where you keep your astrophotography data. Nothing is moved or modified during setup — the app only indexes what it finds. You can change every choice later in Settings.",
  },
  {
    id: "raw",
    title: "Raw image sources",
    kind: "raw",
    copy: "Where are your raw light, dark, flat, and bias frames stored? You can add multiple locations — local drives, external drives, network shares.",
    empty: "No raw sources yet. Add at least one to continue.",
  },
  {
    id: "calibration",
    title: "Calibration sources",
    kind: "calibration",
    copy: "Optional: dedicated locations for calibration libraries (dark/bias/flat masters). Skip if your calibration lives alongside raw data.",
    empty: "No calibration sources yet — optional.",
  },
  {
    id: "project",
    title: "Project sources",
    kind: "project",
    copy: "Where the app stores per-project envelopes — sources view, manifests, notes. A single folder is fine.",
    empty: "No project source yet.",
  },
  {
    id: "inbox",
    title: "Inbox sources",
    kind: "inbox",
    copy: "Folders to watch for newly-captured data. Items detected here appear on the Inbox page for review.",
    empty: "No inbox sources yet — optional.",
  },
  {
    id: "finish",
    title: "You're ready",
    copy: "Setup is complete. You can revisit any of these choices from Settings → Data Sources.",
  },
];

function pickFolderStub(kind: SourceKind): Promise<string | null> {
  // Stub: a real Tauri build calls @tauri-apps/plugin-dialog open({ directory: true })
  const fallbackPaths: Record<SourceKind, string[]> = {
    raw: [
      "/Volumes/AstroDrive",
      "/home/sjors/astro/raw",
      "/scratch/legacy_2019",
    ],
    calibration: [
      "/Volumes/AstroDrive/calibration",
      "/home/sjors/astro/calibration",
    ],
    project: [
      "/home/sjors/astro/projects",
      "/Volumes/AstroDrive/projects",
    ],
    inbox: [
      "/Volumes/AstroDrive/inbox",
      "/home/sjors/astro/inbox",
    ],
  };
  let used: Set<string>;
  try {
    used = new Set(
      (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as SourceEntry[])
        .filter((s) => s.kind === kind)
        .map((s) => s.path),
    );
  } catch {
    used = new Set();
  }
  const pick = fallbackPaths[kind].find((p) => !used.has(p)) ?? null;
  return Promise.resolve(pick);
}

export function WelcomePage() {
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [sources, setSources] = useState<SourceEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    } catch {
      return [];
    }
  });

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const isFirst = stepIdx === 0;

  const persistSources = (next: SourceEntry[]) => {
    setSources(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const addSource = async () => {
    if (!step.kind) return;
    const picked = await pickFolderStub(step.kind);
    if (!picked) {
      appendLog({
        level: "warn",
        source: "setup",
        message: `no more ${step.kind} suggestions — connect a Tauri picker`,
      });
      return;
    }
    persistSources([...sources, { kind: step.kind, path: picked }]);
  };

  const removeSource = (path: string) => {
    persistSources(sources.filter((s) => !(s.kind === step.kind && s.path === path)));
  };

  const currentSources = step.kind ? sources.filter((s) => s.kind === step.kind) : [];

  // Raw is the only required step
  const canAdvance = step.id === "raw" ? currentSources.length > 0 : true;

  const finish = () => {
    localStorage.setItem("alm.first-run.completed", "1");
    appendLog({
      level: "info",
      source: "setup",
      message: `first-run complete — ${sources.length} sources registered`,
    });
    navigate({ to: "/inventory" });
  };

  return (
    <div className="alm-page">
      <PageHeader
        title={step.title}
        subtitle={`Step ${stepIdx + 1} of ${STEPS.length}`}
      />
      <div
        className="alm-page__body"
        style={{ display: "flex", justifyContent: "center", padding: "24px" }}
      >
        <div style={{ width: "min(640px, 100%)" }}>
          <Stepper stepIdx={stepIdx} />

          {step.copy ? (
            <p
              style={{
                fontSize: "var(--fs-base)",
                color: "var(--text-dim)",
                marginBottom: 16,
                lineHeight: 1.55,
              }}
            >
              {step.copy}
            </p>
          ) : null}

          {step.kind ? (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                background: "var(--surface-1)",
                marginBottom: 16,
              }}
            >
              {currentSources.length === 0 ? (
                <div
                  style={{
                    padding: 16,
                    color: "var(--text-faint)",
                    fontSize: "var(--fs-small)",
                  }}
                >
                  {step.empty}
                </div>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {currentSources.map((s) => (
                    <li
                      key={s.path}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        borderBottom: "1px solid var(--border-subtle)",
                        fontSize: "var(--fs-small)",
                      }}
                    >
                      <span className="alm-mono">{s.path}</span>
                      <IconButton
                        aria-label={`Remove ${s.path}`}
                        size="sm"
                        onClick={() => removeSource(s.path)}
                      >
                        <X size={12} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ padding: 10 }}>
                <Button leadingIcon={<FolderPlus size={14} />} onClick={addSource}>
                  Add {step.kind} source…
                </Button>
              </div>
            </div>
          ) : null}

          {step.kind ? (
            <div
              style={{
                fontSize: "var(--fs-dense)",
                color: "var(--text-faint)",
                marginBottom: 24,
              }}
            >
              The app does not move, copy, or modify these files. Indexing only.
            </div>
          ) : null}

          {step.id === "finish" ? (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                background: "var(--surface-1)",
                padding: 16,
                marginBottom: 16,
              }}
            >
              <h3 style={{ marginBottom: 8 }}>Registered sources</h3>
              {sources.length === 0 ? (
                <span className="alm-text-faint">No sources registered.</span>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {sources.map((s, idx) => (
                    <li
                      key={idx}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "100px 1fr",
                        padding: "4px 0",
                        fontSize: "var(--fs-small)",
                      }}
                    >
                      <span className="alm-text-dense alm-dim">{s.kind}</span>
                      <span className="alm-mono">{s.path}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Button
              leadingIcon={<ArrowLeft size={14} />}
              onClick={() => setStepIdx(stepIdx - 1)}
              disabled={isFirst}
            >
              Back
            </Button>
            {isLast ? (
              <Button
                variant="primary"
                leadingIcon={<Check size={14} />}
                onClick={finish}
              >
                Finish & open Inventory
              </Button>
            ) : (
              <Button
                variant="primary"
                trailingIcon={<ArrowRight size={14} />}
                onClick={() => setStepIdx(stepIdx + 1)}
                disabled={!canAdvance}
              >
                {STEPS[stepIdx + 1] ? `Next: ${STEPS[stepIdx + 1].title}` : "Next"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({ stepIdx }: { stepIdx: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 24,
      }}
    >
      {STEPS.map((s, idx) => (
        <span
          key={s.id}
          style={{
            flex: 1,
            height: 4,
            borderRadius: "var(--r-full)",
            background:
              idx <= stepIdx ? "var(--accent)" : "var(--surface-3)",
          }}
        />
      ))}
    </div>
  );
}
