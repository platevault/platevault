import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell } from '@/ui/WizardShell';
import { Btn } from '@/ui/Btn';
import { setPreference } from '@/data/preferences';
import { registerRoot, startScan } from '@/api/commands';
import { StepWelcome, StepSources, StepScan, StepConfirm } from './steps';
import type { SourceCategory, ScanSettings } from './steps';

const STORAGE_KEY = 'alm-setup-wizard-state';

interface WizardState {
  currentStep: number;
  categories: SourceCategory[];
  scanSettings: ScanSettings;
}

const DEFAULT_CATEGORIES: SourceCategory[] = [
  { key: 'raw', label: 'Raw sources', note: 'where light frames live', required: true, paths: [], estimates: [] },
  { key: 'calibration', label: 'Calibration sources', note: 'darks, flats, biases', required: false, paths: [], estimates: [] },
  { key: 'project', label: 'Project sources', note: 'processing projects', required: true, paths: [], estimates: [] },
  { key: 'inbox', label: 'Inbox sources', note: 'new / unprocessed', required: false, paths: [], estimates: [] },
];

const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  scanFits: true,
  scanXisf: true,
  scanRaw: false,
  scanVideo: false,
  extractMetadata: true,
  inferSessions: true,
};

const STEPS = [
  { label: 'Welcome', heading: 'Welcome to Astro Library Manager', description: '' },
  {
    label: 'Sources',
    heading: 'Where does your astrophotography data live?',
    description: 'Add the folders the app should index. Nothing is moved or modified. You can add more later.',
  },
  {
    label: 'Scan settings',
    heading: 'What should the scan look for?',
    description: 'Choose file types and options for the initial library scan. You can change these later.',
  },
  {
    label: 'Confirm',
    heading: 'Ready to go',
    description: 'Review your configuration before starting the initial scan.',
  },
];

function loadWizardState(): WizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.categories) && parsed.categories.length > 0) {
        return parsed as WizardState;
      }
    }
  } catch {
    // corrupt or stale state -- start fresh
  }
  return {
    currentStep: 0,
    categories: DEFAULT_CATEGORIES,
    scanSettings: DEFAULT_SCAN_SETTINGS,
  };
}

function saveWizardState(state: WizardState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full -- proceed without persistence
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

  const handleCategoriesChange = useCallback((categories: SourceCategory[]) => {
    setState((prev) => ({ ...prev, categories }));
  }, []);

  const handleScanSettingsChange = useCallback((scanSettings: ScanSettings) => {
    setState((prev) => ({ ...prev, scanSettings }));
  }, []);

  // Derived summary counts
  const { totalFolders, totalEstimate } = useMemo(() => {
    let folders = 0;
    let estimate = 0;
    for (const cat of state.categories) {
      for (let i = 0; i < cat.paths.length; i++) {
        if (cat.paths[i]) {
          folders++;
          estimate += cat.estimates[i] || 0;
        }
      }
    }
    return { totalFolders: folders, totalEstimate: estimate };
  }, [state.categories]);

  const handleComplete = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // Register each folder as a root
      for (const cat of state.categories) {
        for (const path of cat.paths) {
          if (!path) continue;
          await registerRoot({
            path,
            category: cat.key,
            scan_settings: state.scanSettings as unknown as Record<string, unknown>,
          });
        }
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
      // On failure, allow retry -- stay on confirm step
      setIsSubmitting(false);
    }
  }, [state.categories, state.scanSettings, navigate]);

  const isMockMode = import.meta.env.VITE_USE_MOCKS === 'true';

  // Determine whether "Continue" should be enabled
  const canProceed = useMemo(() => {
    if (isMockMode) return true;
    if (state.currentStep === 1) {
      return state.categories
        .filter((c) => c.required)
        .every((c) => c.paths.some(Boolean));
    }
    return true;
  }, [state.currentStep, state.categories, isMockMode]);

  const step = state.currentStep;
  const stepMeta = STEPS[step];

  const resetWizard = useCallback(() => {
    clearWizardState();
    setState({
      currentStep: 0,
      categories: DEFAULT_CATEGORIES,
      scanSettings: DEFAULT_SCAN_SETTINGS,
    });
  }, []);

  const wizardSteps = STEPS.map((s, i) => ({
    label: s.label,
    completed: i < step,
  }));

  // Format estimated file count for footer
  function formatEstimate(n: number): string {
    if (n >= 1000) return `~${Math.round(n / 1000)}k files`;
    return `~${n} files`;
  }

  // Build the navigation footer for the current step
  const footer = (
    <>
      {step > 0 ? (
        <Btn variant="ghost" onClick={() => goTo(step - 1)} disabled={isSubmitting}>
          &larr; Back
        </Btn>
      ) : (
        <span />
      )}
      {isMockMode && (
        <Btn variant="ghost" onClick={resetWizard} style={{ fontSize: 11, color: 'var(--alm-text-muted)' }}>
          Reset wizard
        </Btn>
      )}
      <div style={{ flex: 1 }} />
      {step === 1 && totalFolders > 0 && (
        <span
          style={{
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
          }}
        >
          {totalFolders} folder{totalFolders !== 1 ? 's' : ''} selected
          {totalEstimate > 0 ? ` · ${formatEstimate(totalEstimate)}` : ''}
        </span>
      )}
      {step < STEPS.length - 1 ? (
        <Btn
          variant="primary"
          onClick={() => goTo(step + 1)}
          disabled={!canProceed}
        >
          {step === 0
            ? 'Get started →'
            : `Continue to ${STEPS[step + 1].label.toLowerCase()} →`}
        </Btn>
      ) : (
        <Btn
          variant="primary"
          onClick={handleComplete}
          disabled={isSubmitting || !canProceed}
        >
          {isSubmitting ? 'Setting up…' : 'Complete setup'}
        </Btn>
      )}
    </>
  );

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', flex: 1 }}>
      <div style={{ width: '100%' }}>
        <WizardShell steps={wizardSteps} currentStep={step} footer={footer}>
          {/* Step label + heading */}
          <div
            style={{
              fontSize: 'var(--alm-text-xs)',
              color: 'var(--alm-text-muted)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Setup &middot; Step {step + 1} of {STEPS.length}
          </div>
          <h1
            style={{
              fontSize: 'var(--alm-text-2xl)',
              fontWeight: 600,
              marginTop: 'var(--alm-space-2)',
              marginBottom: stepMeta.description ? 'var(--alm-space-2)' : 'var(--alm-space-7)',
            }}
          >
            {stepMeta.heading}
          </h1>
          {stepMeta.description && (
            <p
              style={{
                fontSize: 'var(--alm-text-sm)',
                color: 'var(--alm-text-muted)',
                maxWidth: 540,
                marginBottom: 'var(--alm-space-7)',
                lineHeight: 1.5,
              }}
            >
              {stepMeta.description}
            </p>
          )}

          {/* Step body */}
          {step === 0 && <StepWelcome onNext={() => goTo(1)} />}
          {step === 1 && (
            <StepSources
              categories={state.categories}
              onCategoriesChange={handleCategoriesChange}
            />
          )}
          {step === 2 && (
            <StepScan
              settings={state.scanSettings}
              onSettingsChange={handleScanSettingsChange}
            />
          )}
          {step === 3 && (
            <StepConfirm
              categories={state.categories}
              scanSettings={state.scanSettings}
              isSubmitting={isSubmitting}
            />
          )}
        </WizardShell>
      </div>
    </div>
  );
}
