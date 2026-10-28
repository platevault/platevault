// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// spec 018 — owned scope: logLevel (rendered below), rememberFollowLogs
// (surfaced via the log panel's follow-tail toggle, app/LogPanelContext.tsx —
// not duplicated here) and devMode (deliberately hidden per spec 021 T032,
// reachable only at /dev/settings; NOT a UI gap, see app/router.tsx). #624
// audited this pane's key list; both are covered elsewhere by design.
// On mount, loads persisted values from backend via settings.get('advanced').
// Changes are auto-saved via the save() prop (useAutoSave -> settings.update).
// spec 003 US3 — first-run setup wizard restart control added (regression fix:
// firstrun.restart was fully wired on the backend but had no UI caller).
import { useState, useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Btn, Toggle } from '@/ui';
import { parseSettingsValues, restartFirstRun } from './settingsIpc';
import { settingsQueryOptions } from './settingsQueries';
import { AdvancedSettingsSchema, type LOG_LEVELS } from './settingsSchemas';
import { m } from '@/lib/i18n';
import { errMessage } from '@/lib/errors';
import {
  setPreference,
  resetPreferences,
  usePreference,
} from '@/data/preferences';
import {
  resetWizardStateWithSources,
  type SourceEntry,
} from '@/features/setup/sources-store';
import { requestOrientationReplay } from '@/features/onboarding/store';
import { restoreOnboarding } from '@/features/onboarding/store';
import {
  SettingsSection,
  SettingsRow,
  RestoreDefaultsBtn,
} from './SettingsKit';
import {
  getUpdateSnapshot,
  subscribeUpdate,
  getRunningVersion,
} from '@/data/updateSubscription';
import {
  UpdateActions,
  updateStatusMessage,
} from '@/features/update/UpdateControls';
import { selectBase } from '@/styles/select.css';
import { controlCol, controlRow } from './advanced.css';

const ADVANCED_KEYS = ['logLevel', 'rememberFollowLogs', 'devMode'];

interface AdvancedProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type LogLevel = (typeof LOG_LEVELS)[number];

const RESET_FEEDBACK_MS = 3000;

/**
 * Renders advanced settings, including log-level configuration, onboarding controls, update actions, and preference reset controls.
 *
 * @param save - Persists updated advanced settings
 */
