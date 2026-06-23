// spec 018 — owned pane: logLevel, rememberFollowLogs, devMode.
// On mount, loads persisted values from backend via settings.get('advanced').
// Changes are auto-saved via the save() prop (useAutoSave -> settings.update).
// spec 010 — Guided flow restart control added (T042).
import { useState, useEffect } from 'react';
import { Btn } from '@/ui';
import { getSettings } from '@/api/commands';
import { getGuidedState, restartGuidedFlow, type GuidedFlowStateDto } from '@/features/guided/store';
import { STEP_ORDER } from '@/features/guided/store';
import { m } from '@/lib/i18n';
import { SettingsSection, SettingsRow, RestoreDefaultsBtn } from './SettingsKit';

const ADVANCED_KEYS = ['logLevel', 'rememberFollowLogs', 'devMode'];

interface AdvancedProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export function Advanced({ save }: AdvancedProps) {
  const [logLevel, setLogLevel] = useState<LogLevel>('info');
  const [guidedState, setGuidedState] = useState<GuidedFlowStateDto | null>(null);
  const [guidedRestarting, setGuidedRestarting] = useState(false);

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
      .catch(() => {/* Backend unavailable — hide control */});
    return () => { cancelled = true; };
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

  const handleExport = () => console.log('Export DB triggered');
  const handleReset = () => console.log('Reset preferences triggered');

  return (
    <>
      {/* Database info */}
      <SettingsSection
        title={m.settings_advanced_db_title()}
        action={<Btn size="sm" onClick={handleExport}>{m.settings_advanced_db_export()}</Btn>}
      >
        <SettingsRow label={m.settings_advanced_db_location()}>
          {/* eslint-disable-next-line alm/no-user-string -- filesystem path identifier, not translatable */}
          <code className="alm-mono alm-adv-settings__db-path">~/.alm/astro-library.db</code>
        </SettingsRow>
        <SettingsRow label={m.settings_advanced_db_engine()}>{m.settings_advanced_db_engine_value()}</SettingsRow>
        <SettingsRow label={m.settings_advanced_db_size()}>{m.settings_advanced_db_size_value()}</SettingsRow>
        <SettingsRow label={m.settings_advanced_db_schema()}>{m.settings_advanced_db_schema_value()}</SettingsRow>
        <SettingsRow label={m.settings_advanced_db_records()}>{m.settings_advanced_db_records_value()}</SettingsRow>
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
          info="Controls application log verbosity. Debug emits diagnostic detail; Info is the default; Warn and Error progressively quieter."
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
            info="Walks you through setting up your first project."
          >
            <div className="alm-adv-settings__guided-col">
              <p className="alm-adv-settings__guided-desc">
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
                {guidedRestarting ? m.common_restarting() : m.settings_advanced_restart_guided()}
              </Btn>
            </div>
          </SettingsRow>
        </SettingsSection>
      )}

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
