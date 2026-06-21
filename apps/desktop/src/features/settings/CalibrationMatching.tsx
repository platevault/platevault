// spec 007 — Calibration Matching settings pane.
//
// Owned settings keys (calibration scope):
//   - calibrationDarkTempTolerance (number, °C) — dark temperature soft tolerance
//   - calibrationPrefillSuggestion (boolean) — pre-fill assign dialog with top candidate
//   - calibrationDarkOverridePenalty (number, 0-1)
//   - calibrationFlatOverridePenalty (number, 0-1)
//   - calibrationBiasOverridePenalty (number, 0-1)
//   - calibrationAgingThresholdDays (number, days) — aging warning threshold (FR-023)
//
// On mount, loads persisted values from backend via settings.get('calibration').
// Changes are auto-saved via the save() prop (useAutoSave → settings.update).
import { useState, useEffect } from 'react';
import { Table, Toggle, Pill } from '@/ui';
import { CALIBRATION_CRITERIA } from '@/data/fixtures/settings';
import { getSettings } from '@/api/commands';

interface CalibrationMatchingProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

// Default values matching MatchingRuleConfig::default() on the Rust side.
const DEFAULTS = {
  darkTempTolerance: 2.0,
  prefillSuggestion: true,
  darkOverridePenalty: 0.3,
  flatOverridePenalty: 0.3,
  biasOverridePenalty: 0.3,
  agingThreshold: 90,
};

