import { useState } from 'react';
import { usePreference } from '@/data/preferences';
import type { Density } from '@/bindings/types';

type ThemeChoice = 'light' | 'dark' | 'system';
type FontSize = 'small' | 'default' | 'large';

export function General() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [fontSize, setFontSize] = useState<FontSize>('default');
  const [density, setDensity] = usePreference('density');

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Theme</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Theme</div>
          <div className="alm-settings__row-content">
            <select
              className="alm-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeChoice)}
              style={{ height: 28 }}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
            <div className="alm-settings__row-desc">
              {theme === 'light' && 'Light background with dark text'}
              {theme === 'dark' && 'Dark background suited for low-light sessions'}
              {theme === 'system' && 'Follow your operating system preference'}
            </div>
          </div>
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
              style={{ height: 28 }}
            >
              <option value="small">Small (13px)</option>
              <option value="default">Default (14px)</option>
              <option value="large">Large (16px)</option>
            </select>
            <div className="alm-settings__row-desc">
              {fontSize === 'small' && '13 px base'}
              {fontSize === 'default' && '14 px base'}
              {fontSize === 'large' && '16 px base'}
            </div>
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
              onChange={(e) => setDensity(e.target.value as Density)}
              style={{ height: 28 }}
            >
              <option value="compact">Compact (24px row)</option>
              <option value="comfortable">Comfortable (32px row)</option>
              <option value="spacious">Spacious (40px row)</option>
            </select>
            <div className="alm-settings__row-desc">
              {density === 'compact' && '24 px row height — fits more rows on screen'}
              {density === 'comfortable' && '32 px row height — default'}
              {density === 'spacious' && '40 px row height — easier to click'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
