/**
 * PlannerSettings — Settings → Target Planner pane (spec 044).
 *
 * Currently contains one control: the usable-altitude threshold that drives
 * imaging-time and visible-tonight in the Planner table. The value is persisted
 * in localStorage via `altitude-settings.ts` so changes take effect immediately
 * without a backend round-trip.
 *
 * All values in the Planner table that depend on this threshold are MOCK
 * (spec 044 §3, NOT astronomy). The threshold itself is real user preference
 * that will be threaded into the real ephemeris computation when #57/#58 land.
 */

import { useState } from 'react';
import { SettingsSection, SettingsRow } from './SettingsKit';
import {
  useAltitudeThreshold,
  setAltitudeThreshold,
  ALTITUDE_THRESHOLD_MIN,
  ALTITUDE_THRESHOLD_MAX,
} from '@/features/targets/altitude-settings';
import { USABLE_ALT_DEG } from '@/features/targets/planner-altitude';

export function PlannerSettings() {
  const stored = useAltitudeThreshold();
  // Local draft so the input feels immediate; we commit to localStorage on
  // blur or Enter rather than on every keystroke.
  const [draft, setDraft] = useState<string>(String(stored));

  function commit(raw: string) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      setAltitudeThreshold(n);
      // Reflect the clamped value back into the draft so the field self-corrects.
      setDraft(String(Math.max(ALTITUDE_THRESHOLD_MIN, Math.min(ALTITUDE_THRESHOLD_MAX, Math.round(n)))));
    } else {
      // Non-numeric input: revert to the currently stored value.
      setDraft(String(stored));
    }
  }

  return (
    <SettingsSection title="ALTITUDE THRESHOLD">
      <SettingsRow
        label="Usable altitude threshold (°)"
        info={
          `Minimum elevation above the horizon (in degrees) considered acceptable ` +
          `for imaging. Drives the "Visible tonight" and "Imaging time" columns in ` +
          `the Planner table. Default: ${USABLE_ALT_DEG}°.`
        }
      >
        <input
          type="number"
          className="alm-input alm-input--sm alm-settings__num-input"
          value={draft}
          min={ALTITUDE_THRESHOLD_MIN}
          max={ALTITUDE_THRESHOLD_MAX}
          step={1}
          aria-label="Usable altitude threshold in degrees"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          }}
        />
        <span className="alm-settings__unit-label">degrees above horizon</span>
      </SettingsRow>
    </SettingsSection>
  );
}