export function Advanced({ save }: AdvancedProps) {
  const navigate = useNavigate();
  const [logLevel, setLogLevel] = useState<LogLevel>('info');
  const [firstRunConfirming, setFirstRunConfirming] = useState(false);
  const [firstRunRestarting, setFirstRunRestarting] = useState(false);
  const [firstRunError, setFirstRunError] = useState<string | null>(null);
  const updateState = useSyncExternalStore(subscribeUpdate, getUpdateSnapshot);
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [checkUpdatesAutomatically, setCheckUpdatesAutomatically] =
    usePreference('checkUpdatesAutomatically');
  const [includeReleaseCandidates, setIncludeReleaseCandidates] = usePreference(
    'includeReleaseCandidates',
  );
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // Callback used by RestoreDefaultsBtn.onRestored to re-apply values after a
  // restore action (uses the same schema as the mount-time load).
  const applyValues = (vals: Record<string, unknown>) => {
    const result = AdvancedSettingsSchema.safeParse(vals);
    if (result.success && result.data.logLevel) {
      setLogLevel(result.data.logLevel);
    }
  };

  // A read failure leaves the in-code default in place; this pane surfaces no
  // error for it, so `error` is deliberately unused.
  const { data } = useQuery(settingsQueryOptions('advanced'));

  useEffect(() => {
    if (data === undefined) return;
    const vals = parseSettingsValues(data.values, AdvancedSettingsSchema);
    if (vals.logLevel) setLogLevel(vals.logLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Running app semver, independent of update state (#845).
  useEffect(() => {
    let cancelled = false;
    void getRunningVersion().then((version) => {
      if (!cancelled) setRunningVersion(version);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restart the first-run *source setup* wizard (spec 003 US3). Requires an
  // explicit confirm step because it reopens the whole source-registration flow.
  const handleFirstRunRestart = async () => {
    setFirstRunRestarting(true);
    setFirstRunError(null);
    try {
      const response = await restartFirstRun();
      // Prefill the wizard's working buffer with the currently registered
      // sources (A7). `scanDepth` was retired from `SourceEntry` (#913) — this
      // literal used to carry a dead `scanDepth: 'recursive'` field the type
      // no longer declares.
      const prefilled: SourceEntry[] = response.prefilledSources.map(
        (source) => ({
          path: source.path,
          kind: source.kind,
          organizationState: source.organizationState,
        }),
      );
      resetWizardStateWithSources(prefilled);
      setPreference('setupCompleted', false);
      setFirstRunConfirming(false);
      await navigate({ to: '/setup' });
    } catch (err) {
      setFirstRunError(errMessage(err));
    } finally {
      setFirstRunRestarting(false);
    }
  };

  // #601: no `db.export` backend command exists yet — the button used to be
  // a console.log no-op styled as a real action. Disabled with an
  // explanatory title (same "not backed yet" convention as MasterDetail's
  // #642 disabled actions) rather than shipping a dead "live" button.
  //
  // Reset preferences, by contrast, genuinely has a real backend already
  // (`resetPreferences()` — theme/density/font-size, local-only, no IPC
  // needed) — it was just never wired to the button. Gated behind a confirm
  // step for consistency with this pane's other resets (guided-tour/
  // first-run restarts above).
  const handleReset = () => {
    resetPreferences();
    setResetConfirming(false);
    setResetDone(true);
    setTimeout(() => setResetDone(false), RESET_FEEDBACK_MS);
  };

  return (
    <>
      {/* Database info (#602: this panel used to hardcode a fabricated size,
          schema version, and record count — plus a pre-rename `~/.alm/` path
          — directly above the real status bar showing genuinely different
          live numbers. No backend command exists yet to report real db stats
          or a real path, so those rows are removed rather than shown wrong;
          "Engine" is the one row that was always a true, static fact. */}
      <SettingsSection
        title={m.settings_advanced_db_title()}
        action={
          <Btn
            size="sm"
            disabled
            title={m.settings_advanced_db_export_unavailable_title()}
          >
            {m.settings_advanced_db_export()}
          </Btn>
        }
      >
        <SettingsRow label={m.settings_advanced_db_engine()}>
          {m.settings_advanced_db_engine_value()}
        </SettingsRow>
      </SettingsSection>

      {/* Log level — persisted via spec 018 settings backend */}
      <SettingsSection
        title={m.settings_advanced_log_title()}
        action={
          <RestoreDefaultsBtn
            scope="advanced"
            keys={ADVANCED_KEYS}
            onRestored={applyValues}
          />
        }
      >
        <SettingsRow
          label={m.settings_advanced_log_level()}
          info={m.settings_advanced_loglevel_info()}
        >
          <select
            aria-label={m.settings_advanced_log_level()}
            className={`${selectBase} pv-adv-settings__log-select`}
            value={logLevel}
            onChange={(e) => {
              const v = e.target.value as LogLevel;
              setLogLevel(v);
              save('advanced', { logLevel: v });
            }}
          >
            <option value="debug">{m.settings_advanced_log_debug()}</option>
            <option value="info">{m.settings_advanced_log_info()}</option>
            <option value="warn">{m.settings_advanced_log_warn()}</option>
            <option value="error">{m.settings_advanced_log_error()}</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      {/* First-run source setup wizard restart (spec 003 US3). Reopens the
          Raw/Calibration/Project/Inbox source-registration wizard. Requires
          an explicit confirm step (A7, R-E5). */}
      <SettingsSection title={m.settings_advanced_firstrun_restart_title()}>
        <SettingsRow
          label={m.settings_advanced_firstrun_restart_label()}
          info={m.settings_advanced_firstrun_restart_desc()}
        >
          <div className={controlCol}>
            {firstRunConfirming ? (
              <div className="pv-adv-settings__danger-box">
                <p className="pv-adv-settings__danger-desc">
                  {m.settings_advanced_firstrun_restart_confirm_desc()}
                </p>
                <div className={controlRow}>
                  <Btn
                    size="sm"
                    variant="danger"
                    onClick={() => void handleFirstRunRestart()}
                    disabled={firstRunRestarting}
                    data-testid="firstrun-restart-confirm-btn"
                  >
                    {firstRunRestarting
                      ? m.common_restarting()
                      : m.settings_advanced_firstrun_restart_confirm_yes()}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => setFirstRunConfirming(false)}
                    disabled={firstRunRestarting}
                  >
                    {m.common_cancel()}
                  </Btn>
                </div>
              </div>
            ) : (
              <Btn
                size="sm"
                onClick={() => setFirstRunConfirming(true)}
                data-testid="firstrun-restart-btn"
              >
                {m.settings_advanced_firstrun_restart_button()}
              </Btn>
            )}
            {firstRunError && (
              <div className="pv-settings__error" role="alert">
                {m.settings_advanced_firstrun_restart_error({
                  message: firstRunError,
                })}
              </div>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Signed auto-update (spec 051 US10, #869/#873, astro-plan-mkkgi).
          The toggle only gates the startup check (astro-plan-bzzbp); the
          manual check in UpdateActions works either way. */}
      <SettingsSection title={m.settings_advanced_updates_title()}>
        <SettingsRow
          label={m.settings_advanced_updates_auto_check()}
          info={m.settings_advanced_updates_auto_check_info()}
        >
          <Toggle
            aria-label={m.settings_advanced_updates_auto_check()}
            checked={checkUpdatesAutomatically}
            onChange={setCheckUpdatesAutomatically}
            data-testid="update-auto-check-toggle"
          />
        </SettingsRow>
        <SettingsRow
          label={m.settings_advanced_updates_candidates()}
          info={m.settings_advanced_updates_candidates_info()}
        >
          <Toggle
            aria-label={m.settings_advanced_updates_candidates()}
            checked={includeReleaseCandidates}
            onChange={setIncludeReleaseCandidates}
            data-testid="update-candidates-toggle"
          />
        </SettingsRow>
        <SettingsRow label={m.settings_advanced_updates_title()}>
          <div className={controlCol}>
            {runningVersion && (
              <p
                className="pv-adv-settings__control-desc"
                data-testid="update-running-version"
              >
                {m.settings_advanced_updates_running_version({
                  version: runningVersion,
                })}
              </p>
            )}
            <p
              className="pv-adv-settings__control-desc"
              data-testid="update-status"
            >
              {updateStatusMessage(updateState)}
            </p>
            <div className={controlRow}>
              <UpdateActions state={updateState} testIdPrefix="update" />
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Getting started (spec 056). Replay control (T015) + the single restore/
          reset control (T030, FR-014): unhides the section after explicit
          removal AND after completion auto-hide, re-derives automatic pre-ticks,
          preserves manual/dismissed state; idempotent on repeat. */}
      <SettingsSection title={m.onboarding_section_title()}>
        <SettingsRow label={m.onboarding_settings_replay_label()}>
          <Btn
            size="sm"
            onClick={() => requestOrientationReplay()}
            data-testid="onboarding-replay-btn"
          >
            {m.onboarding_settings_replay_label()}
          </Btn>
        </SettingsRow>
        <SettingsRow
          label={m.onboarding_settings_restore_label()}
          info={m.onboarding_settings_restore_description()}
        >
          <Btn
            size="sm"
            onClick={() => void restoreOnboarding()}
            data-testid="onboarding-restore-btn"
          >
            {m.onboarding_settings_restore_label()}
          </Btn>
        </SettingsRow>
      </SettingsSection>

      {/* Danger zone (#601): was a console.log no-op styled as a real
          destructive action. `resetPreferences()` is real and local-only, so
          it's wired for real, gated behind a confirm step like this pane's
          other resets. */}
      <SettingsSection title={m.settings_advanced_danger_title()}>
        <div className="pv-adv-settings__danger-box">
          <div className="pv-adv-settings__danger-heading">
            <strong>{m.settings_advanced_danger_reset()}</strong>
          </div>
          <p className="pv-adv-settings__danger-desc">
            {m.settings_advanced_danger_desc()}
          </p>
          {resetConfirming ? (
            <>
              <p className="pv-adv-settings__danger-desc">
                {m.settings_advanced_danger_confirm_desc()}
              </p>
              <div className={controlRow}>
                <Btn
                  size="sm"
                  variant="destructive"
                  onClick={handleReset}
                  data-testid="reset-preferences-confirm-btn"
                >
                  {m.settings_advanced_danger_confirm_yes()}
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => setResetConfirming(false)}
                >
                  {m.common_cancel()}
                </Btn>
              </div>
            </>
          ) : (
            <Btn
              size="sm"
              variant="destructive"
              onClick={() => setResetConfirming(true)}
              data-testid="reset-preferences-btn"
            >
              {m.settings_advanced_danger_reset()}
            </Btn>
          )}
          {resetDone && (
            <p
              className="pv-adv-settings__control-desc"
              role="status"
              data-testid="reset-preferences-done"
            >
              {m.settings_advanced_danger_reset_done()}
            </p>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
