// First-run wizard: "Target resolution" step (spec 035, repurposed).
//
// This step previously downloaded hosted catalog files (spec 014). That backend
// surface has been removed: targets now resolve on demand from SIMBAD, backed by
// a bundled seed of popular catalogues and a growing local cache. The wizard
// step slot is retained (first_run_state.last_step CHECK still includes
// 'catalogs' — no migration), but its content is now the SIMBAD
// online-resolution toggle plus a short explanatory note.

import { ResolverSettingsControl } from '@/features/settings/ResolverSettingsControl';

// ── Types ─────────────────────────────────────────────────────────────────────
//
// Kept for compatibility with SetupWizard state persistence and StepConfirm.
// `downloadAll` is now an inert legacy flag — nothing is downloaded.

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

// ── StepCatalogs (Target resolution) ────────────────────────────────────────

/**
 * Step 3 — Target resolution.
 *
 * Shows the SIMBAD online-resolution toggle (reusing the Settings control) and
 * explains that targets resolve on demand with a bundled seed + local cache.
 * The step never blocks Finish.
 */
export function StepCatalogs(_props: StepCatalogsProps) {
  return (
    <div className="alm-step-catalogs">
      <p className="alm-step-catalogs__intro">
        Astro Library Manager identifies the targets in your files by resolving
        each object name against{' '}
        <strong>SIMBAD</strong> (CDS, Université de Strasbourg). Common objects
        come from a <strong>bundled seed</strong> of popular catalogues and a
        growing <strong>local cache</strong>, so they resolve instantly with no
        network call. Less-common objects are looked up on demand when you are
        online, then cached.
      </p>

      <ResolverSettingsControl compact />

      <div className="alm-step-catalogs__note">
        You can change this any time in Settings → Target Resolution. With online
        resolution off, only the bundled seed and local cache are used; unknown
        objects are marked unresolved and can be retried later.
      </div>
    </div>
  );
}
