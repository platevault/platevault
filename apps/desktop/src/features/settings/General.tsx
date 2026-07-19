// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Appearance settings — theme, font size, display density.
// Theme is applied live via the appearance runtime (data/theme.ts): swatch
// cards re-scope the token layer with `data-theme` so each preview shows its
// own palette without any element-level color injection.
import { clsx } from 'clsx';
import { usePreference } from '@/data/preferences';
import {
  useThemeChoice,
  useFontSizeChoice,
  useZoomChoice,
  resolveTheme,
  THEMES,
  ZOOM_STEPS,
} from '@/data/theme';
import type { FontSizeChoice, ThemeId, ZoomPercent } from '@/data/theme';
import type { Density } from '@/bindings/types';
import { m } from '@/lib/i18n';
import { SettingsSection, RestoreDefaultsBtn } from './SettingsKit';

/** In-code defaults (data/theme.ts + preferences.ts) — none of these are
 *  settings-DB-backed panes, so restore is a local reset, not a backend call
 *  (#802: Appearance was one of 3 default-backed panes missing the shared
 *  RestoreDefaultsBtn control). */
const DEFAULT_DENSITY: Density = 'comfortable';

interface ThemeSwatchChoice {
  id: ThemeId | 'system';
  label: () => string;
  mode: 'light' | 'dark' | 'auto';
}

// `label` is a render-time thunk so it re-reads the active locale (spec 046 #8).
// THEMES carry static brand names (not translatable) — wrap them as thunks so
// every choice exposes the same `() => string` label shape.
const SYSTEM_CHOICE: ThemeSwatchChoice = {
  id: 'system',
  label: () => m.settings_general_theme_system(),
  mode: 'auto',
};

// Picker (handoff 03): only canonical (`enabled`) themes are offered, grouped
// by family (warm/cool) and, within a family, light before dark. Warm
// Clay/Espresso Dark stay in THEMES (registry) so an already-persisted choice
// keeps resolving/applying — they are simply omitted here.
const MODE_ORDER: Record<'light' | 'dark', number> = { light: 0, dark: 1 };
const WARM_CHOICES: ThemeSwatchChoice[] = THEMES.filter(
  (t) => t.enabled && t.family === 'warm',
)
  .sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode])
  .map((t) => ({ id: t.id, label: () => t.label, mode: t.mode }));
const COOL_CHOICES: ThemeSwatchChoice[] = THEMES.filter(
  (t) => t.enabled && t.family === 'cool',
)
  .sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode])
  .map((t) => ({ id: t.id, label: () => t.label, mode: t.mode }));

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

  const renderSwatch = (t: ThemeSwatchChoice) => {
    const isActive = choice === t.id;
    // `system` card mirrors the resolved palette so it isn't a blank tile.
    const previewTheme = t.id === 'system' ? resolved : t.id;
    return (
      <button
        key={t.id}
        type="button"
        className={clsx(
          'pv-theme-swatch',
          isActive && 'pv-theme-swatch--active',
        )}
        onClick={() => setChoice(t.id)}
        aria-pressed={isActive}
      >
        <span className="pv-theme-swatch__prev" data-theme={previewTheme}>
          <i className="pv-theme-swatch__bg" />
          <i className="pv-theme-swatch__surface" />
          <i className="pv-theme-swatch__accent" />
        </span>
        <span className="pv-theme-swatch__name">{t.label()}</span>
        <span className="pv-theme-swatch__mode">
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
  };

  return (
    <>
      <SettingsSection
        title={m.settings_general_theme()}
        action={<RestoreDefaultsBtn onRestore={handleRestoreDefaults} />}
      >
        <div className="pv-theme-swatches">{renderSwatch(SYSTEM_CHOICE)}</div>

        <div className="pv-settings__group-title">
          {m.settings_general_theme_group_warm()}
        </div>
        <div className="pv-theme-swatches">
          {WARM_CHOICES.map(renderSwatch)}
        </div>

        <div className="pv-settings__group-title">
          {m.settings_general_theme_group_cool()}
        </div>
        <div className="pv-theme-swatches">
          {COOL_CHOICES.map(renderSwatch)}
        </div>
      </SettingsSection>

      <div className="pv-settings__group">
        <div className="pv-settings__group-title">
          {m.settings_general_fontsize_title()}
        </div>
        <div className="pv-settings__row">
          <div className="pv-settings__row-label">
            {m.settings_general_fontsize_title()}
          </div>
          <div className="pv-settings__row-content">
            <select
              className="pv-select"
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

      <div className="pv-settings__group">
        <div className="pv-settings__group-title">
          {m.settings_general_zoom_title()}
        </div>
        <div className="pv-settings__row">
          <div className="pv-settings__row-label">
            {m.settings_general_zoom_label()}
          </div>
          <div className="pv-settings__row-content">
            <select
              className="pv-select"
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
        <p className="pv-calmatch__help">{m.settings_general_zoom_hint()}</p>
      </div>

      <div className="pv-settings__group">
        <div className="pv-settings__group-title">
          {m.settings_general_density_title()}
        </div>
        <div className="pv-settings__row">
          <div className="pv-settings__row-label">
            {m.settings_general_density_label()}
          </div>
          <div className="pv-settings__row-content">
            <select
              className="pv-select"
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
    </>
  );
}
