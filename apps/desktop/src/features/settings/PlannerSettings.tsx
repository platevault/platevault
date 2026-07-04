/**
 * PlannerSettings — Settings → Target Planner pane (spec 044).
 *
 * Two sections: observing-site management (US3 — add/edit/delete named
 * sites, pick default/active) and the usable-altitude threshold that drives
 * imaging-time and visible-tonight in the Planner table. Both are persisted
 * through the settings-backed `observing.*` store (`site-store.ts` /
 * `altitude-settings.ts`), so changes are durable across relaunch
 * (SC-005/SC-006) while still applying instantly in the live UI (SC-003).
 *
 * Every value the Planner table/detail pane computes from these settings is
 * real astronomy-engine output (spec 044 US1), not mock data.
 */

import { useState } from 'react';
import { m } from '@/lib/i18n';
import { SettingsSection, SettingsRow } from './SettingsKit';
import {
  useAltitudeThreshold,
  setAltitudeThreshold,
  ALTITUDE_THRESHOLD_MIN,
  ALTITUDE_THRESHOLD_MAX,
} from '@/features/targets/altitude-settings';
import { USABLE_ALT_DEG } from '@/features/targets/planner-altitude';
import { ObservingSites } from '@/features/targets/observing-sites/ObservingSites';

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
    <>
      <ObservingSites />
      <SettingsSection title={m.settings_planner_altitude_title()}>
        <SettingsRow
          label={m.settings_planner_altitude_label()}
          info={m.settings_planner_altitude_info({ deg: USABLE_ALT_DEG })}
        >
          <input
            type="number"
            className="alm-input alm-input--sm alm-settings__num-input"
            value={draft}
            min={ALTITUDE_THRESHOLD_MIN}
            max={ALTITUDE_THRESHOLD_MAX}
            step={1}
            aria-label={m.settings_planner_altitude_aria()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            }}
          />
          <span className="alm-settings__unit-label">{m.settings_planner_altitude_unit()}</span>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
