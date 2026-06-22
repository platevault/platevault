// spec 007 — Calibration Matching settings pane.
//
// Authoritative design: platevault-settings-menu.html § [data-pane="calmatch"]
//
// Owned backend keys (CalibrationTolerances / UpdateCalibrationTolerances):
//   - requireSameCamera   (boolean) — Camera "Match required" toggle
//   - requireSameBinning  (boolean) — Binning "Match required" toggle
//   - requireSameGain     (boolean) — Gain "Match required" toggle
//   - temperatureToleranceC (number | null) — Sensor temp tolerance in °C
//   - agingLimitDays      (number) — Dark / bias age tolerance in days
//
// STUB: backend CalibrationTolerances has no requireSameOffset field yet.
//   The Offset "Match required" toggle is local state only and does NOT persist
//   to the backend.  Wire it when the backend adds the field.
//   Comment tag: STUB-OFFSET-REQUIRED
import { useState, useEffect } from 'react';
import { Toggle, Pill } from '@/ui';
import { SettingsSection } from './SettingsKit';
import {
  calibrationTolerancesGet,
  calibrationTolerancesUpdate,
} from '@/api/commands';
import type { UpdateCalibrationTolerances } from '@/api/commands';

interface CalibrationMatchingProps {
  /** Unused in this pane — tolerances use their own IPC commands. Kept for
   *  prop-shape consistency with sibling settings panes. */
  save: (scope: string, values: Record<string, unknown>) => void;
}

// Defaults per authoritative mock (platevault-settings-menu.html § calmatch).
const DEFAULTS = {
  requireSameCamera: true,
  requireSameBinning: true,
  requireSameGain: true,
  requireSameOffset: true, // STUB-OFFSET-REQUIRED: local only
  temperatureToleranceC: 5,
  agingLimitDays: 365,
};

