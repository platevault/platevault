// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// spec 018 — owned scope: logLevel (rendered below), rememberFollowLogs
// (surfaced via the log panel's follow-tail toggle, app/LogPanelContext.tsx —
// not duplicated here) and devMode (deliberately hidden per spec 021 T032,
// reachable only at /dev/settings; NOT a UI gap, see app/router.tsx). #624
// audited this pane's key list; both are covered elsewhere by design.
// On mount, loads persisted values from backend via settings.get('advanced').
// Changes are auto-saved via the save() prop (useAutoSave -> settings.update).
// spec 010 — Guided flow restart control added (T042).
// spec 003 US3 — first-run setup wizard restart control added (regression fix:
// firstrun.restart was fully wired on the backend but had no UI caller).
import { useState, useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Btn } from '@/ui';
import { getSettings, restartFirstRun } from './settingsIpc';
import { resetPreferences } from '@/data/preferences';
import {
  getGuidedState,
  restartGuidedFlow,
  type GuidedFlowStateDto,
} from '@/features/guided/store';
import { STEP_ORDER } from '@/features/guided/store';
import { m } from '@/lib/i18n';
import { errMessage } from '@/lib/errors';
import { setPreference } from '@/data/preferences';
import {
  resetWizardStateWithSources,
  type SourceEntry,
} from '@/features/setup/sources-store';
import {
  SettingsSection,
  SettingsRow,
  RestoreDefaultsBtn,
} from './SettingsKit';
import {
  getUpdateSnapshot,
  subscribeUpdate,
  checkForUpdate,
  restartPendingUpdate,
  getRunningVersion,
} from '@/data/updateSubscription';

const ADVANCED_KEYS = ['logLevel', 'rememberFollowLogs', 'devMode'];

interface AdvancedProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export function Advanced({ save }: AdvancedProps) {
  const navigate = useNavigate();
  const [logLevel, setLogLevel] = useState<LogLevel>('info');
  const [guidedState, setGuidedState] = useState<GuidedFlowStateDto | null>(
    null,
  );
  const [guidedRestarting, setGuidedRestarting] = useState(false);
  const [guidedConfirming, setGuidedConfirming] = useState(false);
  const [guidedRestarted, setGuidedRestarted] = useState(false);
  const [firstRunConfirming, setFirstRunConfirming] = useState(false);
  const [firstRunRestarting, setFirstRunRestarting] = useState(false);
  const [firstRunError, setFirstRunError] = useState<string | null>(null);
  const updateState = useSyncExternalStore(subscribeUpdate, getUpdateSnapshot);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const applyValues = (vals: Record<string, unknown>) => {
    if (vals?.logLevel && typeof vals.logLevel === 'string') {
      setLogLevel(vals.logLevel as LogLevel);
    }
  };

