// spec 018 — owned pane: logLevel, rememberFollowLogs, devMode.
// On mount, loads persisted values from backend via settings.get('advanced').
// Changes are auto-saved via the save() prop (useAutoSave -> settings.update).
// spec 010 — Guided flow restart control added (T042).
import { useState, useEffect } from 'react';
import { Btn } from '@/ui';
import { getSettings } from '@/api/commands';
import { getGuidedState, restartGuidedFlow, type GuidedFlowStateDto } from '@/features/guided/store';
import { STEP_ORDER } from '@/features/guided/store';
import { SettingsSection, SettingsRow } from './SettingsKit';

interface AdvancedProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export function Advanced({ save }: AdvancedProps) {
  const [logLevel, setLogLevel] = useState<LogLevel>('info');
  const [guidedState, setGuidedState] = useState<GuidedFlowStateDto | null>(null);
  const [guidedRestarting, setGuidedRestarting] = useState(false);

  // Load persisted logLevel from backend on mount (T015).
  useEffect(() => {
    let cancelled = false;
    getSettings({ scope: 'advanced' })
      .then((data) => {
        if (cancelled) return;
        const vals = data.values as Record<string, unknown>;
        if (vals?.logLevel && typeof vals.logLevel === 'string') {
          setLogLevel(vals.logLevel as LogLevel);
        }
      })
      .catch(() => {
        // Backend unavailable — stay with in-code default.
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
        title="Database"
        action={<Btn size="sm" onClick={handleExport}>Export database</Btn>}
      >
        <SettingsRow label="Location">
          <code className="alm-mono alm-adv-settings__db-path">~/.alm/astro-library.db</code>
        </SettingsRow>
        <SettingsRow label="Engine">SQLite</SettingsRow>
        <SettingsRow label="Size">24.8 MB</SettingsRow>
        <SettingsRow label="Schema version">v1.0</SettingsRow>
        <SettingsRow label="Records">142,318 files · 22 sessions · 3 projects</SettingsRow>
      </SettingsSection>

      {/* Log level — persisted via spec 018 settings backend */}
      <SettingsSection title="Logging">
        <SettingsRow
          label="Log level"
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
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      {/* Guided first-project-flow restart (spec 010, T042) */}
      {guidedState !== null && (
        <SettingsSection title="Guided Tour">
          <SettingsRow
            label="First project flow"
            info="The guided flow walks you through setting up your first project. You can restart it at any time from here."
          >
            <div className="alm-adv-settings__guided-col">
              <p className="alm-adv-settings__guided-desc">
                {guidedCompleted
                  ? 'The guided flow has been completed. Restart to replay it from the beginning.'
                  : guidedState.dismissed
                    ? 'The guided flow is currently dismissed. Restart to resume from your last position.'
                    : 'The guided flow is active.'}
              </p>
              <Btn
                size="sm"
                onClick={() => void handleGuidedRestart()}
                disabled={guidedRestarting}
                data-testid="guided-restart-btn"
              >
                {guidedRestarting ? 'Restarting…' : 'Restart guided flow'}
              </Btn>
            </div>
          </SettingsRow>
        </SettingsSection>
      )}

      {/* Danger zone */}
      <SettingsSection title="Danger Zone">
        <div className="alm-adv-settings__danger-box">
          <div className="alm-adv-settings__danger-heading">
            <strong>Reset preferences</strong>
          </div>
          <p className="alm-adv-settings__danger-desc">
            Resets all UI preferences (theme, density, font size) to defaults. Library roots, equipment,
            and session data are not affected.
          </p>
          <Btn size="sm" variant="danger" onClick={handleReset}>
            Reset preferences
          </Btn>
        </div>
      </SettingsSection>
    </>
  );
}
