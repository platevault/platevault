// spec 018 — owned pane: logLevel, rememberFollowLogs, devMode.
// On mount, loads persisted values from backend via settings.get('advanced').
// Changes are auto-saved via the save() prop (useAutoSave -> settings.update).
// spec 010 — Guided flow restart control added (T042).
// spec 003 US3 — first-run setup wizard restart control added (regression fix:
// firstrun.restart was fully wired on the backend but had no UI caller).
import { useState, useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Btn } from '@/ui';
import { getSettings, restartFirstRun } from './settingsIpc';
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
  installPendingUpdate,
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
  const [firstRunConfirming, setFirstRunConfirming] = useState(false);
  const [firstRunRestarting, setFirstRunRestarting] = useState(false);
  const [firstRunError, setFirstRunError] = useState<string | null>(null);
  const pendingUpdate = useSyncExternalStore(
    subscribeUpdate,
    getUpdateSnapshot,
  );
  const [installing, setInstalling] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

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

  const handleGuidedRestart = async () => {
    setGuidedRestarting(true);
    try {
      const newState = await restartGuidedFlow();
      setGuidedState(newState);
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
      // sources (A7) — RegisterSourceResponse has no scanDepth, so default to
      // 'recursive' per FR-017.
      const prefilled: SourceEntry[] = response.prefilledSources.map(
        (source) => ({
          path: source.path,
          kind: source.kind,
          scanDepth: 'recursive',
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

  const handleExport = () => console.log('Export DB triggered');
  const handleReset = () => console.log('Reset preferences triggered');

  // Signed auto-update install (spec 051 US10, T058). Explicit user action
  // only — never silent/automatic (US10 AS1, FR-030).
  const handleInstallUpdate = async () => {
    setInstalling(true);
    setUpdateError(null);
    try {
      await installPendingUpdate();
    } catch (err) {
      setUpdateError(errMessage(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      {/* Database info */}
      <SettingsSection
        title={m.settings_advanced_db_title()}
        action={
          <Btn size="sm" onClick={handleExport}>
            {m.settings_advanced_db_export()}
          </Btn>
        }
      >
        <SettingsRow label={m.settings_advanced_db_location()}>
          {/* eslint-disable-next-line alm/no-user-string -- filesystem path identifier, not translatable */}
          <code className="alm-mono alm-adv-settings__db-path">
            ~/.alm/astro-library.db
          </code>
        </SettingsRow>
        <SettingsRow label={m.settings_advanced_db_engine()}>
          {m.settings_advanced_db_engine_value()}
        </SettingsRow>
        <SettingsRow label={m.settings_advanced_db_size()}>
          {m.settings_advanced_db_size_value()}
        </SettingsRow>
        <SettingsRow label={m.settings_advanced_db_schema()}>
          {m.settings_advanced_db_schema_value()}
        </SettingsRow>
        <SettingsRow label={m.settings_advanced_db_records()}>
          {m.settings_advanced_db_records_value()}
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
            className="alm-select alm-adv-settings__log-select"
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
            <div className="alm-adv-settings__control-col">
              <p className="alm-adv-settings__control-desc">
                {guidedCompleted
                  ? m.settings_advanced_guided_completed()
                  : guidedState.dismissed
                    ? m.settings_advanced_guided_dismissed()
                    : m.settings_advanced_guided_active()}
              </p>
              <Btn
                size="sm"
                onClick={() => void handleGuidedRestart()}
                disabled={guidedRestarting}
                data-testid="guided-restart-btn"
              >
                {guidedRestarting
                  ? m.common_restarting()
                  : m.settings_advanced_restart_guided()}
              </Btn>
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
          <div className="alm-adv-settings__control-col">
            {firstRunConfirming ? (
              <div className="alm-adv-settings__danger-box">
                <p className="alm-adv-settings__danger-desc">
                  {m.settings_advanced_firstrun_restart_confirm_desc()}
                </p>
                <div className="alm-adv-settings__control-row">
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
                    {m.settings_advanced_firstrun_restart_cancel()}
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
              <div className="alm-settings__error" role="alert">
                {m.settings_advanced_firstrun_restart_error({
                  message: firstRunError,
                })}
              </div>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Signed auto-update (spec 051 US10, T058) */}
      <SettingsSection title={m.settings_advanced_updates_title()}>
        <SettingsRow label={m.settings_advanced_updates_title()}>
          <div className="alm-adv-settings__control-col">
            <p className="alm-adv-settings__control-desc">
              {pendingUpdate
                ? m.settings_advanced_updates_available({
                    version: pendingUpdate.version,
                  })
                : m.settings_advanced_updates_uptodate()}
            </p>
            {pendingUpdate && (
              <Btn
                size="sm"
                onClick={() => void handleInstallUpdate()}
                disabled={installing}
                data-testid="update-install-btn"
              >
                {installing
                  ? m.settings_advanced_updates_installing()
                  : m.settings_advanced_updates_install()}
              </Btn>
            )}
            {updateError && (
              <div className="alm-settings__error" role="alert">
                {m.settings_advanced_updates_error({ message: updateError })}
              </div>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Danger zone */}
      <SettingsSection title={m.settings_advanced_danger_title()}>
        <div className="alm-adv-settings__danger-box">
          <div className="alm-adv-settings__danger-heading">
            <strong>{m.settings_advanced_danger_reset()}</strong>
          </div>
          <p className="alm-adv-settings__danger-desc">
            {m.settings_advanced_danger_desc()}
          </p>
          <Btn size="sm" variant="danger" onClick={handleReset}>
            {m.settings_advanced_danger_reset()}
          </Btn>
        </div>
      </SettingsSection>
    </>
  );
}
