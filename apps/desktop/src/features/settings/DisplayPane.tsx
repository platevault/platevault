import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';
import { usePreference, setPreference } from '@/data/preferences';
import type { Density } from '@/api/types';
import { Btn } from '@/ui';

const DENSITY_OPTIONS: { value: Density; label: string; description: string }[] = [
  { value: 'compact', label: 'Compact', description: '24px row height — fits more rows on screen' },
  { value: 'comfortable', label: 'Comfortable', description: '32px row height — default' },
  { value: 'spacious', label: 'Spacious', description: '40px row height — easier to click' },
];

export function DisplayPane() {
  const [density, setDensity] = usePreference('density');
  const [tourCompleted] = usePreference('tourCompleted');

  const allStepsComplete = tourCompleted.step1 && tourCompleted.step2 && tourCompleted.step3;

  const handleRestartTour = () => {
    setPreference('tourCompleted', { step1: false, step2: false, step3: false });
  };

  return (
    <div className="alm-display-pane">
      <fieldset className="alm-density-selector">
        <legend className="alm-density-selector__legend">Display density</legend>
        <RadioGroup
          value={density}
          onValueChange={(value) => setDensity(value as Density)}
          className="alm-density-selector__group"
          aria-label="Display density"
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

      <div className="alm-display-pane__section">
        <div className="alm-logs__field">
          <span className="alm-logs__label">Guided tour</span>
          <Btn
            size="sm"
            variant="ghost"
            onClick={handleRestartTour}
            disabled={!allStepsComplete}
          >
            Restart guided tour
          </Btn>
        </div>
        {!allStepsComplete && (
          <p className="alm-equipment__empty">
            Tour is already in progress or has not been started.
          </p>
        )}
      </div>
    </div>
  );
}