export function CalibrationMatching(_props: CalibrationMatchingProps) {
  // ── Hard-required field toggles ────────────────────────────────────────────
  const [requireCamera, setRequireCamera] = useState(DEFAULTS.requireSameCamera);
  const [requireBinning, setRequireBinning] = useState(DEFAULTS.requireSameBinning);
  const [requireGain, setRequireGain] = useState(DEFAULTS.requireSameGain);
  // STUB-OFFSET-REQUIRED: no backend field — persists locally only
  const [requireOffset, setRequireOffset] = useState(DEFAULTS.requireSameOffset);

  // ── Soft-tolerance inputs ──────────────────────────────────────────────────
  const [tempTolerance, setTempTolerance] = useState<number>(DEFAULTS.temperatureToleranceC);
  const [agingLimit, setAgingLimit] = useState<number>(DEFAULTS.agingLimitDays);

  // ── Load persisted values from backend on mount ────────────────────────────
  useEffect(() => {
    calibrationTolerancesGet()
      .then((tol) => {
        setRequireCamera(tol.requireSameCamera);
        setRequireBinning(tol.requireSameBinning);
        setRequireGain(tol.requireSameGain);
        if (tol.temperatureToleranceC !== null) {
          setTempTolerance(tol.temperatureToleranceC);
        }
        setAgingLimit(tol.agingLimitDays);
      })
      .catch(() => {
        // Backend unavailable in mock / dev mode — stay with in-code defaults.
      });
  }, []);

  // ── Persist a partial update; callers pass only the changed field ──────────
  function persist(patch: Partial<UpdateCalibrationTolerances>) {
    const req: UpdateCalibrationTolerances = {
      requireSameCamera: requireCamera,
      requireSameBinning: requireBinning,
      requireSameGain: requireGain,
      temperatureToleranceC: tempTolerance,
      agingLimitDays: agingLimit,
      exposureToleranceS: null, // not surfaced in this pane
      ...patch,
    };
    calibrationTolerancesUpdate(req).catch(() => {
      // Best-effort persist; UI already reflects the change.
    });
  }

  // ── Toggle handlers ────────────────────────────────────────────────────────
  function handleCameraToggle(val: boolean) {
    setRequireCamera(val);
    persist({ requireSameCamera: val });
  }
  function handleBinningToggle(val: boolean) {
    setRequireBinning(val);
    persist({ requireSameBinning: val });
  }
  function handleGainToggle(val: boolean) {
    setRequireGain(val);
    persist({ requireSameGain: val });
  }
  // STUB-OFFSET-REQUIRED: local only — no persist call
  function handleOffsetToggle(val: boolean) {
    setRequireOffset(val);
  }

  // ── Tolerance input handlers ───────────────────────────────────────────────
  function handleTempChange(e: React.ChangeEvent<HTMLInputElement>) {
    const n = parseFloat(e.target.value);
    if (!Number.isFinite(n) || n < 0) return;
    setTempTolerance(n);
    persist({ temperatureToleranceC: n });
  }
  function handleAgingChange(e: React.ChangeEvent<HTMLInputElement>) {
    const n = parseInt(e.target.value, 10);
    if (!Number.isFinite(n) || n < 1) return;
    setAgingLimit(n);
    persist({ agingLimitDays: n });
  }

  return (
    <SettingsSection title="Matching criteria">
      <table className="alm-table alm-calmatch__table">
        <thead>
          <tr>
            <th>Field</th>
            <th className="alm-calmatch__col-required">Match required</th>
            <th className="alm-calmatch__col-tolerance">Tolerance</th>
          </tr>
        </thead>
        <tbody>
          {/* Camera — hard toggle, persists to requireSameCamera */}
          <tr>
            <td>Camera</td>
            <td>
              <Toggle checked={requireCamera} onChange={handleCameraToggle} />
            </td>
            <td className="mono">exact</td>
          </tr>

          {/* Binning — hard toggle, persists to requireSameBinning */}
          <tr>
            <td>Binning</td>
            <td>
              <Toggle checked={requireBinning} onChange={handleBinningToggle} />
            </td>
            <td className="mono">exact</td>
          </tr>

          {/* Gain — hard toggle, persists to requireSameGain */}
          <tr>
            <td>Gain</td>
            <td>
              <Toggle checked={requireGain} onChange={handleGainToggle} />
            </td>
            <td className="mono">exact</td>
          </tr>

          {/* Offset — STUB-OFFSET-REQUIRED: local state only, no backend key */}
          <tr>
            <td>Offset</td>
            <td>
              {/* STUB: backend MatchingRuleConfig per-field required flags pending
                  (requireSameOffset) — persists locally only */}
              <Toggle checked={requireOffset} onChange={handleOffsetToggle} />
            </td>
            <td className="mono">exact</td>
          </tr>

          {/* Sensor temp — soft field: pill label + number input */}
          <tr>
            <td>Sensor temp</td>
            <td>
              <Pill variant="neutral">soft</Pill>
            </td>
            <td>
              <span className="alm-calmatch__tol-input-row">
                <input
                  type="number"
                  className="alm-input alm-calmatch__num-input"
                  value={tempTolerance}
                  min={0}
                  step={0.5}
                  onChange={handleTempChange}
                  aria-label="Sensor temperature tolerance in degrees Celsius"
                />
                <span className="alm-calmatch__unit">°C</span>
              </span>
            </td>
          </tr>

          {/* Dark / bias age — warn-level soft field */}
          <tr>
            <td>Dark / bias age</td>
            <td>
              <Pill variant="warn">warn</Pill>
            </td>
            <td>
              <span className="alm-calmatch__tol-input-row">
                <input
                  type="number"
                  className="alm-input alm-calmatch__num-input"
                  value={agingLimit}
                  min={1}
                  max={3650}
                  onChange={handleAgingChange}
                  aria-label="Dark and bias age limit in days"
                />
                <span className="alm-calmatch__unit">d</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <p className="alm-calmatch__help">
        Toggle a field off to exclude it from matching (e.g. ignore gain).
        Soft/warn fields never block a match — they only lower confidence.
      </p>
    </SettingsSection>
  );
}
