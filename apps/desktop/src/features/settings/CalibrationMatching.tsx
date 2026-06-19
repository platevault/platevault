// spec 007 — Calibration Matching settings pane.
//
// Owned settings keys (calibration scope):
//   - calibration.dark_temp_tolerance (number, °C) — dark temperature soft tolerance
//   - calibration.prefill_suggestion (boolean) — pre-fill assign dialog with top candidate
//   - calibration.dark.override_penalty (number, 0-1)
//   - calibration.flat.override_penalty (number, 0-1)
//   - calibration.bias.override_penalty (number, 0-1)
//   - calibration.aging_threshold_days (number, days) — aging warning threshold (FR-023)
//
// On mount, loads persisted values from backend via settings.get('calibration').
// Changes are auto-saved via the save() prop (useAutoSave → settings.update).
import { useState, useEffect } from 'react';
import { Table, Toggle } from '@/ui';
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
        if (typeof v['calibration.dark_temp_tolerance'] === 'number') {
          setDarkTempTolerance(v['calibration.dark_temp_tolerance']);
        }
        if (typeof v['calibration.prefill_suggestion'] === 'boolean') {
          setPrefillSuggestion(v['calibration.prefill_suggestion']);
        }
        if (typeof v['calibration.dark.override_penalty'] === 'number') {
          setDarkOverridePenalty(v['calibration.dark.override_penalty']);
        }
        if (typeof v['calibration.flat.override_penalty'] === 'number') {
          setFlatOverridePenalty(v['calibration.flat.override_penalty']);
        }
        if (typeof v['calibration.bias.override_penalty'] === 'number') {
          setBiasOverridePenalty(v['calibration.bias.override_penalty']);
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
    save('calibration', { 'calibration.dark_temp_tolerance': n });
  };

  const handlePrefillChange = (val: boolean) => {
    setPrefillSuggestion(val);
    save('calibration', { 'calibration.prefill_suggestion': val });
  };

  const handleOverridePenaltyChange = (
    kind: 'dark' | 'flat' | 'bias',
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const n = parseFloat(e.target.value);
    if (!Number.isFinite(n) || n < 0 || n > 1) return;
    const key = `calibration.${kind}.override_penalty`;
    if (kind === 'dark') setDarkOverridePenalty(n);
    else if (kind === 'flat') setFlatOverridePenalty(n);
    else setBiasOverridePenalty(n);
    save('calibration', { [key]: n });
  };

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Matching Criteria</div>
        <Table
          columns={[
            { key: 'field', label: 'Field' },
            { key: 'required', label: 'Required', style: { width: 90 } },
            { key: 'tolerance', label: 'Tolerance', style: { width: 120 } },
            { key: 'notes', label: 'Notes' },
          ]}
          rows={CALIBRATION_CRITERIA.map((c) => ({
            field: c.field,
            required: c.required
              ? <span style={{ color: 'var(--alm-ok)', fontWeight: 600 }}>Yes</span>
              : <span style={{ color: 'var(--alm-text-muted)' }}>No</span>,
            tolerance: c.tolerance
              ? <code className="alm-mono">{c.tolerance}</code>
              : <span style={{ color: 'var(--alm-text-muted)' }}>—</span>,
            notes: (
              <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                {c.notes}
              </span>
            ),
          }))}
        />
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Dark Matching Tolerances</div>

        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Temperature tolerance (°C)</div>
          <div className="alm-settings__row-content">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}>
              <input
                type="number"
                className="alm-input"
                style={{ width: 80 }}
                value={darkTempTolerance}
                min={0}
                step={0.5}
                onChange={handleDarkTempChange}
              />
              <span style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>°C</span>
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
              className="alm-input"
              style={{ width: 80 }}
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
              className="alm-input"
              style={{ width: 80 }}
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
              className="alm-input"
              style={{ width: 80 }}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}>
              <input
                type="number"
                className="alm-input"
                style={{ width: 80 }}
                value={agingThreshold}
                min={1}
                max={3650}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAgingThreshold(v);
                  save('calibration', { 'calibration.aging_threshold_days': v });
                }}
              />
              <span style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>days</span>
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
