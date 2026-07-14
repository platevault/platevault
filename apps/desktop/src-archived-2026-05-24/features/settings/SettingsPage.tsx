// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Search, ChevronDown, ChevronRight, Star, Wrench } from "lucide-react";

import {
  AddSourceDialog,
  Button,
  MultiSelect,
  RemapSourceDialog,
  SectionHeader,
  Select,
  SettingsRow,
  Switch,
  TextInput,
  Tooltip,
  StateLabel,
  type MultiSelectOption,
} from "../../ui";
import { PatternPreview, TokenPatternBuilder, type PatternPart } from "../../ui/TokenPattern";
import { availableTokens, settingsSections, CATALOG_OBJECTS, type AuditEventKind, type AuditEvent, type CatalogObject } from "../../data/mock";
import {
  updateSettings,
  useSettings,
  OVERRIDABLE_FRAME_TYPES,
  PROTECTED_CATEGORIES,
  toggleCatalogFavorite,
  updateCalibrationRule,
  updateToolProfile,
  type OverridableFrameType,
  type NamingPatterns,
  type DarkMatchTolerances,
  type ProtectedCategory,
  type CalibrationFrameRule,
  type ToolProfile,
} from "../../data/settings";
import { appendLog, appendAuditEvent, useAuditLog, useInventorySources } from "../../data/store";
import { useTheme } from "../../app/theme";

export function SettingsPage() {
  const params = useParams({ strict: false }) as { section?: string };
  const sectionId = params.section ?? "data-sources";
  const [query, setQuery] = useState("");

  const filteredSections = query.trim()
    ? settingsSections.filter((s) => {
        const q = query.trim().toLowerCase();
        return (
          s.label.toLowerCase().includes(q) ||
          s.searchTags.some((tag) => tag.toLowerCase().includes(q))
        );
      })
    : settingsSections;

  return (
    <div className="alm-settings" style={{ flex: 1, minHeight: 0 }}>
      <aside className="alm-settings__nav" aria-label="Settings sections">
        <div style={{ padding: "var(--space-2) var(--space-3)" }}>
          <TextInput
            leadingIcon={<Search size={13} />}
            placeholder="Search settings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search settings"
          />
        </div>
        <div className="alm-settings__nav-section">
          <div className="alm-settings__nav-label">Workflow</div>
          {filteredSections.map((section) => (
            <Link
              key={section.id}
              to={"/settings/$section" as never}
              params={{ section: section.id } as never}
              className="alm-settings__nav-link"
              data-active={sectionId === section.id ? "true" : undefined}
            >
              {section.label}
            </Link>
          ))}
        </div>
      </aside>
      <div className="alm-settings__pane">
        <SectionPane sectionId={sectionId} />
      </div>
    </div>
  );
}

function SectionPane({ sectionId }: { sectionId: string }) {
  switch (sectionId) {
    case "data-sources":
      return <DataSourcesSection />;
    case "naming-structure":
      return <NamingStructureSection />;
    case "calibration":
      return <CalibrationSection />;
    case "catalogs":
      return <CatalogsSection />;
    case "tool-workflows":
      return <ToolWorkflowsSection />;
    case "appearance":
      return <AppearanceSection />;
    case "audit":
      return <AuditLogSection />;
    case "source-protection":
      return <SourceProtectionSection />;
    case "backup":
      return <BackupExportSection />;
    default: {
      const section = settingsSections.find((s) => s.id === sectionId);
      return (
        <div>
          <h2>{section?.label ?? "Settings"}</h2>
          <div className="alm-settings__pane-desc">
            Settings for this section will appear here.
          </div>
        </div>
      );
    }
  }
}

/** Extracted so that `useSettings()` is always called at the top level of a component. */
function FollowSymlinksSwitch() {
  const s = useSettings();
  return (
    <Switch
      checked={s.followSymlinks}
      onCheckedChange={(v) => {
        updateSettings("followSymlinks", v);
        appendLog({ level: "info", source: "settings", message: `followSymlinks set to ${String(v)}` });
        appendAuditEvent({
          kind: "settings_changed",
          actor: "user",
          summary: `Setting changed: followSymlinks → ${String(v)}`,
          details: { before: String(s.followSymlinks), after: String(v) },
        });
      }}
    />
  );
}

function DataSourcesSection() {
  const navigate = useNavigate();
  const settings = useSettings();
  const sources = useInventorySources();
  const astroDrive = sources.find((s) => s.id === "src-astrodrive");
  const [remapOpen, setRemapOpen] = useState(false);
  // Unified "Add source" dialog — no fixed category; dialog shows a category selector
  const [addSourceOpen, setAddSourceOpen] = useState(false);

  return (
    <div>
      <h2>Data Sources</h2>
      <div className="alm-settings__pane-desc">
        Registered filesystem locations the app indexes. The app never moves files
        without a reviewed plan.
      </div>

      {/* Section-level action row: single Add source button + Restart wizard */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          marginTop: "var(--space-3)",
          marginBottom: "var(--space-4)",
        }}
      >
        <Button variant="primary" onClick={() => setAddSourceOpen(true)}>
          + Add source
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            // Fully reset wizard state so the tutorial actually re-runs:
            //   - `alm.first-run.completed` gates the index route → must
            //     be cleared or `/` bounces straight to `/inventory`.
            //   - `alm.first-run.sources` is the wizard's persisted source
            //     selection; if left in place, Step 0 boots pre-populated
            //     with the previous run, making the tutorial feel skipped.
            //   - `symlinkSupport` lives in the global settings blob and
            //     also caches the previous wizard outcome — wipe it so the
            //     symlink check actually re-runs.
            localStorage.removeItem("alm.first-run.completed");
            localStorage.removeItem("alm.first-run.sources");
            updateSettings("symlinkSupport", null);
            navigate({ to: "/welcome" });
          }}
        >
          Restart setup wizard
        </Button>
      </div>

      <SectionHeader>Raw sources</SectionHeader>
      <SettingsRow
        label={astroDrive?.path ?? "/Volumes/AstroDrive"}
        description={
          astroDrive?.state === "reconnect_required"
            ? "disconnected · last seen 2026-05-19"
            : "external · 1.4 TB free"
        }
        info="A raw source is a filesystem root the app indexes for acquisition frames. The app never moves files from this location without a reviewed plan. If the drive is disconnected, use Reconnect to point the source at its new mount path without losing session history."
      >
        {astroDrive?.state === "reconnect_required" ? (
          <Button variant="ghost" onClick={() => setRemapOpen(true)}>
            Reconnect…
          </Button>
        ) : (
          <span className="alm-state" data-tone="success">
            <span className="alm-state__dot" /> active
          </span>
        )}
      </SettingsRow>
      <SettingsRow
        label="/home/sjors/astro/raw"
        description="local · 240 GB free"
        info="A raw source is a filesystem root the app indexes for acquisition frames. The app never moves files from this location without a reviewed plan."
      >
        <span className="alm-state" data-tone="success"><span className="alm-state__dot" /> active</span>
      </SettingsRow>

      <SectionHeader>Calibration sources</SectionHeader>
      <SettingsRow
        label="/Volumes/AstroDrive/calibration"
        description="external"
        info="A calibration source holds dark, flat, and bias frame libraries. The app matches these against light sessions using your configured tolerance rules. Calibration sources are indexed read-only — no plan will move files out of them unless you generate a cleanup plan explicitly."
      >
        <span className="alm-state" data-tone="success"><span className="alm-state__dot" /> active</span>
      </SettingsRow>

      <SectionHeader>Project sources</SectionHeader>
      <SettingsRow
        label="/home/sjors/astro/projects"
        info="A project source is where the app writes project envelopes, source views, and manifests. It must be writable. The app never writes raw or calibration frames here — only project-owned metadata and symlinked source views."
      >
        <span className="alm-state" data-tone="success"><span className="alm-state__dot" /> active</span>
      </SettingsRow>

      <SectionHeader>Inbox sources</SectionHeader>
      <SettingsRow
        label="/Volumes/AstroDrive/inbox"
        description="watched · 142 items pending"
        info="An inbox source is a folder the app watches for new capture exports. When new files appear, the app proposes them as Inbox items for classification. Files stay here until you confirm a plan — the app never moves them automatically."
      >
        <span className="alm-state" data-tone="success"><span className="alm-state__dot" /> watching</span>
      </SettingsRow>

      <SectionHeader>Scan behavior</SectionHeader>
      <SettingsRow
        label="Follow symlinks"
        description="When off, symlinks and junctions are skipped during scan."
        info="When off, symlinks and junctions are skipped during scan. Turn on only if your library deliberately uses symlinks to deduplicate calibration libraries across drives."
      >
        <FollowSymlinksSwitch />
      </SettingsRow>
      <SettingsRow
        label="Hash files on scan"
        description="Lazy hashing — only computed when a feature needs it."
        info="Controls when file content hashes are computed. Lazy: only when a feature (e.g. duplicate detection) needs it — recommended for large libraries. Eager: hash every file on first scan, useful for integrity checks. Off: never hash automatically."
      >
        <HashOnScanSelect value={settings.hashOnScan} />
      </SettingsRow>

      {astroDrive ? (
        <RemapSourceDialog
          open={remapOpen}
          onOpenChange={setRemapOpen}
          sourceId={astroDrive.id}
          currentPath={astroDrive.path}
          lastSeen="2026-05-19"
        />
      ) : null}

      {/* Unified Add source — no category prop so dialog shows the category selector */}
      <AddSourceDialog
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        onAdd={({ path, kind, category }) => {
          appendLog({
            level: "info",
            source: "settings",
            message: `source added: ${path} (${kind}, ${category})`,
          });
        }}
      />
    </div>
  );
}

