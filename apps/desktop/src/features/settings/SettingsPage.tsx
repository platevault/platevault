import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Info } from "lucide-react";

import { Button, Select, Switch, TextInput } from "../../ui";
import { PatternPreview, TokenPatternBuilder } from "../../ui/TokenPattern";
import { availableTokens, settingsSections } from "../../data/mock";
import { updateSettings, useSettings } from "../../data/settings";
import { useTheme } from "../../app/theme";

export function SettingsPage() {
  const params = useParams({ strict: false }) as { section?: string };
  const sectionId = params.section ?? "data-sources";
  const navigate = useNavigate();

  return (
    <div className="alm-settings" style={{ flex: 1, minHeight: 0 }}>
      <aside className="alm-settings__nav" aria-label="Settings sections">
        <div className="alm-settings__nav-section">
          <div className="alm-settings__nav-label">Workflow</div>
          {settingsSections.map((section) => (
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
        <div className="alm-settings__nav-section">
          <div className="alm-settings__nav-label">System</div>
          <button
            type="button"
            className="alm-settings__nav-link"
            style={{ textAlign: "left", width: "100%", cursor: "pointer" }}
            onClick={() => {
              localStorage.removeItem("alm.first-run.completed");
              localStorage.removeItem("alm.first-run.sources");
              navigate({ to: "/welcome" });
            }}
          >
            Restart first-run wizard
          </button>
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
    case "appearance":
      return <AppearanceSection />;
    case "application-log":
      return <ApplicationLogSection />;
    case "source-protection":
      return <SourceProtectionSection />;
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

function SettingRow({
  name,
  hint,
  control,
}: {
  name: React.ReactNode;
  hint?: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div className="alm-setting-row">
      <div className="alm-setting-row__label">
        <span className="alm-setting-row__name">
          {name}
          <Info size={12} style={{ color: "var(--text-faint)" }} />
        </span>
        {hint ? <span className="alm-setting-row__hint">{hint}</span> : null}
      </div>
      <div className="alm-setting-row__control">{control}</div>
    </div>
  );
}

function DataSourcesSection() {
  return (
    <div>
      <h2>Data Sources</h2>
      <div className="alm-settings__pane-desc">
        Registered filesystem locations the app indexes. The app never moves files
        without a reviewed plan.
      </div>

      <div className="alm-fact-group__label" style={{ marginTop: 24 }}>
        Raw sources
      </div>
      <SettingRow
        name="/Volumes/AstroDrive"
        hint="external · 1.4 TB free"
        control={<Button>Reconnect</Button>}
      />
      <SettingRow
        name="/home/sjors/astro/raw"
        hint="local · 240 GB free"
        control={<span className="alm-state" data-tone="success"><span className="alm-state__dot" /> active</span>}
      />
      <div style={{ marginTop: 12 }}>
        <Button>+ Add raw source…</Button>
      </div>

      <div className="alm-fact-group__label" style={{ marginTop: 28 }}>
        Calibration sources
      </div>
      <SettingRow
        name="/Volumes/AstroDrive/calibration"
        hint="external"
        control={<span className="alm-state" data-tone="success"><span className="alm-state__dot" /> active</span>}
      />

      <div className="alm-fact-group__label" style={{ marginTop: 28 }}>
        Project sources
      </div>
      <SettingRow
        name="/home/sjors/astro/projects"
        control={<span className="alm-state" data-tone="success"><span className="alm-state__dot" /> active</span>}
      />

      <div className="alm-fact-group__label" style={{ marginTop: 28 }}>
        Inbox sources
      </div>
      <SettingRow
        name="/Volumes/AstroDrive/inbox"
        hint="watched · 142 items pending"
        control={<span className="alm-state" data-tone="success"><span className="alm-state__dot" /> watching</span>}
      />

      <div className="alm-fact-group__label" style={{ marginTop: 28 }}>
        Scan behavior
      </div>
      <SettingRow
        name="Follow symlinks"
        hint="When off, symlinks and junctions are skipped during scan."
        control={
          <Switch
            checked={useSettings().followSymlinks}
            onCheckedChange={(v) => updateSettings("followSymlinks", v)}
          />
        }
      />
      <SettingRow
        name="Hash files on scan"
        hint="Lazy hashing — only computed when a feature needs it."
        control={
          <Select
            value={useSettings().hashOnScan}
            onValueChange={(v) => updateSettings("hashOnScan", v as "lazy" | "eager" | "off")}
            options={[
              { value: "lazy", label: "Lazy (default)" },
              { value: "eager", label: "Eager" },
              { value: "off", label: "Off" },
            ]}
            minWidth={140}
          />
        }
      />
    </div>
  );
}

function NamingStructureSection() {
  const settings = useSettings();
  const pattern = settings.pattern;

  return (
    <div>
      <h2>Naming & Structure</h2>
      <div className="alm-settings__pane-desc">
        Pattern used when files are confirmed from Inbox to Inventory.
      </div>

      <div className="alm-fact-group__label" style={{ marginTop: 24 }}>
        Library default pattern
      </div>
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

      <div className="alm-fact-group__label">Preview using recent FITS</div>
      <PatternPreview
        rows={[
          { path: "M101/Ha/2026-04-12/lights/", count: 98 },
          { path: "M101/OIII/2026-04-13/lights/", count: 38 },
          { path: "M101/—/2026-04/darks/", count: 30 },
        ]}
      />

      <div style={{ marginTop: 28 }}>
        <SettingRow
          name="Auto-apply pattern on Inbox confirm"
          hint="When on, confirming Inbox items routes them via this pattern."
          control={
            <Switch
              checked={settings.autoApplyPattern}
              onCheckedChange={(v) => updateSettings("autoApplyPattern", v)}
            />
          }
        />
        <SettingRow
          name="Always preview destinations before plan"
          hint="When on, adds an inline preview step before generating the plan."
          control={
            <Switch
              checked={settings.alwaysPreviewBeforePlan}
              onCheckedChange={(v) => updateSettings("alwaysPreviewBeforePlan", v)}
            />
          }
        />
      </div>

      <div className="alm-fact-group__label" style={{ marginTop: 28 }}>
        Per-source overrides
      </div>
      <SettingRow
        name="/Volumes/AstroDrive"
        hint="uses library default"
        control={<Button>Override…</Button>}
      />
      <SettingRow
        name="/home/sjors/astro/raw"
        hint="uses library default"
        control={<Button>Override…</Button>}
      />
      <SettingRow
        name="/scratch/legacy_2019"
        hint={
          <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-dense)" }}>
            {`override: {date}/{frame_type}`}
          </code>
        }
        control={<Button>Edit</Button>}
      />
    </div>
  );
}

function CalibrationSection() {
  const s = useSettings();
  return (
    <div>
      <h2>Calibration</h2>
      <div className="alm-settings__pane-desc">
        Matching rules for darks, flats, and biases.
      </div>
      <SettingRow
        name="Dark matching tolerance"
        hint="How close session metadata must be to reuse a dark library."
        control={
          <Select
            value={s.darkMatchTolerance}
            onValueChange={(v) =>
              updateSettings("darkMatchTolerance", v as "strict" | "loose" | "any")
            }
            options={[
              { value: "strict", label: "Strict (same gain, ±5°C)" },
              { value: "loose", label: "Loose (same gain, ±15°C)" },
              { value: "any", label: "Any matching gain" },
            ]}
            minWidth={220}
          />
        }
      />
      <SettingRow
        name="Flat matching"
        hint="Match by filter and rotation; ignore date."
        control={
          <Select
            value={s.flatMatching}
            onValueChange={(v) =>
              updateSettings("flatMatching", v as "filter-rot" | "filter" | "manual")
            }
            options={[
              { value: "filter-rot", label: "Filter + rotation" },
              { value: "filter", label: "Filter only" },
              { value: "manual", label: "Manual" },
            ]}
            minWidth={180}
          />
        }
      />
      <SettingRow
        name="Suggest matches automatically"
        control={
          <Switch
            checked={s.suggestCalibration}
            onCheckedChange={(v) => updateSettings("suggestCalibration", v)}
          />
        }
      />
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
      <SettingRow
        name="Theme"
        control={
          <Select
            value={mode}
            onValueChange={(v) => setMode(v as "system" | "light" | "dark")}
            options={[
              { value: "system", label: "Follow OS" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            minWidth={140}
          />
        }
      />
      <SettingRow
        name="Row density"
        hint="Affects all ledgers. Dense fits more without scrolling."
        control={
          <Select
            value={s.rowDensity}
            onValueChange={(v) =>
              updateSettings("rowDensity", v as "dense" | "comfortable")
            }
            options={[
              { value: "dense", label: "Dense (default)" },
              { value: "comfortable", label: "Comfortable" },
            ]}
            minWidth={150}
          />
        }
      />
    </div>
  );
}

function ApplicationLogSection() {
  const s = useSettings();
  return (
    <div>
      <h2>Application Log</h2>
      <div className="alm-settings__pane-desc">
        Controls the bottom log fold-out behavior and verbosity.
      </div>
      <SettingRow
        name="Log level"
        control={
          <Select
            value={s.logLevel}
            onValueChange={(v) =>
              updateSettings("logLevel", v as "error" | "warn" | "info" | "debug")
            }
            options={[
              { value: "error", label: "Error" },
              { value: "warn", label: "Warn" },
              { value: "info", label: "Info" },
              { value: "debug", label: "Debug" },
            ]}
            minWidth={140}
          />
        }
      />
      <SettingRow
        name="Remember follow-logs state"
        control={
          <Switch
            checked={s.rememberFollowLogs}
            onCheckedChange={(v) => updateSettings("rememberFollowLogs", v)}
          />
        }
      />
      <SettingRow name="Export logs" control={<Button>Export JSON…</Button>} />
    </div>
  );
}

function SourceProtectionSection() {
  const s = useSettings();
  return (
    <div>
      <h2>Source Protection</h2>
      <div className="alm-settings__pane-desc">
        Per-source rules that gate destructive actions. Defaults apply unless
        a source overrides them.
      </div>
      <SettingRow
        name="Default protection"
        control={
          <Select
            value={s.defaultProtection}
            onValueChange={(v) =>
              updateSettings(
                "defaultProtection",
                v as "protected" | "normal" | "unprotected",
              )
            }
            options={[
              { value: "protected", label: "Protect (warn + plan)" },
              { value: "normal", label: "Normal (plan only)" },
              { value: "unprotected", label: "Unprotected (advanced)" },
            ]}
            minWidth={240}
          />
        }
      />
      <SettingRow
        name="Block permanent delete"
        hint="Cleanup defaults to archive/trash unless explicitly overridden."
        control={
          <Switch
            checked={s.blockPermanentDelete}
            onCheckedChange={(v) => updateSettings("blockPermanentDelete", v)}
          />
        }
      />
      <SettingRow
        name="Protected categories"
        control={
          <TextInput
            value={s.protectedCategories}
            onChange={(e) => updateSettings("protectedCategories", e.target.value)}
          />
        }
      />
    </div>
  );
}