  // Load persisted logLevel from backend on mount (T015).
  useEffect(() => {
    let cancelled = false;
    getSettings({ scope: 'advanced' })
      .then((data) => {
        if (cancelled) return;
        applyValues(data.values as Record<string, unknown>);
      })
      .catch(() => {
        // Backend unavailable — stay with in-code default.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Load guided flow state on mount (spec 010, T042).
  useEffect(() => {
    let cancelled = false;
    getGuidedState()
      .then((state) => {
        if (!cancelled) setGuidedState(state);
      })
      .catch(() => {
        /* Backend unavailable — hide control */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // #827: this control was a silent no-op with no confirm gate, asymmetric
  // with the sibling "Restart first-run setup" control below (which has both).
  // It doesn't reopen anything destructive (unlike the first-run wizard
  // restart, which clears the setup-completed flag), so the confirm copy is
  // lighter, but the gate + a transient success message are still required
  // so a click always produces an observable result.
  const handleGuidedRestart = async () => {
    setGuidedRestarting(true);
    setGuidedRestarted(false);
    try {
      const newState = await restartGuidedFlow();
      setGuidedState(newState);
      setGuidedConfirming(false);
      setGuidedRestarted(true);
      setTimeout(() => setGuidedRestarted(false), 3000);
    } catch {
      // Best-effort.
    } finally {
      setGuidedRestarting(false);
    }
  };

  // A "Completed" flow is one where all steps are in completedSteps.
  const guidedCompleted = guidedState
    ? STEP_ORDER.every((id) => guidedState.completedSteps.includes(id))
    : false;

  // Restart the first-run *source setup* wizard (spec 003 US3) — distinct from
  // the guided first-project tour above. Requires an explicit confirm step
  // because it reopens the whole source-registration flow.
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
    setTimeout(() => setResetDone(false), 3000);
  };

  // Staged update flow (#888, absorbs #869/#873): checking/downloading are
  // automatic; only the restart/install step is an explicit user action
  // (US10 AS1, FR-030). Both actions manage their own phase transitions in
  // updateSubscription.ts — this pane just reflects `updateState`.
  const handleCheckForUpdate = async () => {
    setUpdateBusy(true);
    try {
      await checkForUpdate();
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleRestartUpdate = async () => {
    setUpdateBusy(true);
    try {
      await restartPendingUpdate();
    } finally {
      setUpdateBusy(false);
    }
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
            className="pv-select pv-adv-settings__log-select"
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

      {/* Guided first-project-flow restart (spec 010, T042) */}
      {guidedState !== null && (
        <SettingsSection title={m.settings_advanced_tour_title()}>
          <SettingsRow
            label={m.settings_advanced_tour_label()}
            info={m.settings_advanced_firstrun_info()}
          >
            <div className="pv-adv-settings__control-col">
              <p className="pv-adv-settings__control-desc">
                {guidedCompleted
                  ? m.settings_advanced_guided_completed()
                  : guidedState.dismissed
                    ? m.settings_advanced_guided_dismissed()
                    : m.settings_advanced_guided_active()}
              </p>
              {guidedConfirming ? (
                <div className="pv-adv-settings__danger-box">
                  <p className="pv-adv-settings__danger-desc">
                    {m.settings_advanced_guided_restart_confirm_desc()}
                  </p>
                  <div className="pv-adv-settings__control-row">
                    <Btn
                      size="sm"
                      onClick={() => void handleGuidedRestart()}
                      disabled={guidedRestarting}
                      data-testid="guided-restart-confirm-btn"
                    >
                      {guidedRestarting
                        ? m.common_restarting()
                        : m.settings_advanced_guided_restart_confirm_yes()}
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => setGuidedConfirming(false)}
                      disabled={guidedRestarting}
                    >
                      {m.common_cancel()}
                    </Btn>
                  </div>
                </div>
              ) : (
                <Btn
                  size="sm"
                  onClick={() => setGuidedConfirming(true)}
                  data-testid="guided-restart-btn"
                >
                  {m.settings_advanced_restart_guided()}
                </Btn>
              )}
              {guidedRestarted && (
                <p
                  className="pv-adv-settings__control-desc"
                  role="status"
                  data-testid="guided-restart-done"
                >
                  {m.settings_advanced_guided_restart_done()}
                </p>
              )}
            </div>
          </SettingsRow>
        </SettingsSection>
      )}

      {/* First-run source setup wizard restart (spec 003 US3). Distinct from
          the guided first-project tour above: this reopens the Raw/
          Calibration/Project/Inbox source-registration wizard, not the
          walkthrough. Requires an explicit confirm step (A7, R-E5). */}
      <SettingsSection title={m.settings_advanced_firstrun_restart_title()}>
        <SettingsRow
          label={m.settings_advanced_firstrun_restart_label()}
          info={m.settings_advanced_firstrun_restart_desc()}
        >
          <div className="pv-adv-settings__control-col">
            {firstRunConfirming ? (
              <div className="pv-adv-settings__danger-box">
                <p className="pv-adv-settings__danger-desc">
                  {m.settings_advanced_firstrun_restart_confirm_desc()}
                </p>
                <div className="pv-adv-settings__control-row">
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

      {/* Signed auto-update — staged flow (spec 051 US10, #888/#869/#873) */}
      <SettingsSection title={m.settings_advanced_updates_title()}>
        <SettingsRow label={m.settings_advanced_updates_title()}>
          <div className="pv-adv-settings__control-col">
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
              {updateState.phase === 'checking' &&
                m.settings_advanced_updates_checking()}
              {(updateState.phase === 'idle' ||
                updateState.phase === 'up-to-date') &&
                m.settings_advanced_updates_uptodate()}
              {updateState.phase === 'check-failed' &&
                m.settings_advanced_updates_checkfailed({
                  message: updateState.error ?? '',
                })}
              {updateState.phase === 'downloading' &&
                m.settings_advanced_updates_downloading({
                  version: updateState.version ?? '',
                })}
              {updateState.phase === 'download-failed' &&
                m.settings_advanced_updates_downloadfailed({
                  message: updateState.error ?? '',
                })}
              {updateState.phase === 'ready' &&
                m.settings_advanced_updates_ready({
                  version: updateState.version ?? '',
                })}
              {updateState.phase === 'restart-failed' &&
                m.settings_advanced_updates_restartfailed()}
            </p>
            {(updateState.phase === 'ready' ||
              updateState.phase === 'restart-failed') && (
              <Btn
                size="sm"
                onClick={() => void handleRestartUpdate()}
                disabled={updateBusy}
                data-testid="update-restart-btn"
              >
                {updateBusy
                  ? m.common_restarting()
                  : m.settings_advanced_updates_restart()}
              </Btn>
            )}
            {(updateState.phase === 'check-failed' ||
              updateState.phase === 'download-failed') && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => void handleCheckForUpdate()}
                disabled={updateBusy}
                data-testid="update-retry-btn"
              >
                {m.settings_advanced_updates_check_retry()}
              </Btn>
            )}
          </div>
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
              <div className="pv-adv-settings__control-row">
                <Btn
                  size="sm"
                  variant="danger"
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
              variant="danger"
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
