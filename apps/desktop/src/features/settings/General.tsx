import { useState } from 'react';
import { RadioGroup } from '@/ui';
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
          <div className="alm-settings__row-content">
            <RadioGroup
              options={[
                { value: 'light', label: 'Light', desc: 'Light background with dark text' },
                { value: 'dark', label: 'Dark', desc: 'Dark background suited for low-light sessions' },
                { value: 'system', label: 'System', desc: 'Follow your operating system preference' },
              ]}
              value={theme}
              onChange={(v) => setTheme(v as ThemeChoice)}
            />
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Font Size</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-content">
            <RadioGroup
              options={[
                { value: 'small', label: 'Small', desc: '13 px base' },
                { value: 'default', label: 'Default', desc: '14 px base' },
                { value: 'large', label: 'Large', desc: '16 px base' },
              ]}
              value={fontSize}
              onChange={(v) => setFontSize(v as FontSize)}
            />
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Display Density</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-content">
            <RadioGroup
              options={[
                { value: 'compact', label: 'Compact', desc: '24 px row height — fits more rows on screen' },
                { value: 'comfortable', label: 'Comfortable', desc: '32 px row height — default' },
                { value: 'spacious', label: 'Spacious', desc: '40 px row height — easier to click' },
              ]}
              value={density}
              onChange={(v) => setDensity(v as Density)}
            />
          </div>
        </div>
      </div>
    </>
  );
}
