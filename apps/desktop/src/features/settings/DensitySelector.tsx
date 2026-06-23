import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';
import { usePreference } from '@/data/preferences';
import type { Density } from '@/bindings/types';
import { m } from '@/lib/i18n';

const DENSITY_OPTIONS: { value: Density; label: string; description: string }[] = [
  { value: 'compact', label: m.settings_density_compact(), description: '24px row height — fits more rows on screen' },
  { value: 'comfortable', label: m.settings_density_comfortable(), description: '32px row height — default' },
  { value: 'spacious', label: m.settings_density_spacious(), description: '40px row height — easier to click' },
];

export function DensitySelector() {
  const [density, setDensity] = usePreference('density');

  return (
    <fieldset className="alm-density-selector">
      <legend className="alm-density-selector__legend">{m.settings_density_legend()}</legend>
      <RadioGroup
        value={density}
        onValueChange={(value) => setDensity(value as Density)}
        className="alm-density-selector__group"
        aria-label={m.settings_density_legend()}
      >
        {DENSITY_OPTIONS.map((opt) => (
          <label key={opt.value} className="alm-density-selector__option">
            <Radio.Root value={opt.value} className="alm-density-selector__radio">
              <Radio.Indicator className="alm-density-selector__indicator" />
            </Radio.Root>
            <span className="alm-density-selector__label">
              <span className="alm-density-selector__label-text">{opt.label}</span>
              <span className="alm-density-selector__desc">{opt.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