function HashOnScanSelect({ value }: { value: "lazy" | "eager" | "off" }) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        updateSettings("hashOnScan", v as "lazy" | "eager" | "off");
        appendLog({ level: "info", source: "settings", message: `hashOnScan set to ${v}` });
      }}
      options={[
        { value: "lazy", label: "Lazy (default)" },
        { value: "eager", label: "Eager" },
        { value: "off", label: "Off" },
      ]}
      minWidth={140}
    />
  );
}

/** Frame type display names for the per-type override list (mixed excluded — not overridable). */
const FRAME_TYPE_LABELS: Record<OverridableFrameType, string> = {
  light: "Light",
  dark: "Dark",
  flat: "Flat",
  bias: "Bias",
  dark_flat: "Dark flat",
};

/**
 * Parse a pattern string like "{target}/{filter}/{date}/" into PatternPart[].
 * Used to seed per-frame override builders from the current global pattern string.
 */
function parsePatternString(s: string): PatternPart[] {
  const parts: PatternPart[] = [];
  let i = 0;
  let idx = 0;
  while (i < s.length) {
    if (s[i] === "{") {
      const end = s.indexOf("}", i);
      if (end === -1) {
        // Malformed: treat rest as separator
        parts.push({ id: `p-${idx++}`, kind: "separator", value: s.slice(i) });
        break;
      }
      parts.push({ id: `p-${idx++}`, kind: "token", value: s.slice(i + 1, end) });
      i = end + 1;
    } else {
      // Collect consecutive separator chars
      let j = i + 1;
      while (j < s.length && s[j] !== "{") j++;
      parts.push({ id: `p-${idx++}`, kind: "separator", value: s.slice(i, j) });
      i = j;
    }
  }
  return parts;
}

/** State for a single per-frame TokenPattern override row. */
interface FrameOverrideState {
  enabled: boolean;
  /** Token-part array for this frame type's override pattern. */
  parts: PatternPart[];
}

