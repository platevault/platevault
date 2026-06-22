// First-run wizard: "Configuration" step.
//
// Originally the spec-014 catalog-download step; that backend was removed (spec
// 035 — targets resolve on demand from SIMBAD + a bundled seed + local cache).
// The step slot is retained (first_run_state.last_step CHECK still includes
// 'catalogs' — no migration) and repurposed as a small first-run Configuration
// screen: a few defaults the user can set up front (all changeable later in
// Settings).

import { useEffect, useState, type ReactNode } from 'react';
import { ResolverSettingsControl } from '@/features/settings/ResolverSettingsControl';
import { usePreference } from '@/data/preferences';
import type { Density } from '@/bindings/types';
import { getSettings, updateSettings } from '@/api/commands';

// ── Types ─────────────────────────────────────────────────────────────────────
//
// Kept for compatibility with SetupWizard state persistence and StepConfirm.
// `downloadAll` is an inert legacy flag — nothing is downloaded.

export interface CatalogSettings {
  /** Legacy flag retained for state-shape compatibility; no longer used. */
  downloadAll: boolean;
}

export const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  downloadAll: true,
};

export interface StepCatalogsProps {
  settings: CatalogSettings;
  onSettingsChange: (settings: CatalogSettings) => void;
}

type DefaultProtection = 'protected' | 'normal' | 'unprotected';

// ── Default source protection (spec 018, persisted via the settings backend) ──

function DefaultProtectionControl() {
  const [value, setValue] = useState<DefaultProtection>('protected');

  useEffect(() => {
    let cancelled = false;
    getSettings({ scope: 'cleanup' })
      .then((data) => {
        const vals = data?.values as Record<string, unknown> | undefined;
        const v = vals?.defaultProtection;
        if (!cancelled && typeof v === 'string') setValue(v as DefaultProtection);
      })
      .catch(() => {
        // Backend unavailable — keep the default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = (v: DefaultProtection) => {
    setValue(v);
    void updateSettings({ scope: 'cleanup', values: { defaultProtection: v } }).catch(() => {});
  };

  return (
    <select
      className="alm-select"
      value={value}
      aria-label="Default source protection"
      onChange={(e) => onChange(e.target.value as DefaultProtection)}
    >
      <option value="protected">Protected</option>
      <option value="normal">Normal</option>
      <option value="unprotected">Unprotected</option>
    </select>
  );
}

// ── Display density (frontend preference; applied app-wide) ───────────────────

function DensityControl() {
  const [density, setDensity] = usePreference('density');
  return (
    <select
      className="alm-select"
      value={density}
      aria-label="Display density"
      onChange={(e) => setDensity(e.target.value as Density)}
    >
      <option value="compact">Compact</option>
      <option value="comfortable">Comfortable</option>
      <option value="spacious">Spacious</option>
    </select>
  );
}

// ── A labelled config row: title + control on one line, description below ──────

function ConfigOption({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="alm-setup-catalogs__option">
      <div className="alm-setup-catalogs__option-header">
        <span className="alm-setup-catalogs__option-title">
          {title}
        </span>
        {control}
      </div>
      <div className="alm-settings__row-desc">{description}</div>
    </div>
  );
}

// ── StepCatalogs (Configuration) ──────────────────────────────────────────────

/**
 * Step 3 — Configuration.
 *
 * A few first-run defaults: online SIMBAD resolution, display density, default
 * source protection, and default scan depth. All are changeable later in
 * Settings; the step never blocks Finish.
 */
export function StepCatalogs(_props: StepCatalogsProps) {
  return (
    <div
      className="alm-step-catalogs"
    >
      {/* Online SIMBAD resolution (label + toggle on one line, desc below). */}
      <ResolverSettingsControl compact />

      <ConfigOption
        title="Display density"
        description="How compact the interface is — affects row heights and spacing across the app."
        control={<DensityControl />}
      />

      <ConfigOption
        title="Default source protection"
        description="Protection level applied to newly added source folders. Protected sources are skipped by cleanup plans unless explicitly approved."
        control={<DefaultProtectionControl />}
      />

      <ConfigOption
        title="Appearance / theme"
        description="Choose the app's color theme."
        control={
          <select
            className="alm-select"
            disabled
            aria-label="Theme"
          >
            <option>Light</option>
          </select>
        }
      />
    </div>
  );
}
