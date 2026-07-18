// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Appearance settings — theme, font size, display density.
// Theme is applied live via the appearance runtime (data/theme.ts): swatch
// cards re-scope the token layer with `data-theme` so each preview shows its
// own palette without any element-level color injection.
import { clsx } from 'clsx';
import { usePreference } from '@/data/preferences';
import type { DetailDockPageKey } from '@/data/preferences';
import {
  useThemeChoice,
  useFontSizeChoice,
  useZoomChoice,
  resolveTheme,
  THEMES,
  ZOOM_STEPS,
} from '@/data/theme';
import type { FontSizeChoice, ZoomPercent } from '@/data/theme';
import type { Density } from '@/bindings/types';
import { m } from '@/lib/i18n';
import { DetailDockPlacementControl } from '@/components';
import { SettingsSection, RestoreDefaultsBtn } from './SettingsKit';

// The adopting pages, in nav order — Inbox is intentionally excluded from the
// loop (its placement is a forced permanent split, spec 054 FR-014) and gets
// its own explanatory row instead (owner mandate: Auto/Bottom/Right toggle).
const DOCK_PAGES: { page: DetailDockPageKey; label: () => string }[] = [
  { page: 'sessions', label: () => m.common_sessions() },
  {
    page: 'calibration',
    label: () => m.settings_datasources_category_calibration(),
  },
  { page: 'archive', label: () => m.verb_archive() },
  { page: 'projects', label: () => m.common_projects() },
  { page: 'targets', label: () => m.nav_targets() },
];

/** In-code defaults (data/theme.ts + preferences.ts) — none of these are
 *  settings-DB-backed panes, so restore is a local reset, not a backend call
 *  (#802: Appearance was one of 3 default-backed panes missing the shared
 *  RestoreDefaultsBtn control). */
const DEFAULT_DENSITY: Density = 'comfortable';

// `label` is a render-time thunk so it re-reads the active locale (spec 046 #8).
// THEMES carry static brand names (not translatable) — wrap them as thunks so
// every CHOICES entry exposes the same `() => string` label shape.
const CHOICES = [
  {
    id: 'system' as const,
    label: () => m.settings_general_theme_system(),
    mode: 'auto' as const,
  },
  ...THEMES.map((t) => ({ ...t, label: () => t.label })),
];

export function General() {
  const [choice, setChoice] = useThemeChoice();
  const [fontSize, setFontSize] = useFontSizeChoice();
  const [zoom, setZoom] = useZoomChoice();
  const [density, setDensity] = usePreference('density');
  const resolved = resolveTheme(choice);

  const handleRestoreDefaults = async () => {
    setChoice('system');
    setFontSize('default');
    setZoom(100);
    setDensity(DEFAULT_DENSITY);
  };

  return (
    <>
      <SettingsSection
        title={m.settings_general_theme()}
        action={<RestoreDefaultsBtn onRestore={handleRestoreDefaults} />}
      >
        <div className="alm-theme-swatches">
          {CHOICES.map((t) => {
            const isActive = choice === t.id;
            // `system` card mirrors the resolved palette so it isn't a blank tile.
            const previewTheme = t.id === 'system' ? resolved : t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={clsx(
                  'alm-theme-swatch',
                  isActive && 'alm-theme-swatch--active',
                )}
                onClick={() => setChoice(t.id)}
                aria-pressed={isActive}
              >
                <span
                  className="alm-theme-swatch__prev"
                  data-theme={previewTheme}
                >
                  <i className="alm-theme-swatch__bg" />
                  <i className="alm-theme-swatch__surface" />
                  <i className="alm-theme-swatch__accent" />
                </span>
                <span className="alm-theme-swatch__name">{t.label()}</span>
                <span className="alm-theme-swatch__mode">
                  {t.id === 'system'
                    ? resolved.includes('dark')
                      ? m.settings_theme_mode_auto_dark()
                      : m.settings_theme_mode_auto_light()
                    : t.mode === 'dark'
                      ? m.settings_theme_mode_dark()
                      : m.settings_theme_mode_light()}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">
          {m.settings_general_fontsize_title()}
        </div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">
            {m.settings_general_fontsize_title()}
          </div>
          <div className="alm-settings__row-content">
            <select
              className="alm-select"
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value as FontSizeChoice)}
            >
              <option value="small">
                {m.settings_general_fontsize_small()}
              </option>
              <option value="default">
                {m.settings_general_fontsize_default()}
              </option>
              <option value="large">
                {m.settings_general_fontsize_large()}
              </option>
            </select>
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">
          {m.settings_general_zoom_title()}
        </div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">
            {m.settings_general_zoom_label()}
          </div>
          <div className="alm-settings__row-content">
            <select
              className="alm-select"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value) as ZoomPercent)}
            >
              {ZOOM_STEPS.map((step) => (
                <option key={step} value={step}>
                  {step}%
                  {step === 100
                    ? ` (${m.settings_general_zoom_default_suffix()})`
                    : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="alm-calmatch__help">{m.settings_general_zoom_hint()}</p>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">
          {m.settings_general_density_title()}
        </div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">
            {m.settings_general_density_label()}
          </div>
          <div className="alm-settings__row-content">
            <select
              className="alm-select"
              value={density}
              onChange={(e) => setDensity(e.target.value as Density)}
            >
              <option value="compact">
                {m.settings_general_density_compact()}
              </option>
              <option value="comfortable">
                {m.settings_general_density_comfortable()}
              </option>
              <option value="spacious">
                {m.settings_general_density_spacious()}
              </option>
            </select>
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">
          {m.settings_detail_dock_title()}
        </div>
        {DOCK_PAGES.map(({ page, label }) => (
          <div className="alm-settings__row" key={page}>
            <div className="alm-settings__row-label">{label()}</div>
            <div className="alm-settings__row-content">
              <DetailDockPlacementControl page={page} />
            </div>
          </div>
        ))}
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">
            {m.settings_datasources_category_inbox()}
          </div>
          <div className="alm-settings__row-content alm-settings__row-content--muted">
            {m.settings_detail_dock_row_inbox_note()}
          </div>
        </div>
      </div>
    </>
  );
}