export function CalibrationMatching({ save }: CalibrationMatchingProps) {
  const [darkTempTolerance, setDarkTempTolerance] = useState(DEFAULTS.darkTempTolerance);
  const [prefillSuggestion, setPrefillSuggestion] = useState(DEFAULTS.prefillSuggestion);
  const [darkOverridePenalty, setDarkOverridePenalty] = useState(DEFAULTS.darkOverridePenalty);
  const [flatOverridePenalty, setFlatOverridePenalty] = useState(DEFAULTS.flatOverridePenalty);
  const [biasOverridePenalty, setBiasOverridePenalty] = useState(DEFAULTS.biasOverridePenalty);
  const [agingThreshold, setAgingThreshold] = useState(DEFAULTS.agingThreshold);

  // Load persisted values from backend on mount (spec 007 T031).
  useEffect(() => {
    getSettings({ scope: 'calibration' })
      .then((data) => {
        const v = data.values as Record<string, unknown>;
        if (typeof v['calibrationDarkTempTolerance'] === 'number') {
          setDarkTempTolerance(v['calibrationDarkTempTolerance']);
        }
        if (typeof v['calibrationPrefillSuggestion'] === 'boolean') {
          setPrefillSuggestion(v['calibrationPrefillSuggestion']);
        }
        if (typeof v['calibrationDarkOverridePenalty'] === 'number') {
          setDarkOverridePenalty(v['calibrationDarkOverridePenalty']);
        }
        if (typeof v['calibrationFlatOverridePenalty'] === 'number') {
          setFlatOverridePenalty(v['calibrationFlatOverridePenalty']);
        }
        if (typeof v['calibrationBiasOverridePenalty'] === 'number') {
          setBiasOverridePenalty(v['calibrationBiasOverridePenalty']);
        }
      })
      .catch(() => {
        // Backend unavailable — stay with in-code defaults.
      });
  }, []);

  const handleDarkTempChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = parseFloat(e.target.value);
    if (!Number.isFinite(n) || n < 0) return;
    setDarkTempTolerance(n);
    save('calibration', { calibrationDarkTempTolerance: n });
  };

  const handlePrefillChange = (val: boolean) => {
    setPrefillSuggestion(val);
    save('calibration', { calibrationPrefillSuggestion: val });
  };

  const handleOverridePenaltyChange = (
    kind: 'dark' | 'flat' | 'bias',
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const n = parseFloat(e.target.value);
    if (!Number.isFinite(n) || n < 0 || n > 1) return;
    const keyMap = {
      dark: 'calibrationDarkOverridePenalty',
      flat: 'calibrationFlatOverridePenalty',
      bias: 'calibrationBiasOverridePenalty',
    } as const;
    if (kind === 'dark') setDarkOverridePenalty(n);
    else if (kind === 'flat') setFlatOverridePenalty(n);
    else setBiasOverridePenalty(n);
    save('calibration', { [keyMap[kind]]: n });
  };

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Matching Criteria</div>
        <Table
          columns={[
            { key: 'field', label: 'Field' },
            { key: 'required', label: 'Match required', style: { width: 120 } },
            { key: 'tolerance', label: 'Tolerance', style: { width: 120 } },
          ]}
          rows={CALIBRATION_CRITERIA.map((c) => ({
            field: c.field,
            required: <Pill variant="neutral">{c.required ? 'required' : 'optional'}</Pill>,
            tolerance: <code className="alm-mono">{c.tolerance || 'exact'}</code>,
          }))}
        />
        <p className="alm-settings__group-note">
          Camera, binning, and gain must match exactly. Temperature and age are soft
          tolerances that lower match confidence rather than block a match.
        </p>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Dark Matching Tolerances</div>

        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Temperature tolerance (°C)</div>
          <div className="alm-settings__row-content">
            <div className="alm-calib-matching__input-row">
              <input
                type="number"
                className="alm-input alm-calib-matching__num-input"
                value={darkTempTolerance}
                min={0}
                step={0.5}
                onChange={handleDarkTempChange}
              />
              <span className="alm-calib-matching__unit-label">°C</span>
            </div>
          </div>
          <div className="alm-settings__row-desc">
            Darks within this temperature delta are treated as soft matches; beyond it reduces confidence.
          </div>
        </div>

        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Override penalty</div>
          <div className="alm-settings__row-content">
            <input
              type="number"
              className="alm-input alm-calib-matching__num-input"
              value={darkOverridePenalty}
              min={0}
              max={1}
              step={0.05}
              onChange={(e) => handleOverridePenaltyChange('dark', e)}
            />
          </div>
          <div className="alm-settings__row-desc">
            Confidence penalty (0–1) applied when a dark is assigned with override=true.
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Flat Matching Tolerances</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Override penalty</div>
          <div className="alm-settings__row-content">
            <input
              type="number"
              className="alm-input alm-calib-matching__num-input"
              value={flatOverridePenalty}
              min={0}
              max={1}
              step={0.05}
              onChange={(e) => handleOverridePenaltyChange('flat', e)}
            />
          </div>
          <div className="alm-settings__row-desc">
            Confidence penalty applied when a flat is assigned with override=true.
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Bias Matching Tolerances</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Override penalty</div>
          <div className="alm-settings__row-content">
            <input
              type="number"
              className="alm-input alm-calib-matching__num-input"
              value={biasOverridePenalty}
              min={0}
              max={1}
              step={0.05}
              onChange={(e) => handleOverridePenaltyChange('bias', e)}
            />
          </div>
          <div className="alm-settings__row-desc">
            Confidence penalty applied when a bias is assigned with override=true.
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Assignment Behaviour</div>
        <div className="alm-settings__row">
          <Toggle checked={prefillSuggestion} onChange={handlePrefillChange}>
            Pre-fill assign dialog with top candidate
          </Toggle>
          <div className="alm-settings__row-desc">
            When enabled, the assign dialog opens pre-filled with the top-ranked suggestion.
            Confirmation is always required before the assignment is recorded (R-Prefill).
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Aging Threshold</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Default maximum calibration age</div>
          <div className="alm-settings__row-content">
            <div className="alm-calib-matching__input-row">
              <input
                type="number"
                className="alm-input alm-calib-matching__num-input"
                value={agingThreshold}
                min={1}
                max={3650}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAgingThreshold(v);
                  save('calibration', { calibrationAgingThresholdDays: v });
                }}
              />
              <span className="alm-calib-matching__unit-label">days</span>
            </div>
          </div>
          <div className="alm-settings__row-desc">
            Calibration frames older than this threshold generate a warning when matched against light frames.
          </div>
        </div>
      </div>
    </>
  );
}
