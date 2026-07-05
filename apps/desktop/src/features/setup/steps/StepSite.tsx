// First-run wizard: "Observing Site" step (spec 044 Track B, US6 T016).
//
// Captures a default+active observing site (name/lat/lon/timezone required,
// elevation optional) so the Targets Planner has real tonight-observability
// data (max-alt, visible-tonight, imaging time) from the very first launch,
// instead of always landing on the no-site prompt (US1/US6). Entirely
// optional — the user can leave every field blank and add a site later from
// Settings -> Target Planner (spec 044 US3, `ObservingSites.tsx`); the step
// never blocks Finish (FR-025 does not require a site to complete setup).

import { m } from '@/lib/i18n';
import { localTimezone, ianaTimezones } from '@/features/targets/observing-sites/iana-timezones';
import type { Twilight } from '@/features/targets/observing-sites/observer-site';

export interface SiteStepState {
  name: string;
  latitudeDegText: string;
  longitudeDegText: string;
  elevationMText: string;
  timezone: string;
}

export const DEFAULT_SITE_STEP_STATE: SiteStepState = {
  name: '',
  latitudeDegText: '',
  longitudeDegText: '',
  elevationMText: '',
  timezone: localTimezone(),
};

/** Default twilight/horizon applied to the site created from this step (changeable later in Settings). */
export const SITE_STEP_DEFAULT_TWILIGHT: Twilight = 'astronomical';
export const SITE_STEP_DEFAULT_MIN_HORIZON_ALT_DEG = 0;

export interface StepSiteProps {
  state: SiteStepState;
  onChange: (state: SiteStepState) => void;
}

/** True when enough fields are filled in to create a site from this step (name/lat/lon; matches T016's "required" fields plus timezone, which always has a value). */
export function siteStepHasSite(state: SiteStepState): boolean {
  return state.name.trim() !== '' && state.latitudeDegText.trim() !== '' && state.longitudeDegText.trim() !== '';
}

/** Validate the (optional) site step; `null` when the step is empty (skipped) or valid. */
export function siteStepError(state: SiteStepState): string | null {
  if (!siteStepHasSite(state)) return null;
  const lat = Number(state.latitudeDegText.trim());
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return m.settings_observing_sites_error_latitude();
  }
  const lon = Number(state.longitudeDegText.trim());
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return m.settings_observing_sites_error_longitude();
  }
  const elevRaw = state.elevationMText.trim();
  if (elevRaw !== '' && !Number.isFinite(Number(elevRaw))) {
    return m.settings_observing_sites_error_elevation();
  }
  return null;
}

/**
 * Step — Observing Site.
 *
 * Same field set as the Settings -> Target Planner site editor
 * (`ObservingSites.tsx`), reused as plain controlled inputs here since the
 * wizard owns its own step-state shape rather than the settings-backed
 * site-store (the site isn't persisted until Finish).
 */
export function StepSite({ state, onChange }: StepSiteProps) {
  const timezones = ianaTimezones();
  const error = siteStepError(state);

  return (
    <div className="alm-step-site">
      <p className="alm-step-site__intro">{m.setup_site_intro()}</p>

      <div className="alm-step-site__grid">
        <div className="alm-stack-1">
          <label className="alm-field-label" htmlFor="setup-site-name">
            {m.settings_observing_sites_field_name()}
          </label>
          <input
            id="setup-site-name"
            type="text"
            className="alm-input"
            aria-label={m.settings_observing_sites_field_name()}
            value={state.name}
            onChange={(e) => onChange({ ...state, name: e.target.value })}
          />
        </div>
        <div className="alm-stack-1">
          <label className="alm-field-label" htmlFor="setup-site-lat">
            {m.settings_observing_sites_field_latitude()}
          </label>
          <input
            id="setup-site-lat"
            type="text"
            inputMode="decimal"
            className="alm-input"
            aria-label={m.settings_observing_sites_field_latitude()}
            value={state.latitudeDegText}
            onChange={(e) => onChange({ ...state, latitudeDegText: e.target.value })}
          />
        </div>
        <div className="alm-stack-1">
          <label className="alm-field-label" htmlFor="setup-site-lon">
            {m.settings_observing_sites_field_longitude()}
          </label>
          <input
            id="setup-site-lon"
            type="text"
            inputMode="decimal"
            className="alm-input"
            aria-label={m.settings_observing_sites_field_longitude()}
            value={state.longitudeDegText}
            onChange={(e) => onChange({ ...state, longitudeDegText: e.target.value })}
          />
        </div>
        <div className="alm-stack-1">
          <label className="alm-field-label" htmlFor="setup-site-elevation">
            {m.settings_observing_sites_field_elevation()}
          </label>
          <input
            id="setup-site-elevation"
            type="text"
            inputMode="decimal"
            className="alm-input"
            aria-label={m.settings_observing_sites_field_elevation()}
            value={state.elevationMText}
            onChange={(e) => onChange({ ...state, elevationMText: e.target.value })}
          />
        </div>
        <div className="alm-stack-1">
          <label className="alm-field-label" htmlFor="setup-site-tz">
            {m.settings_observing_sites_field_timezone()}
          </label>
          <select
            id="setup-site-tz"
            className="alm-select"
            aria-label={m.settings_observing_sites_field_timezone()}
            value={state.timezone}
            onChange={(e) => onChange({ ...state, timezone: e.target.value })}
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <span className="alm-field-error">{error}</span>}

      <p className="alm-step-site__note">{m.setup_site_skip_note()}</p>
    </div>
  );
}