function NamingStructureSection() {
  const settings = useSettings();
  const pattern = settings.pattern;
  const namingPatterns: NamingPatterns = settings.namingPatterns;

  // Initialize per-frame override state from persisted overrides
  const [overrides, setOverrides] = useState<Record<OverridableFrameType, FrameOverrideState>>(
    () => {
      const init = {} as Record<OverridableFrameType, FrameOverrideState>;
      for (const ft of OVERRIDABLE_FRAME_TYPES) {
        const persisted = namingPatterns.overrides[ft];
        init[ft] = {
          enabled: persisted !== undefined,
          parts: persisted !== undefined
            ? parsePatternString(persisted)
            : [...pattern],
        };
      }
      return init;
    },
  );

  const persistOverride = (ft: OverridableFrameType, parts: PatternPart[]) => {
    const value = parts.map((p) => (p.kind === "token" ? `{${p.value}}` : p.value)).join("");
    const newOverrides = { ...namingPatterns.overrides, [ft]: value };
    updateSettings("namingPatterns", { ...namingPatterns, overrides: newOverrides });
  };

  const clearPersistedOverride = (ft: OverridableFrameType) => {
    const newOverrides = { ...namingPatterns.overrides };
    delete newOverrides[ft];
    updateSettings("namingPatterns", { ...namingPatterns, overrides: newOverrides });
  };

  const handleToggle = (ft: OverridableFrameType, v: boolean) => {
    if (v) {
      // Seed from global pattern on first enable
      const seedParts = [...pattern];
      setOverrides((prev) => ({
        ...prev,
        [ft]: { enabled: true, parts: prev[ft].parts.length > 0 ? prev[ft].parts : seedParts },
      }));
      persistOverride(ft, overrides[ft].parts.length > 0 ? overrides[ft].parts : seedParts);
    } else {
      setOverrides((prev) => ({ ...prev, [ft]: { ...prev[ft], enabled: false } }));
      clearPersistedOverride(ft);
    }
  };

  const handleAddPart = (ft: OverridableFrameType, part: Omit<PatternPart, "id">) => {
    const cur = overrides[ft].parts;
    const next: PatternPart[] = [...cur, { ...part, id: `${ft}-p${cur.length}-${Date.now()}` }];
    setOverrides((prev) => ({ ...prev, [ft]: { ...prev[ft], parts: next } }));
    persistOverride(ft, next);
  };

  const handleRemovePart = (ft: OverridableFrameType, id: string) => {
    const next = overrides[ft].parts.filter((p) => p.id !== id);
    setOverrides((prev) => ({ ...prev, [ft]: { ...prev[ft], parts: next } }));
    persistOverride(ft, next);
  };

  return (
    <div>
      <h2>Naming &amp; Structure</h2>
      <div className="alm-settings__pane-desc">
        Pattern used when files are confirmed from Inbox to Inventory.
      </div>

      <SectionHeader>Global pattern</SectionHeader>
      <div style={{ marginBottom: 16 }}>
        <TokenPatternBuilder
          pattern={pattern}
          availableTokens={availableTokens}
          onAdd={(part) =>
            updateSettings("pattern", [
              ...pattern,
              { ...part, id: `p${pattern.length + 1}-${Date.now()}` },
            ])
          }
          onRemove={(id) =>
            updateSettings(
              "pattern",
              pattern.filter((part) => part.id !== id),
            )
          }
        />
      </div>

      <SectionHeader marginTop="var(--space-4)">Preview using recent FITS</SectionHeader>
      <PatternPreview
        rows={[
          { path: "M101/Ha/2026-04-12/lights/", count: 98 },
          { path: "M101/OIII/2026-04-13/lights/", count: 38 },
          { path: "M101/—/2026-04/darks/", count: 30 },
        ]}
      />

      {/*
        Per-frame-type overrides.
        mixed is excluded — mixed-content folders are split by the Inbox flow before
        any pattern is applied, so a per-mixed pattern would never be used.
        Override list: light, dark, flat, bias, dark_flat (OVERRIDABLE_FRAME_TYPES).
      */}
      <SectionHeader>Per-frame-type overrides</SectionHeader>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {OVERRIDABLE_FRAME_TYPES.map((ft) => {
          const state = overrides[ft];
          return (
            <div
              key={ft}
              style={{
                borderBottom: "1px solid var(--border-subtle)",
                padding: "var(--space-2) 0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <Switch
                  checked={state.enabled}
                  onCheckedChange={(v) => handleToggle(ft, v)}
                  aria-label={`Override pattern for ${FRAME_TYPE_LABELS[ft]}`}
                />
                <span
                  style={{
                    minWidth: 80,
                    fontSize: "var(--fs-small)",
                    fontWeight: "var(--fw-medium)",
                    color: state.enabled ? "var(--text)" : "var(--text-dim)",
                  }}
                >
                  {FRAME_TYPE_LABELS[ft]}
                </span>
                {!state.enabled && (
                  <span className="alm-setting-row__hint">Inherit global</span>
                )}
              </div>
              {state.enabled ? (
                <div style={{ marginTop: "var(--space-2)", paddingLeft: 44 }}>
                  <TokenPatternBuilder
                    pattern={state.parts}
                    availableTokens={availableTokens}
                    onAdd={(part) => handleAddPart(ft, part)}
                    onRemove={(id) => handleRemovePart(ft, id)}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 28 }}>
        <SettingsRow
          label="Always preview destinations before plan"
          description="When on, adds an inline preview step before generating the plan."
          info="When on, Inbox confirm shows a destination preview before creating a plan. Useful for new libraries or when the pattern has overrides you want to verify."
        >
          <Switch
            checked={settings.alwaysPreviewBeforePlan}
            onCheckedChange={(v) => {
              updateSettings("alwaysPreviewBeforePlan", v);
              appendLog({ level: "info", source: "settings", message: `alwaysPreviewBeforePlan set to ${String(v)}` });
            }}
          />
        </SettingsRow>
      </div>

      <SectionHeader>Per-source overrides</SectionHeader>
      <SettingsRow
        label="/Volumes/AstroDrive"
        description="uses library default"
        info="When no per-source override is set, this source uses the global naming pattern. Override to apply a different folder structure to just this source — useful when a drive has a pre-existing layout you want to preserve."
      >
        <Button>Override…</Button>
      </SettingsRow>
      <SettingsRow
        label="/home/sjors/astro/raw"
        description="uses library default"
        info="When no per-source override is set, this source uses the global naming pattern. Override to apply a different folder structure to just this source — useful when a drive has a pre-existing layout you want to preserve."
      >
        <Button>Override…</Button>
      </SettingsRow>
      <SettingsRow
        label="/scratch/legacy_2019"
        description={
          <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-dense)" }}>
            {`override: {date}/{frame_type}`}
          </code>
        }
        info="This source has a custom naming pattern that overrides the global default. Plans targeting this source will use the override pattern instead of the library-wide one. Edit to change the override; removing it restores the global pattern."
      >
        <Button>Edit</Button>
      </SettingsRow>
    </div>
  );
}

/**
 * Numeric input with a unit suffix — used for calibration tolerances.
 * Persists to settings on blur; intermediate keystrokes update local draft only.
 */
function NumericToleranceInput({
  value,
  unit,
  min,
  max,
  step,
  ariaLabel,
  onCommit,
}: {
  value: number;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
  /** Called once on blur with the committed numeric value (only if changed). */
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  // Sync draft if external value changes (e.g. reset from outside)
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(String(value));
  }

  const handleBlur = () => {
    const n = parseFloat(draft);
    if (isNaN(n)) {
      setDraft(String(value));
      return;
    }
    const clamped =
      min !== undefined && max !== undefined
        ? Math.max(min, Math.min(max, n))
        : min !== undefined
        ? Math.max(min, n)
        : max !== undefined
        ? Math.min(max, n)
        : n;
    setDraft(String(clamped));
    if (clamped !== value) {
      onCommit(clamped);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
      <TextInput
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        aria-label={ariaLabel}
        style={{ width: 72 }}
        {...(min !== undefined ? { min: String(min) } : {})}
        {...(max !== undefined ? { max: String(max) } : {})}
        {...(step !== undefined ? { step: String(step) } : {})}
      />
      <span style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)" }}>{unit}</span>
    </span>
  );
}

/**
 * Gain tolerance input — persists on blur so keystrokes don't flood the audit log.
 * Uses local state while editing, commits to settings store on blur.
 */
function GainToleranceInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  // Sync external value back into draft when it changes from outside
  const [prevExternal, setPrevExternal] = useState(value);
  if (value !== prevExternal) {
    setPrevExternal(value);
    setDraft(String(value));
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
      <TextInput
        type="number"
        value={draft}
        min="0"
        max="1000"
        step="1"
        aria-label="Gain tolerance in sensor units (0 = exact match)"
        style={{ width: 72 }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseFloat(draft);
          const clamped = isNaN(n) ? 0 : Math.max(0, Math.min(1000, n));
          setDraft(String(clamped));
          if (clamped !== value) {
            onCommit(clamped);
            appendAuditEvent({
              kind: "settings_changed",
              actor: "user",
              summary: `Setting changed: gain tolerance → ${clamped} units`,
              details: { before: String(value), after: String(clamped) },
            });
          }
        }}
      />
      <span style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)" }}>units</span>
    </span>
  );
}

function CalibrationSection() {
  const s = useSettings();
  const tol: DarkMatchTolerances = s.darkMatchTolerances;

  const setTol = (patch: Partial<DarkMatchTolerances>, auditSummary: string) => {
    const next = { ...tol, ...patch };
    updateSettings("darkMatchTolerances", next);
    appendLog({ level: "info", source: "settings", message: "darkMatchTolerances updated" });
    appendAuditEvent({
      kind: "settings_changed",
      actor: "user",
      summary: auditSummary,
    });
  };

  return (
    <div>
      <h2>Calibration</h2>
      <div className="alm-settings__pane-desc">
        Matching rules for darks, flats, and biases.
      </div>

      <SectionHeader>Dark frame matching</SectionHeader>

      <SettingsRow
        label="Exposure tolerance"
        info="How close the dark frame's exposure time must match the light frame, in seconds. Lower values reject more matches; higher values accept loosely matching darks. Default ±5s suits most CMOS sensors."
      >
        <NumericToleranceInput
          value={tol.exposureSecs}
          unit="s"
          min={0}
          max={300}
          step={1}
          ariaLabel="Dark exposure tolerance in seconds"
          onCommit={(v) => setTol({ exposureSecs: v }, `Setting changed: dark exposure tolerance → ${v}s`)}
        />
      </SettingsRow>
      <SettingsRow
        label="Temperature tolerance"
        info="Maximum allowed difference in sensor set-temperature between the dark and the light frame. A tighter tolerance improves noise suppression but reduces available dark matches. Default ±2°C."
      >
        <NumericToleranceInput
          value={tol.tempCelsius}
          unit="°C"
          min={0}
          max={20}
          step={0.5}
          ariaLabel="Dark temperature tolerance in Celsius"
          onCommit={(v) => setTol({ tempCelsius: v }, `Setting changed: dark temperature tolerance → ${v}°C`)}
        />
      </SettingsRow>
      <SettingsRow
        label="Gain tolerance"
        info="Maximum allowed gain difference between dark and light frames, in sensor units. Zero (default) requires an exact gain match. Raise this only for sensors where small gain differences do not affect dark current, or when you have no exact-gain dark library."
      >
        <GainToleranceInput value={tol.gainUnits} onCommit={(v) => setTol({ gainUnits: v }, `Setting changed: gain tolerance → ${v} units`)} />
      </SettingsRow>

      <SectionHeader>Flat frame matching</SectionHeader>
      <SettingsRow
        label="Flat matching"
        description="Match by filter and rotation; ignore date."
        info="Controls which metadata must match between a flat frame and its light session. Filter + rotation is the safest default. Filter only relaxes rotation matching for setups where flats are always taken at the same angle. Manual disables automatic suggestions."
      >
        <Select
          value={s.flatMatching}
          onValueChange={(v) => {
            updateSettings("flatMatching", v as "filter-rot" | "filter" | "manual");
            appendLog({ level: "info", source: "settings", message: `flatMatching set to ${v}` });
          }}
          options={[
            { value: "filter-rot", label: "Filter + rotation" },
            { value: "filter", label: "Filter only" },
            { value: "manual", label: "Manual" },
          ]}
          minWidth={180}
        />
      </SettingsRow>
      <SettingsRow
        label="Suggest matches automatically"
        info="When on, the app proposes calibration matches in the Inventory drawer as soon as a session enters candidate or confirmed state. Turn off if you prefer to assign calibration manually."
      >
        <Switch
          checked={s.suggestCalibration}
          onCheckedChange={(v) => {
            updateSettings("suggestCalibration", v);
            appendLog({ level: "info", source: "settings", message: `suggestCalibration set to ${String(v)}` });
          }}
        />
      </SettingsRow>

      <SectionHeader>Per-frame-type matching rules</SectionHeader>
      <CalibrationRuleEditor />
    </div>
  );
}

function AppearanceSection() {
  const s = useSettings();
  const { mode, setMode } = useTheme();
  return (
    <div>
      <h2>Appearance</h2>
      <div className="alm-settings__pane-desc">
        Theme follows your OS by default.
      </div>
      <SettingsRow
        label="Theme"
        info="Follow OS: the app switches between light and dark to match your system preference automatically. Light or Dark: overrides the OS preference and locks the app into the chosen colour scheme."
      >
        <Select
          value={mode}
          onValueChange={(v) => {
            setMode(v as "system" | "light" | "dark");
            appendLog({ level: "info", source: "settings", message: `theme set to ${v}` });
            appendAuditEvent({
              kind: "settings_changed",
              actor: "user",
              summary: `Setting changed: theme → ${v}`,
              details: { before: mode, after: v },
            });
          }}
          options={[
            { value: "system", label: "Follow OS" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          minWidth={140}
        />
      </SettingsRow>
      <SettingsRow
        label="Row density"
        description="Affects all ledgers. Dense fits more without scrolling."
        info="Dense: tighter row height in all ledger tables — shows more sessions per screen without scrolling. Comfortable: adds vertical breathing room, easier to scan individual rows at a glance."
      >
        <Select
          value={s.rowDensity}
          onValueChange={(v) => {
            updateSettings("rowDensity", v as "dense" | "comfortable");
            appendLog({ level: "info", source: "settings", message: `rowDensity set to ${v}` });
          }}
          options={[
            { value: "dense", label: "Dense (default)" },
            { value: "comfortable", label: "Comfortable" },
          ]}
          minWidth={150}
        />
      </SettingsRow>
    </div>
  );
}

const AUDIT_KIND_LABELS: Record<AuditEventKind, string> = {
  plan_applied: "plan applied",
  plan_failed: "plan failed",
  plan_discarded: "plan discarded",
  session_reclassified: "session reclassified",
  source_added: "source added",
  source_disconnected: "source disconnected",
  source_remapped: "source remapped",
  wizard_completed: "wizard completed",
  settings_changed: "settings changed",
};

const AUDIT_KIND_TONE: Record<
  AuditEventKind,
  "neutral" | "info" | "success" | "warn" | "danger" | "accent"
> = {
  plan_applied: "success",
  plan_failed: "danger",
  plan_discarded: "neutral",
  session_reclassified: "info",
  source_added: "info",
  source_disconnected: "warn",
  source_remapped: "accent",
  wizard_completed: "success",
  settings_changed: "neutral",
};

const ALL_AUDIT_KINDS: AuditEventKind[] = [
  "plan_applied",
  "plan_failed",
  "plan_discarded",
  "session_reclassified",
  "source_added",
  "source_disconnected",
  "source_remapped",
  "wizard_completed",
  "settings_changed",
];

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function AuditEventRow({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!event.details && Object.keys(event.details).length > 0;
  return (
    <div
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        padding: "var(--space-2) 0",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "70px 160px 1fr auto",
          gap: "var(--space-2)",
          alignItems: "center",
          fontSize: "var(--fs-dense)",
        }}
      >
        <span style={{ color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
          {relativeTime(event.at)}
        </span>
        <StateLabel tone={AUDIT_KIND_TONE[event.kind]}>
          {AUDIT_KIND_LABELS[event.kind]}
        </StateLabel>
        <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {event.summary}
        </span>
        {hasDetails ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((x) => !x)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Details
          </Button>
        ) : null}
      </div>
      {expanded && hasDetails ? (
        <pre
          style={{
            marginTop: "var(--space-1)",
            marginLeft: 70,
            padding: "var(--space-2)",
            background: "var(--surface-2)",
            borderRadius: "var(--r-sm)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-micro)",
            color: "var(--text-dim)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {JSON.stringify(event.details, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function toMultiSelectTone(
  t: "neutral" | "info" | "success" | "warn" | "danger" | "accent",
): "neutral" | "success" | "warn" | "danger" {
  if (t === "success") return "success";
  if (t === "warn") return "warn";
  if (t === "danger") return "danger";
  return "neutral";
}

const AUDIT_KIND_OPTIONS: MultiSelectOption[] = ALL_AUDIT_KINDS.map((kind) => ({
  value: kind,
  label: AUDIT_KIND_LABELS[kind],
  tone: toMultiSelectTone(AUDIT_KIND_TONE[kind]),
}));

function AuditLogSection() {
  const s = useSettings();
  const allEvents = useAuditLog();
  // All kinds active by default (empty = show all)
  const [activeKindsList, setActiveKindsList] = useState<AuditEventKind[]>([...ALL_AUDIT_KINDS]);

  const activeKindsSet = new Set(activeKindsList);

  const filteredEvents =
    activeKindsList.length === ALL_AUDIT_KINDS.length
      ? allEvents
      : allEvents.filter((e) => activeKindsSet.has(e.kind));

  const newestAt = allEvents[0]?.at;

  return (
    <div>
      <h2>Audit log</h2>
      <div className="alm-settings__pane-desc">
        Durable record of all user and system actions.
      </div>

      {/* Summary line */}
      <div
        style={{
          fontSize: "var(--fs-dense)",
          color: "var(--text-dim)",
          marginBottom: "var(--space-3)",
        }}
      >
        {allEvents.length} events
        {newestAt ? ` · last ${relativeTime(newestAt)}` : ""}
      </div>

      {/* Filter by event kind */}
      <div style={{ marginBottom: "var(--space-3)" }}>
        <MultiSelect
          ariaLabel="Filter by event kind"
          value={activeKindsList}
          options={AUDIT_KIND_OPTIONS}
          onValueChange={(v) => setActiveKindsList(v as AuditEventKind[])}
          allLabel="All event kinds"
          emptyLabel="No kinds"
          minWidth={200}
          showTones
        />
      </div>

      {/* Event list */}
      <div
        style={{
          maxHeight: 460,
          overflowY: "auto",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--r-sm)",
          padding: "0 var(--space-3)",
          background: "var(--surface-1)",
        }}
      >
        {filteredEvents.length === 0 ? (
          <div
            style={{
              padding: "var(--space-4) 0",
              color: "var(--text-faint)",
              fontSize: "var(--fs-dense)",
              textAlign: "center",
            }}
          >
            No events match the selected filters.
          </div>
        ) : (
          filteredEvents.map((event) => (
            <AuditEventRow key={event.id} event={event} />
          ))
        )}
      </div>

      {/* Log behavior settings below */}
      <SectionHeader>Log behavior</SectionHeader>
      <SettingsRow
        label="Log level"
        info="Controls which log messages are written to the runtime log panel. Error: only critical failures. Warn: failures and recovery warnings. Info: normal lifecycle events (plan applied, scan complete) — recommended for daily use. Debug: verbose trace output, useful when diagnosing unexpected app behaviour."
      >
        <Select
          value={s.logLevel}
          onValueChange={(v) => {
            updateSettings("logLevel", v as "error" | "warn" | "info" | "debug");
            appendLog({ level: "info", source: "settings", message: `logLevel set to ${v}` });
          }}
          options={[
            { value: "error", label: "Error" },
            { value: "warn", label: "Warn" },
            { value: "info", label: "Info" },
            { value: "debug", label: "Debug" },
          ]}
          minWidth={140}
        />
      </SettingsRow>
      <SettingsRow
        label="Remember follow-logs state"
        info="When on, the log panel remembers whether you had auto-scroll (follow) enabled the last time you used it. When off, the panel always opens with auto-scroll off, so you can read historical entries without being bumped to the bottom."
      >
        <Switch
          checked={s.rememberFollowLogs}
          onCheckedChange={(v) => {
            updateSettings("rememberFollowLogs", v);
            appendLog({ level: "info", source: "settings", message: `rememberFollowLogs set to ${String(v)}` });
          }}
        />
      </SettingsRow>
      <SettingsRow
        label="Export logs"
        info="Downloads the current in-memory runtime log as a JSON file. Useful for bug reports or offline review. The export does not include the audit log — export that separately from the Audit log section above."
      >
        <Button>Export JSON…</Button>
      </SettingsRow>
    </div>
  );
}

const PROTECTED_CATEGORY_OPTIONS: MultiSelectOption[] = PROTECTED_CATEGORIES.map((cat) => ({
  value: cat,
  label: cat,
  tone: "neutral" as const,
}));

function SourceProtectionSection() {
  const s = useSettings();

  const setCategories = (nextValues: string[]) => {
    const prev = new Set(s.protectedCategories);
    const next = new Set(nextValues as ProtectedCategory[]);
    const list = PROTECTED_CATEGORIES.filter((c) => next.has(c));
    updateSettings("protectedCategories", list);
    // Emit one audit event summarising the delta
    const added = PROTECTED_CATEGORIES.filter((c) => !prev.has(c) && next.has(c));
    const removed = PROTECTED_CATEGORIES.filter((c) => prev.has(c) && !next.has(c));
    if (added.length > 0 || removed.length > 0) {
      const parts: string[] = [];
      if (added.length > 0) parts.push(`added: ${added.join(", ")}`);
      if (removed.length > 0) parts.push(`removed: ${removed.join(", ")}`);
      appendAuditEvent({
        kind: "settings_changed",
        actor: "user",
        summary: `Protected categories changed — ${parts.join("; ")}`,
        details: { after: list.join(", ") },
      });
    }
  };

  return (
    <div>
      <h2>Source Protection</h2>
      <div className="alm-settings__pane-desc">
        Per-source rules that gate destructive actions. Defaults apply unless
        a source overrides them.
      </div>
      <SettingsRow
        label="Default protection"
        info="Sets how the app treats a source if no per-source rule overrides it. Protect: requires a reviewed plan and shows a warning for any destructive action. Normal: requires a plan but no extra warning. Unprotected: allows plans without the extra gate — use only for scratch or disposable sources."
      >
        <Select
          value={s.defaultProtection}
          onValueChange={(v) => {
            updateSettings(
              "defaultProtection",
              v as "protected" | "normal" | "unprotected",
            );
            appendLog({ level: "info", source: "settings", message: `defaultProtection set to ${v}` });
          }}
          options={[
            { value: "protected", label: "Protect (warn + plan)" },
            { value: "normal", label: "Normal (plan only)" },
            { value: "unprotected", label: "Unprotected (advanced)" },
          ]}
          minWidth={240}
        />
      </SettingsRow>
      <SettingsRow
        label="Block permanent delete"
        description="Cleanup defaults to archive/trash unless explicitly overridden."
        info="When on, the app refuses to generate plans that permanently delete files. Cleanup actions are routed to archive or trash instead. Turn off only if you are certain you want irreversible deletions and have a separate backup strategy."
      >
        <Switch
          checked={s.blockPermanentDelete}
          onCheckedChange={(v) => {
            updateSettings("blockPermanentDelete", v);
            appendLog({ level: "info", source: "settings", message: `blockPermanentDelete set to ${String(v)}` });
          }}
        />
      </SettingsRow>
      <SettingsRow
        label="Protected categories"
        description="Select the folder categories that must never appear in destructive plans."
        info="These categories are excluded from any cleanup or delete plan regardless of other settings. Selecting 'raw sessions' prevents the app from ever proposing to move or delete unprocessed capture folders. Only categories from this list can be protected — free-text is not accepted."
      >
        <MultiSelect
          ariaLabel="Protected categories"
          value={s.protectedCategories}
          options={PROTECTED_CATEGORY_OPTIONS}
          onValueChange={setCategories}
          allLabel="All categories"
          emptyLabel="None"
          minWidth={220}
        />
      </SettingsRow>
    </div>
  );
}

/* ======================================================================
   Calibration rule editor — per-frame-type
   4-box grid: dark | flat | bias | dark_flat
   `light` is intentionally excluded: lights match downstream against
   the per-type rules, there is nothing to configure on the light side.
   ====================================================================== */

const CAL_FRAME_TYPES = ["dark", "flat", "bias", "dark_flat"] as const;
type CalFrameType = (typeof CAL_FRAME_TYPES)[number];

const CAL_FRAME_LABELS: Record<CalFrameType, string> = {
  dark: "Dark",
  flat: "Flat",
  bias: "Bias",
  dark_flat: "Dark flat",
};

/** Fields available per frame type for the checkbox list */
const CAL_FIELDS: Record<CalFrameType, Array<{ id: string; label: string; alwaysRequired?: boolean }>> = {
  dark: [
    { id: "exposure", label: "Exposure" },
    { id: "temperature", label: "Temperature" },
    { id: "gain", label: "Gain" },
    { id: "binning", label: "Binning" },
    { id: "camera", label: "Camera" },
  ],
  flat: [
    { id: "filter", label: "Filter", alwaysRequired: true },
    { id: "rotation", label: "Rotation (optical train angle)" },
    { id: "optical_train", label: "Optical train" },
  ],
  bias: [
    { id: "gain", label: "Gain" },
    { id: "camera", label: "Camera" },
    { id: "temperature", label: "Temperature" },
  ],
  dark_flat: [
    { id: "exposure", label: "Exposure" },
    { id: "gain", label: "Gain" },
    { id: "camera", label: "Camera" },
  ],
};

function CalFrameBox({ frameType, rule }: { frameType: CalFrameType; rule: CalibrationFrameRule }) {
  const fields = CAL_FIELDS[frameType];

  const isFieldChecked = (fieldId: string): boolean => {
    if (fieldId === "rotation") return rule.rotation ?? false;
    if (fieldId === "optical_train") return rule.opticalTrain ?? false;
    return rule.fields.includes(fieldId);
  };

  const handleToggleField = (fieldId: string, checked: boolean) => {
    if (fieldId === "rotation") {
      updateCalibrationRule(frameType, { rotation: checked });
    } else if (fieldId === "optical_train") {
      updateCalibrationRule(frameType, { opticalTrain: checked });
    } else {
      const next = checked
        ? [...rule.fields.filter((f) => f !== fieldId), fieldId]
        : rule.fields.filter((f) => f !== fieldId);
      updateCalibrationRule(frameType, { fields: next });
    }
    appendAuditEvent({
      kind: "settings_changed",
      actor: "user",
      summary: `Calibration rule for ${frameType}: ${fieldId} ${checked ? "required" : "optional"}`,
    });
  };

  return (
    <div className="alm-cal-rules__box">
      <div className="alm-cal-rules__box-header">
        {CAL_FRAME_LABELS[frameType]} matching
      </div>
      <div className="alm-cal-rules__box-body">
        {fields.map((field) => (
          <div key={field.id} className="alm-cal-rules__check-row">
            <input
              type="checkbox"
              id={`cal-rule-${frameType}-${field.id}`}
              checked={field.alwaysRequired || isFieldChecked(field.id)}
              disabled={field.alwaysRequired}
              onChange={(e) => handleToggleField(field.id, e.target.checked)}
              aria-label={`Require ${field.label} for ${CAL_FRAME_LABELS[frameType]} matching`}
            />
            <label
              htmlFor={`cal-rule-${frameType}-${field.id}`}
              style={{
                fontSize: "var(--fs-small)",
                color: field.alwaysRequired ? "var(--text-dim)" : "var(--text)",
                cursor: field.alwaysRequired ? "default" : "pointer",
              }}
            >
              {field.label}
              {field.alwaysRequired ? (
                <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-faint)", marginLeft: 6 }}>
                  always required
                </span>
              ) : null}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalibrationRuleEditor() {
  const s = useSettings();
  const rules = s.calibrationRules;

  return (
    <div className="alm-cal-rules-grid">
      {CAL_FRAME_TYPES.map((ft) => (
        <CalFrameBox
          key={ft}
          frameType={ft}
          rule={rules[ft] ?? { fields: [] }}
        />
      ))}
    </div>
  );
}

/* ======================================================================
   Catalog browser — Settings → Catalogs
   ====================================================================== */

type CatalogSortKey = "name" | "magnitude" | "type" | "constellation";

function CatalogsSection() {
  const navigate = useNavigate();
  const rawSearch = useSearch({ strict: false }) as { q?: string; sort?: string; id?: string };
  const s = useSettings();

  const q = rawSearch.q ?? "";
  const sortRaw = rawSearch.sort ?? "name:asc";
  const [sortKey, sortDir] = (() => {
    const parts = sortRaw.split(":");
    const key = (parts[0] ?? "name") as CatalogSortKey;
    const dir = parts[1] === "desc" ? "desc" : "asc";
    return [key, dir] as const;
  })();

  const selectedId = rawSearch.id ?? null;

  const setSearch = (patch: Partial<typeof rawSearch>) => {
    navigate({ to: "/settings/$section" as never, params: { section: "catalogs" } as never, search: { ...rawSearch, ...patch } } as never);
  };

  const filtered = useMemo(() => {
    const lower = q.toLowerCase();
    const base = lower
      ? CATALOG_OBJECTS.filter(
          (obj) =>
            obj.name.toLowerCase().includes(lower) ||
            obj.aliases.some((a) => a.toLowerCase().includes(lower)) ||
            obj.catalog.toLowerCase().includes(lower) ||
            obj.type.toLowerCase().includes(lower) ||
            obj.constellation.toLowerCase().includes(lower),
        )
      : [...CATALOG_OBJECTS];

    base.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "magnitude") {
        cmp = a.magnitude - b.magnitude;
      } else if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
      } else if (sortKey === "type") {
        cmp = a.type.localeCompare(b.type);
      } else {
        cmp = a.constellation.localeCompare(b.constellation);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return base;
  }, [q, sortKey, sortDir]);

  const favorites = new Set(s.catalogFavorites);

  const selectedObj = selectedId
    ? CATALOG_OBJECTS.find((o) => o.name === selectedId) ?? null
    : null;

  const thProps = (key: CatalogSortKey) => ({
    "aria-sort": (sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none") as "ascending" | "descending" | "none",
    onClick: () => {
      if (sortKey === key) {
        setSearch({ sort: `${key}:${sortDir === "asc" ? "desc" : "asc"}` });
      } else {
        setSearch({ sort: `${key}:asc` });
      }
    },
    style: { cursor: "pointer" as const },
  });

  return (
    <div>
      <h2>Catalogs</h2>
      <div className="alm-settings__pane-desc">
        Browse and search the bundled object catalog. Star objects to use them as project targets.
      </div>

      {/* Status row */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-4)",
          fontSize: "var(--fs-dense)",
          color: "var(--text-dim)",
          marginBottom: "var(--space-3)",
          padding: "var(--space-2) var(--space-3)",
          background: "var(--surface-2)",
          borderRadius: "var(--r-sm)",
        }}
      >
        <span><strong style={{ color: "var(--text)" }}>OpenNGC 2024-08</strong></span>
        <span>{CATALOG_OBJECTS.length} objects (mock subset)</span>
        <span>downloaded 2026-05-21</span>
      </div>

      {/* Search */}
      <div style={{ marginBottom: "var(--space-3)" }}>
        <TextInput
          leadingIcon={<Search size={13} />}
          placeholder="Find by name or alias…"
          value={q}
          onChange={(e) => setSearch({ q: e.target.value || undefined, id: undefined })}
          aria-label="Search catalog"
        />
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-sm)" }}>
        <table className="alm-catalog-table">
          <thead>
            <tr>
              <th style={{ width: 32 }} aria-label="Favorites" />
              <th {...thProps("name")}>Name</th>
              <th>Aliases</th>
              <th>Catalog</th>
              <th {...thProps("type")}>Type</th>
              <th {...thProps("constellation")}>Constellation</th>
              <th {...thProps("magnitude")}>Mag</th>
              <th>RA / Dec</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-faint)", fontSize: "var(--fs-small)" }}
                >
                  No objects match &ldquo;{q}&rdquo;
                </td>
              </tr>
            ) : (
              filtered.map((obj) => (
                <CatalogRow
                  key={obj.name}
                  obj={obj}
                  isFavorite={favorites.has(obj.name)}
                  isSelected={selectedId === obj.name}
                  onSelect={() =>
                    setSearch({ id: selectedId === obj.name ? undefined : obj.name })
                  }
                  onToggleFavorite={(e) => {
                    e.stopPropagation();
                    toggleCatalogFavorite(obj.name);
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Inline detail drawer for selected row */}
      {selectedObj ? (
        <div
          style={{
            marginTop: "var(--space-3)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-sm)",
            padding: "var(--space-4)",
            background: "var(--surface-1)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: "var(--space-3)",
            }}
          >
            <div>
              <div style={{ fontSize: "var(--fs-md)", fontWeight: "var(--fw-semibold)" }}>
                {selectedObj.name}
              </div>
              {selectedObj.aliases.length > 0 ? (
                <div style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)", marginTop: 2 }}>
                  {selectedObj.aliases.join(" · ")}
                </div>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearch({ id: undefined })}
            >
              Close
            </Button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 120px 1fr",
              gap: "var(--space-2) var(--space-4)",
              fontSize: "var(--fs-small)",
            }}
          >
            <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em" }}>CATALOG</span>
            <span>{selectedObj.catalog}</span>
            <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em" }}>TYPE</span>
            <span>{selectedObj.type}</span>
            <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em" }}>CONSTELLATION</span>
            <span>{selectedObj.constellation}</span>
            <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em" }}>MAGNITUDE</span>
            <span>{selectedObj.magnitude}</span>
            <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em" }}>RA</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{selectedObj.ra}</span>
            <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em" }}>DEC</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{selectedObj.dec}</span>
          </div>
          <div style={{ marginTop: "var(--space-3)" }}>
            <Button
              variant="primary"
              onClick={() => {
                appendLog({
                  level: "info",
                  source: "catalogs",
                  message: `[mock] would use ${selectedObj.name} as project target`,
                });
              }}
            >
              Use as project target
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CatalogRow({
  obj,
  isFavorite,
  isSelected,
  onSelect,
  onToggleFavorite,
}: {
  obj: CatalogObject;
  isFavorite: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
}) {
  return (
    <tr
      data-selected={isSelected ? "true" : undefined}
      onClick={onSelect}
      style={{ cursor: "pointer" }}
    >
      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
        <button
          type="button"
          className="alm-catalog-star-btn"
          data-active={isFavorite ? "true" : undefined}
          onClick={onToggleFavorite}
          aria-label={isFavorite ? `Unstar ${obj.name}` : `Star ${obj.name}`}
          aria-pressed={isFavorite}
        >
          <Star size={13} fill={isFavorite ? "currentColor" : "none"} />
        </button>
      </td>
      <td style={{ fontWeight: "var(--fw-medium)" }}>{obj.name}</td>
      <td style={{ color: "var(--text-dim)", fontSize: "var(--fs-dense)" }}>
        {obj.aliases.slice(0, 2).join(", ") || <span style={{ color: "var(--text-faint)" }}>—</span>}
      </td>
      <td style={{ color: "var(--text-dim)" }}>{obj.catalog}</td>
      <td>{obj.type}</td>
      <td style={{ color: "var(--text-dim)" }}>{obj.constellation}</td>
      <td
        style={{
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-dense)",
        }}
      >
        {obj.magnitude.toFixed(1)}
      </td>
      <td
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-dense)",
          color: "var(--text-dim)",
          whiteSpace: "nowrap",
        }}
      >
        {obj.ra} / {obj.dec}
      </td>
    </tr>
  );
}

/* ======================================================================
   Tool workflow profile editor — Settings → Tool Workflows
   ====================================================================== */

interface KnownTool {
  id: string;
  name: string;
  installed: boolean;
  installPath?: string;
  defaultOpenCommand: string;
}

const KNOWN_TOOLS: KnownTool[] = [
  {
    id: "PixInsight",
    name: "PixInsight",
    installed: true,
    installPath: "/Applications/PixInsight/PixInsight.app",
    defaultOpenCommand: "open -b com.pixinsight.PixInsight",
  },
  {
    id: "Siril",
    name: "Siril",
    installed: false,
    defaultOpenCommand: "open -b org.free-astro.siril",
  },
  {
    id: "Planetary Suite",
    name: "Planetary Suite",
    installed: false,
    defaultOpenCommand: "",
  },
  {
    id: "SharpCap",
    name: "SharpCap",
    installed: false,
    defaultOpenCommand: "",
  },
];

function ToolWorkflowsSection() {
  const s = useSettings();
  const [expandedTool, setExpandedTool] = useState<string | null>("PixInsight");

  return (
    <div>
      <h2>Tool Workflows</h2>
      <div className="alm-settings__pane-desc">
        Configure per-tool processing profiles. ALM uses these when generating source views and preparing project folders.
      </div>

      <div className="alm-tool-list">
        {KNOWN_TOOLS.map((tool) => {
          const profile = s.toolProfiles[tool.id];
          const isExpanded = expandedTool === tool.id;
          return (
            <div key={tool.id} className="alm-tool-card">
              <div className="alm-tool-card__header">
                <span className="alm-tool-card__icon">
                  <Wrench size={16} />
                </span>
                <span className="alm-tool-card__name">{tool.name}</span>
                <span className="alm-tool-card__status">
                  {tool.installed
                    ? `Installed · ${profile?.path || tool.installPath}`
                    : "Not installed"}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => setExpandedTool(isExpanded ? null : tool.id)}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? "Close" : "Configure profile…"}
                </Button>
              </div>
              {isExpanded ? (
                <ToolProfileEditor
                  toolId={tool.id}
                  profile={profile}
                  defaultOpenCommand={tool.defaultOpenCommand}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolProfileEditor({
  toolId,
  profile,
  defaultOpenCommand,
}: {
  toolId: string;
  profile: ToolProfile | undefined;
  defaultOpenCommand: string;
}) {
  const s = useSettings();
  const symlinkOk = s.symlinkSupport === "supported" || s.symlinkSupport === null;

  const defaults: ToolProfile = {
    path: "",
    layout: "filter-bucketed",
    // Default is symlink (fix #5)
    sourceMapMode: "symlink",
    openCommand: defaultOpenCommand,
    postPrepare: "reveal",
  };
  const p: ToolProfile = profile ?? defaults;

  const save = (patch: Partial<ToolProfile>) => {
    updateToolProfile(toolId, patch);
    appendAuditEvent({
      kind: "settings_changed",
      actor: "user",
      summary: `Tool profile ${toolId} updated: ${Object.keys(patch).join(", ")}`,
    });
  };

  const symlinkTooltip = "Symlinks are not supported on this system. Enable them in Windows or pick Move or Hardlink.";

  return (
    <div className="alm-tool-card__body">
      <div className="alm-tool-profile-field">
        <label className="alm-tool-profile-field__label" htmlFor={`tool-${toolId}-path`}>
          Path
        </label>
        <TextInput
          id={`tool-${toolId}-path`}
          value={p.path}
          placeholder="/Applications/PixInsight/PixInsight.app"
          onChange={(e) => save({ path: e.target.value })}
          aria-label={`Path for ${toolId}`}
        />
      </div>
      <div className="alm-tool-profile-field">
        <label className="alm-tool-profile-field__label" htmlFor={`tool-${toolId}-layout`}>
          Default project layout
        </label>
        <Select
          value={p.layout}
          onValueChange={(v) => save({ layout: v as ToolProfile["layout"] })}
          options={[
            { value: "flat", label: "Flat" },
            { value: "filter-bucketed", label: "Filter-bucketed" },
            { value: "date-bucketed", label: "Date-bucketed" },
          ]}
          minWidth={180}
          ariaLabel={`Project layout for ${toolId}`}
        />
      </div>
      <div className="alm-tool-profile-field">
        <label className="alm-tool-profile-field__label" htmlFor={`tool-${toolId}-sourcemap`}>
          Source-map mode
        </label>
        <Select
          value={p.sourceMapMode}
          onValueChange={(v) => save({ sourceMapMode: v as ToolProfile["sourceMapMode"] })}
          options={[
            { value: "move", label: "Move" },
            {
              value: "symlink",
              label: symlinkOk ? (
                "Symlink"
              ) : (
                <Tooltip content={symlinkTooltip} side="right">
                  <span style={{ color: "var(--text-faint)" }}>Symlink (unavailable)</span>
                </Tooltip>
              ),
              disabled: !symlinkOk,
            },
            { value: "hardlink", label: "Hardlink" },
          ]}
          minWidth={150}
          ariaLabel={`Source-map mode for ${toolId}`}
        />
      </div>
      <div className="alm-tool-profile-field">
        <label className="alm-tool-profile-field__label" htmlFor={`tool-${toolId}-opencmd`}>
          Open command
          <span
            title="Bundle identifiers are platform-specific. macOS uses 'open -b com.vendor.App'. Windows uses the executable path directly."
            style={{ marginLeft: 4, cursor: "help", color: "var(--text-faint)" }}
          >
            (?)
          </span>
        </label>
        <TextInput
          id={`tool-${toolId}-opencmd`}
          value={p.openCommand}
          placeholder="open -b com.pixinsight.PixInsight"
          onChange={(e) => save({ openCommand: e.target.value })}
          aria-label={`Open command for ${toolId}`}
        />
      </div>
      <div className="alm-tool-profile-field">
        <label className="alm-tool-profile-field__label" htmlFor={`tool-${toolId}-postprepare`}>
          Post-prepare action
        </label>
        <Select
          value={p.postPrepare}
          onValueChange={(v) => save({ postPrepare: v as ToolProfile["postPrepare"] })}
          options={[
            { value: "reveal", label: "Reveal in OS" },
            { value: "launch", label: "Launch tool" },
            { value: "nothing", label: "Nothing" },
          ]}
          minWidth={150}
          ariaLabel={`Post-prepare action for ${toolId}`}
        />
      </div>
    </div>
  );
}

/** In-memory last export timestamp — resets on page refresh (mock only). */
let lastExportTimestamp: string | null = null;

function BackupExportSection() {
  const [lastExport, setLastExport] = useState<string | null>(lastExportTimestamp);

  const [snapIncludes, setSnapIncludes] = useState({
    database: true,
    libraryConfig: true,
    auditLog: true,
    plansHistory: true,
  });

  const handleExport = () => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const ts = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const label = `${dateStr} ${ts}`;
    lastExportTimestamp = label;
    setLastExport(label);
    appendLog({
      level: "info",
      source: "backup",
      message: `[mock] would write ./astro-library-backup-${dateStr}.zip`,
    });
  };

  const handleImport = () => {
    appendLog({
      level: "info",
      source: "backup",
      message: "[mock] import library state — no-op in mockup",
    });
  };

  return (
    <div>
      <h2>Backup &amp; export</h2>
      <div className="alm-settings__pane-desc">
        Export a point-in-time snapshot of your library state for safekeeping
        or migration. Import restores the database and config without touching
        raw image files.
      </div>

      <SectionHeader>Export library state</SectionHeader>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: 8 }}>
        <Button variant="primary" onClick={handleExport}>
          Export to .zip
        </Button>
        <span className="alm-setting-row__hint">
          Last export:{" "}
          <span style={{ color: "var(--text)" }}>{lastExport ?? "Never"}</span>
        </span>
      </div>

      <SectionHeader>Snapshot includes</SectionHeader>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: 4 }}>
        <label className="alm-setting-row__hint" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={snapIncludes.database}
            onChange={(e) => setSnapIncludes((p) => ({ ...p, database: e.target.checked }))}
          />
          Database (SQLite)
        </label>
        <label className="alm-setting-row__hint" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={snapIncludes.libraryConfig}
            onChange={(e) => setSnapIncludes((p) => ({ ...p, libraryConfig: e.target.checked }))}
          />
          Library config
        </label>
        <label className="alm-setting-row__hint" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={snapIncludes.auditLog}
            onChange={(e) => setSnapIncludes((p) => ({ ...p, auditLog: e.target.checked }))}
          />
          Audit log
        </label>
        <label className="alm-setting-row__hint" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={snapIncludes.plansHistory}
            onChange={(e) => setSnapIncludes((p) => ({ ...p, plansHistory: e.target.checked }))}
          />
          Plans history
        </label>
      </div>

      <SectionHeader>Import</SectionHeader>
      <div>
        <Button onClick={handleImport}>Import library state…</Button>
      </div>
    </div>
  );
}
