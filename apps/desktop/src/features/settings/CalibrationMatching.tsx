// spec 007 — Calibration Matching settings pane.
//
// Authoritative design: platevault-settings-menu.html § [data-pane="calmatch"]
//
// Owned backend keys (CalibrationTolerances / UpdateCalibrationTolerances),
// persisted to the `calibration_tolerances` singleton table (migration 0008 +
// 0051) via `calibration.tolerances.get`/`update`:
//   - requireSameCamera   (boolean) — Camera "Match required" toggle
//   - requireSameBinning  (boolean) — Binning "Match required" toggle
//   - requireSameGain     (boolean) — Gain "Match required" toggle
//   - requireSameOffset   (boolean) — Offset "Match required" toggle. Also
//     feeds `calibration_core::ranking::MatchingRuleConfig::require_same_offset`
//     (the dark/bias hard-rule the matching engine already enforces).
//   - temperatureToleranceC (number | null) — Sensor temp tolerance in °C
//   - agingLimitDays      (number) — Dark / bias age tolerance in days
import { useState, useEffect, useRef } from 'react';
import { Toggle, Pill } from '@/ui';
import { m } from '@/lib/i18n';
import { SettingsSection, RestoreDefaultsBtn } from './SettingsKit';

import {
  calibrationTolerancesGet,
  calibrationTolerancesUpdate,
} from './settingsIpc';
import type { UpdateCalibrationTolerances } from './settingsIpc';

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
  requireSameOffset: true,
  temperatureToleranceC: 5,
  agingLimitDays: 365,
};

export function CalibrationMatching(_props: CalibrationMatchingProps) {
  // ── Hard-required field toggles ────────────────────────────────────────────
  const [requireCamera, setRequireCamera] = useState(DEFAULTS.requireSameCamera);
  const [requireBinning, setRequireBinning] = useState(DEFAULTS.requireSameBinning);
  const [requireGain, setRequireGain] = useState(DEFAULTS.requireSameGain);
  const [requireOffset, setRequireOffset] = useState(DEFAULTS.requireSameOffset);

  // ── Soft-tolerance inputs ──────────────────────────────────────────────────
  const [tempTolerance, setTempTolerance] = useState<number>(DEFAULTS.temperatureToleranceC);
  const [agingLimit, setAgingLimit] = useState<number>(DEFAULTS.agingLimitDays);

  // Guards against the initial calibrationTolerancesGet() fetch resolving
  // *after* the user has already edited a control — a real race (not just
  // CI timing): on a slower/more contended machine the mount fetch can still
  // be in flight when the user's first click/keystroke fires. Without this,
  // the late setState calls below stomp the user's optimistic edit back to
  // the stale fetched value (same class of bug as the Ingestion pane's
  // startup-fetch race).
  const editedRef = useRef(false);

  // ── Load persisted values from backend on mount ────────────────────────────
  useEffect(() => {
    calibrationTolerancesGet()
      .then((tol) => {
        if (editedRef.current) return;
        setRequireCamera(tol.requireSameCamera);
        setRequireBinning(tol.requireSameBinning);
        setRequireGain(tol.requireSameGain);
        setRequireOffset(tol.requireSameOffset);
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
    editedRef.current = true;
    const req: UpdateCalibrationTolerances = {
      requireSameCamera: requireCamera,
      requireSameBinning: requireBinning,
      requireSameGain: requireGain,
      requireSameOffset: requireOffset,
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
  function handleOffsetToggle(val: boolean) {
    setRequireOffset(val);
    persist({ requireSameOffset: val });
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

  // Restore defaults for THIS pane. Calibration tolerances live in their own
  // `calibrationTolerances` IPC store (not the settings table), so we reset the
  // visible fields to DEFAULTS and persist via that store — not
  // `settings.restore-defaults`, which would touch unrelated settings keys.
  const handleRestoreCalibration = async () => {
    editedRef.current = true;
    setRequireCamera(DEFAULTS.requireSameCamera);
    setRequireBinning(DEFAULTS.requireSameBinning);
    setRequireGain(DEFAULTS.requireSameGain);
    setRequireOffset(DEFAULTS.requireSameOffset);
    setTempTolerance(DEFAULTS.temperatureToleranceC);
    setAgingLimit(DEFAULTS.agingLimitDays);
    await calibrationTolerancesUpdate({
      requireSameCamera: DEFAULTS.requireSameCamera,
      requireSameBinning: DEFAULTS.requireSameBinning,
      requireSameGain: DEFAULTS.requireSameGain,
      requireSameOffset: DEFAULTS.requireSameOffset,
      temperatureToleranceC: DEFAULTS.temperatureToleranceC,
      agingLimitDays: DEFAULTS.agingLimitDays,
      exposureToleranceS: null, // not surfaced in this pane
    });
  };

  return (
    <SettingsSection
      title={m.settings_calmatch_title()}
      action={
        <RestoreDefaultsBtn onRestore={handleRestoreCalibration} />
      }
    >
      <table className="alm-table alm-calmatch__table">
        <thead>
          <tr>
            <th>{m.settings_calmatch_field()}</th>
            <th className="alm-calmatch__col-required">{m.settings_calmatch_required()}</th>
            <th className="alm-calmatch__col-tolerance">{m.settings_calmatch_tolerance()}</th>
          </tr>
        </thead>
        <tbody>
          {/* Camera — hard toggle, persists to requireSameCamera */}
          <tr>
            <td>{m.settings_calmatch_camera()}</td>
            <td>
              <Toggle checked={requireCamera} onChange={handleCameraToggle} />
            </td>
            <td className="mono">{m.settings_calmatch_exact()}</td>
          </tr>

          {/* Binning — hard toggle, persists to requireSameBinning */}
          <tr>
            <td>{m.settings_calmatch_binning()}</td>
            <td>
              <Toggle checked={requireBinning} onChange={handleBinningToggle} />
            </td>
            <td className="mono">{m.settings_calmatch_exact()}</td>
          </tr>

          {/* Gain — hard toggle, persists to requireSameGain */}
          <tr>
            <td>{m.settings_calmatch_gain()}</td>
            <td>
              <Toggle checked={requireGain} onChange={handleGainToggle} />
            </td>
            <td className="mono">{m.settings_calmatch_exact()}</td>
          </tr>

          {/* Offset — hard toggle, persists to requireSameOffset and feeds
              MatchingRuleConfig::require_same_offset in the matching engine */}
          <tr>
            <td>{m.settings_calmatch_offset()}</td>
            <td>
              <Toggle checked={requireOffset} onChange={handleOffsetToggle} />
            </td>
            <td className="mono">{m.settings_calmatch_exact()}</td>
          </tr>

          {/* Sensor temp — soft field: pill label + number input */}
          <tr>
            <td>{m.settings_calmatch_sensor_temp()}</td>
            <td>
              <Pill variant="neutral">{m.settings_calmatch_soft()}</Pill>
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
                  aria-label={m.settings_calmatch_sensor_temp_aria()}
                />
                <span className="alm-calmatch__unit">{m.settings_calmatch_unit_c()}</span>
              </span>
            </td>
          </tr>

          {/* Dark / bias age — warn-level soft field */}
          <tr>
            <td>{m.settings_calmatch_dark_bias_age()}</td>
            <td>
              <Pill variant="warn">{m.settings_calmatch_warn()}</Pill>
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
                  aria-label={m.settings_calmatch_dark_bias_age_aria()}
                />
                <span className="alm-calmatch__unit">{m.settings_calmatch_unit_d()}</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <p className="alm-calmatch__help">
        {m.settings_calmatch_help()}
      </p>
    </SettingsSection>
  );
}
