import { useState } from 'react';
import { Switch } from '@base-ui-components/react/switch';

interface CalibrationMatchingProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

export function CalibrationMatching({ save }: CalibrationMatchingProps) {
  const [tempTolerance, setTempTolerance] = useState('5');
  const [exposureTolerance, setExposureTolerance] = useState('2');
  const [agingLimit, setAgingLimit] = useState('365');
  const [requireSameCamera, setRequireSameCamera] = useState(true);
  const [requireSameGain, setRequireSameGain] = useState(true);
  const [requireSameBinning, setRequireSameBinning] = useState(true);

  const persistAll = () => {
    save('calibration_matching', {
      temperature_tolerance_c: Number(tempTolerance),
      exposure_tolerance_s: Number(exposureTolerance),
      aging_limit_days: Number(agingLimit),
      require_same_camera: requireSameCamera,
      require_same_gain: requireSameGain,
      require_same_binning: requireSameBinning,
    });
  };

  const handleToggle = (
    setter: React.Dispatch<React.SetStateAction<boolean>>,
    current: boolean,
  ) => {
    setter(!current);
    setTimeout(persistAll, 0);
  };

  return (
    <div className="alm-cal-matching">
      {/* Tolerances */}
      <section className="alm-cal-matching__section">
        <h3 className="alm-cal-matching__subtitle">Tolerances</h3>
        <p className="alm-cal-matching__hint">
          When matching calibration frames to light frames, these tolerances
          control how close the metadata values must be.
        </p>

        <div className="alm-cal-matching__field">
          <label className="alm-cal-matching__field-label" htmlFor="cal-temp-tol">
            Temperature tolerance
          </label>
          <div className="alm-cal-matching__field-input">
            <input
              id="cal-temp-tol"
              type="number"
              className="alm-input alm-input--sm"
              value={tempTolerance}
              min={0}
              max={30}
              onChange={(e) => {
                setTempTolerance(e.target.value);
                persistAll();
              }}
            />
            <span className="alm-cal-matching__field-unit">&deg;C</span>
          </div>
        </div>

        <div className="alm-cal-matching__field">
          <label className="alm-cal-matching__field-label" htmlFor="cal-exp-tol">
            Exposure tolerance
          </label>
          <div className="alm-cal-matching__field-input">
            <input
              id="cal-exp-tol"
              type="number"
              className="alm-input alm-input--sm"
              value={exposureTolerance}
              min={0}
              max={60}
              onChange={(e) => {
                setExposureTolerance(e.target.value);
                persistAll();
              }}
            />
            <span className="alm-cal-matching__field-unit">seconds</span>
          </div>
        </div>

        <div className="alm-cal-matching__field">
          <label className="alm-cal-matching__field-label" htmlFor="cal-aging">
            Maximum calibration age
          </label>
          <div className="alm-cal-matching__field-input">
            <input
              id="cal-aging"
              type="number"
              className="alm-input alm-input--sm"
              value={agingLimit}
              min={1}
              max={3650}
              onChange={(e) => {
                setAgingLimit(e.target.value);
                persistAll();
              }}
            />
            <span className="alm-cal-matching__field-unit">days</span>
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section className="alm-cal-matching__section">
        <h3 className="alm-cal-matching__subtitle">Requirements</h3>
        <p className="alm-cal-matching__hint">
          These toggles enforce strict matching on specific metadata fields.
        </p>

        <div className="alm-cal-matching__toggle-row">
          <label className="alm-cal-matching__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={requireSameCamera}
              onCheckedChange={() => handleToggle(setRequireSameCamera, requireSameCamera)}
              aria-label="Require same camera"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>Require same camera</span>
          </label>
        </div>

        <div className="alm-cal-matching__toggle-row">
          <label className="alm-cal-matching__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={requireSameGain}
              onCheckedChange={() => handleToggle(setRequireSameGain, requireSameGain)}
              aria-label="Require same gain"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>Require same gain / ISO</span>
          </label>
        </div>

        <div className="alm-cal-matching__toggle-row">
          <label className="alm-cal-matching__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={requireSameBinning}
              onCheckedChange={() => handleToggle(setRequireSameBinning, requireSameBinning)}
              aria-label="Require same binning"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>Require same binning</span>
          </label>
        </div>
      </section>
    </div>
  );
}
