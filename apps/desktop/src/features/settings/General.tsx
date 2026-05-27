import { useState } from 'react';
import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';
import { usePreference } from '@/data/preferences';
import type { Density } from '@/bindings/types';

type ThemeChoice = 'light' | 'dark' | 'system';
type FontSize = 'small' | 'default' | 'large';

const THEME_OPTIONS: { value: ThemeChoice; label: string; description: string }[] = [
  { value: 'light', label: 'Light', description: 'Light background with dark text' },
  { value: 'dark', label: 'Dark', description: 'Dark background suited for low-light sessions' },
  { value: 'system', label: 'System', description: 'Follow your operating system preference' },
];

const FONT_SIZE_OPTIONS: { value: FontSize; label: string; description: string }[] = [
  { value: 'small', label: 'Small', description: '13px base' },
  { value: 'default', label: 'Default', description: '14px base' },
  { value: 'large', label: 'Large', description: '16px base' },
];

const DENSITY_OPTIONS: { value: Density; label: string; description: string }[] = [
  { value: 'compact', label: 'Compact', description: '24px row height -- fits more rows on screen' },
  { value: 'comfortable', label: 'Comfortable', description: '32px row height -- default' },
  { value: 'spacious', label: 'Spacious', description: '40px row height -- easier to click' },
];

export function General() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [fontSize, setFontSize] = useState<FontSize>('default');
  const [density, setDensity] = usePreference('density');

  return (
    <div className="alm-general">
      {/* Theme */}
      <section className="alm-general__section">
        <h3 className="alm-general__subtitle">Theme</h3>
        <RadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as ThemeChoice)}
          className="alm-general__radio-group"
          aria-label="Theme"
        >
          {THEME_OPTIONS.map((opt) => (
            <label key={opt.value} className="alm-general__radio-option">
              <Radio.Root value={opt.value} className="alm-radio">
                <Radio.Indicator className="alm-radio__indicator" />
              </Radio.Root>
              <span className="alm-general__radio-label">
                <span className="alm-general__radio-text">{opt.label}</span>
                <span className="alm-general__radio-desc">{opt.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </section>

      {/* Font size */}
      <section className="alm-general__section">
        <h3 className="alm-general__subtitle">Font Size</h3>
        <RadioGroup
          value={fontSize}
          onValueChange={(value) => setFontSize(value as FontSize)}
          className="alm-general__radio-group"
          aria-label="Font size"
        >
          {FONT_SIZE_OPTIONS.map((opt) => (
            <label key={opt.value} className="alm-general__radio-option">
              <Radio.Root value={opt.value} className="alm-radio">
                <Radio.Indicator className="alm-radio__indicator" />
              </Radio.Root>
              <span className="alm-general__radio-label">
                <span className="alm-general__radio-text">{opt.label}</span>
                <span className="alm-general__radio-desc">{opt.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </section>

      {/* Density */}
      <section className="alm-general__section">
        <h3 className="alm-general__subtitle">Display Density</h3>
        <RadioGroup
          value={density}
          onValueChange={(value) => setDensity(value as Density)}
          className="alm-general__radio-group"
          aria-label="Display density"
        >
          {DENSITY_OPTIONS.map((opt) => (
            <label key={opt.value} className="alm-general__radio-option">
              <Radio.Root value={opt.value} className="alm-radio">
                <Radio.Indicator className="alm-radio__indicator" />
              </Radio.Root>
              <span className="alm-general__radio-label">
                <span className="alm-general__radio-text">{opt.label}</span>
                <span className="alm-general__radio-desc">{opt.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </section>
    </div>
  );
}
