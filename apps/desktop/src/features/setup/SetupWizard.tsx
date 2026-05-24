import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell, type WizardStep } from '@/ui/WizardShell';
import { setPreference } from '@/data/preferences';
import { registerRoot, startScan } from '@/api/commands';
import { StepWelcome, StepSources, StepScan, StepConfirm } from './steps';
import type { SourceEntry, ScanSettings } from './steps';

const STORAGE_KEY = 'alm-setup-wizard-state';

interface WizardState {
  currentStep: number;
  sources: SourceEntry[];
  scanSettings: ScanSettings;
}

const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  scanFits: true,
  scanXisf: true,
  scanRaw: false,
  scanVideo: false,
  extractMetadata: true,
  inferSessions: true,
};

const STEP_LABELS = ['Welcome', 'Sources', 'Scan settings', 'Confirm'];

function loadWizardState(): WizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as WizardState;
    }
  } catch {
    // corrupt state — start fresh
  }
  return {
    currentStep: 0,
    sources: [],
    scanSettings: DEFAULT_SCAN_SETTINGS,
  };
}

function saveWizardState(state: WizardState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full — proceed without persistence
  }
}

function clearWizardState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function SetupWizard() {
  const navigate = useNavigate();
  const [state, setState] = useState<WizardState>(loadWizardState);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Persist wizard progress on every state change
  useEffect(() => {
    saveWizardState(state);
  }, [state]);

  const goTo = useCallback((step: number) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const handleSourcesChange = useCallback((sources: SourceEntry[]) => {
    setState((prev) => ({ ...prev, sources }));
  }, []);

  const handleScanSettingsChange = useCallback((scanSettings: ScanSettings) => {
    setState((prev) => ({ ...prev, scanSettings }));
  }, []);

  const handleComplete = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // Register each source root
      for (const source of state.sources) {
        await registerRoot({
          path: source.path,
          category: source.category,
          scan_settings: state.scanSettings as unknown as Record<string, unknown>,
        });
      }

      // Start the initial scan
      await startScan();

      // Mark setup complete
      setPreference('setupCompleted', true);

      // Clean up wizard progress
      clearWizardState();

      // Navigate to sessions
      navigate({ to: '/sessions' });
    } catch {
      // On failure, allow retry — stay on confirm step
      setIsSubmitting(false);
    }
  }, [state.sources, state.scanSettings, navigate]);

  const wizardSteps: WizardStep[] = STEP_LABELS.map((label, i) => ({
    label,
    completed: i < state.currentStep,
  }));

  const summary = (
    <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
      <h4 style={{ fontWeight: 600, color: 'var(--alm-text)', marginBottom: 'var(--alm-space-3)' }}>
        Setup Progress
      </h4>
      <div style={{ marginBottom: 'var(--alm-space-2)' }}>
        Sources: {state.sources.length} folder{state.sources.length !== 1 ? 's' : ''}
      </div>
      {state.sources.map((s, i) => (
        <div key={i} style={{
          fontFamily: 'var(--alm-font-mono)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 'var(--alm-space-1)',
        }}>
          {s.path.split('/').pop() || s.path}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', flex: 1 }}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        <WizardShell steps={wizardSteps} currentStep={state.currentStep} summary={summary}>
          {state.currentStep === 0 && (
            <StepWelcome onNext={() => goTo(1)} />
          )}
          {state.currentStep === 1 && (
            <StepSources
              sources={state.sources}
              onSourcesChange={handleSourcesChange}
              onNext={() => goTo(2)}
              onBack={() => goTo(0)}
            />
          )}
          {state.currentStep === 2 && (
            <StepScan
              settings={state.scanSettings}
              onSettingsChange={handleScanSettingsChange}
              onNext={() => goTo(3)}
              onBack={() => goTo(1)}
            />
          )}
          {state.currentStep === 3 && (
            <StepConfirm
              sources={state.sources}
              scanSettings={state.scanSettings}
              onComplete={handleComplete}
              onBack={() => goTo(2)}
              isSubmitting={isSubmitting}
            />
          )}
        </WizardShell>
      </div>
    </div>
  );
}
