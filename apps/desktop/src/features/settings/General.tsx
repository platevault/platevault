// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Appearance settings — theme, font size, display density.
// Theme is applied live via the appearance runtime (data/theme.ts): swatch
// cards re-scope the token layer with `data-theme` so each preview shows its
// own palette without any element-level color injection.
import { useState } from 'react';
import { clsx } from 'clsx';
import { usePreference } from '@/data/preferences';
import {
  useThemeChoice,
  resolveTheme,
  THEMES,
  applyDensity,
} from '@/data/theme';
import type { Density } from '@/bindings/types';
import { m } from '@/lib/i18n';

type FontSize = 'small' | 'default' | 'large';

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
  const [fontSize, setFontSize] = useState<FontSize>('default');
  const [density, setDensity] = usePreference('density');
  const resolved = resolveTheme(choice);

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">
          {m.settings_general_theme()}
        </div>
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
      </div>

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
              onChange={(e) => setFontSize(e.target.value as FontSize)}
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
              onChange={(e) => {
                const d = e.target.value as Density;
                setDensity(d);
                applyDensity(d);
              }}
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
