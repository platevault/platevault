import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';
import { usePreference } from '@/data/preferences';
import type { Density } from '@/bindings/types';
import { m } from '@/lib/i18n';

// `label` is a render-time thunk so it re-reads the active locale (spec 046 #8).
const DENSITY_OPTIONS: { value: Density; label: () => string; description: () => string }[] = [
  { value: 'compact', label: () => m.settings_density_compact(), description: () => m.settings_density_compact_desc() },
  { value: 'comfortable', label: () => m.settings_density_comfortable(), description: () => m.settings_density_comfortable_desc() },
  { value: 'spacious', label: () => m.settings_density_spacious(), description: () => m.settings_density_spacious_desc() },
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
          // eslint-disable-next-line jsx-a11y/label-has-associated-control -- wraps a Base UI <Radio.Root> (not a native input the rule recognises); the label text + nested radio form the accessible option
          <label key={opt.value} className="alm-density-selector__option">
            <Radio.Root value={opt.value} className="alm-density-selector__radio">
              <Radio.Indicator className="alm-density-selector__indicator" />
            </Radio.Root>
            <span className="alm-density-selector__label">
              <span className="alm-density-selector__label-text">{opt.label()}</span>
              <span className="alm-density-selector__desc">{opt.description()}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
