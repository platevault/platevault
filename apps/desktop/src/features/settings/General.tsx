// Appearance settings — theme, font size, display density.
// Theme is applied live via the appearance runtime (data/theme.ts): swatch
// cards re-scope the token layer with `data-theme` so each preview shows its
// own palette without any element-level color injection.
import { useState } from 'react';
import { clsx } from 'clsx';
import { usePreference } from '@/data/preferences';
import { useThemeChoice, resolveTheme, THEMES, applyDensity } from '@/data/theme';
import type { Density } from '@/bindings/types';

type FontSize = 'small' | 'default' | 'large';

const CHOICES = [
  { id: 'system' as const, label: 'System', mode: 'auto' as const },
  ...THEMES,
];

export function General() {
  const [choice, setChoice] = useThemeChoice();
  const [fontSize, setFontSize] = useState<FontSize>('default');
  const [density, setDensity] = usePreference('density');
  const resolved = resolveTheme(choice);

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Theme</div>
        <div className="alm-theme-swatches">
          {CHOICES.map((t) => {
            const isActive = choice === t.id;
            // `system` card mirrors the resolved palette so it isn't a blank tile.
            const previewTheme = t.id === 'system' ? resolved : t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={clsx('alm-theme-swatch', isActive && 'alm-theme-swatch--active')}
                onClick={() => setChoice(t.id)}
                aria-pressed={isActive}
              >
                <span className="alm-theme-swatch__prev" data-theme={previewTheme}>
                  <i className="alm-theme-swatch__bg" />
                  <i className="alm-theme-swatch__surface" />
                  <i className="alm-theme-swatch__accent" />
                </span>
                <span className="alm-theme-swatch__name">{t.label}</span>
                <span className="alm-theme-swatch__mode">
                  {t.id === 'system' ? `auto · ${resolved.includes('dark') ? 'dark' : 'light'}` : t.mode}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Font Size</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Font Size</div>
          <div className="alm-settings__row-content">
            <select
              className="alm-select"
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value as FontSize)}
            >
              <option value="small">Small (13px)</option>
              <option value="default">Default (14px)</option>
              <option value="large">Large (16px)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Display Density</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Density</div>
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
              <option value="compact">Compact (24px row)</option>
              <option value="comfortable">Comfortable (32px row)</option>
              <option value="spacious">Spacious (40px row)</option>
            </select>
          </div>
        </div>
      </div>
    </>
  );
}
