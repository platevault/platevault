import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell } from '@/ui/WizardShell';
import { Btn } from '@/ui/Btn';
import { setPreference } from '@/data/preferences';
import { completeFirstRun } from '@/api/commands';
import {
  StepWelcome,
  StepRaw,
  StepCalibration,
  StepProject,
  StepInbox,
  StepDetectTools,
  StepCatalogs,
  StepConfirm,
  DEFAULT_CATALOG_SETTINGS,
} from './steps';
import type { CatalogSettings } from './steps';
import type { SourcesState, SourceKind, ScanDepth } from './sources-store';
import {
  loadSources,
  saveSources,
  addSource,
  removeSource,
  checkDeduplication,
  validatePath,
  flushToDB,
} from './sources-store';

const STORAGE_KEY = 'alm-setup-wizard-state';

interface WizardState {
  currentStep: number;
  sources: SourcesState;
  catalogSettings: CatalogSettings;
}

const STEPS = [
  {
    label: 'Welcome',
    heading: 'Welcome to Astro Library Manager',
    description: '',
  },
  {
    label: 'Raw',
    heading: 'Where are your raw frames?',
    description: 'Add the folders where your light frames, darks, flats, and biases are stored.',
  },
  {
    label: 'Calibration',
    heading: 'Calibration masters',
    description: 'Add folders containing your master calibration frames. You can skip this step.',
  },
  {
    label: 'Project',
    heading: 'Project folders',
    description: 'Add folders where processing projects and output files will live.',
  },
  {
    label: 'Inbox',
    heading: 'Inbox / watched folders',
    description: 'Add folders for newly captured data. You can skip this step.',
  },
  {
    label: 'Tools',
    heading: 'Detect processing tools',
    description: 'The app can detect installed astrophotography processing tools.',
  },
  {
    label: 'Catalogs',
    heading: 'Target catalogs',
    description: 'Choose which astronomical catalogs to use for resolving object names in your files.',
  },
  {
    label: 'Finish',
    heading: 'Ready to go',
    description: 'Review your configuration before starting the initial scan.',
  },
];

function loadWizardState(): WizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        currentStep: parsed.currentStep ?? 0,
        sources: parsed.sources && typeof parsed.sources === 'object'
          ? {
              raw: Array.isArray(parsed.sources.raw) ? parsed.sources.raw : [],
              calibration: Array.isArray(parsed.sources.calibration) ? parsed.sources.calibration : [],
              project: Array.isArray(parsed.sources.project) ? parsed.sources.project : [],
              inbox: Array.isArray(parsed.sources.inbox) ? parsed.sources.inbox : [],
            }
          : loadSources(),
        catalogSettings: parsed.catalogSettings ?? DEFAULT_CATALOG_SETTINGS,
      };
    }
  } catch {
    // corrupt or stale state -- start fresh
  }
  return {
    currentStep: 0,
    sources: loadSources(),
    catalogSettings: DEFAULT_CATALOG_SETTINGS,
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
  const [errors, setErrors] = useState<Record<SourceKind, Record<number, string>>>({
    raw: {},
    calibration: {},
    project: {},
    inbox: {},
  });

  // Persist wizard progress on every state change
  useEffect(() => {
    saveWizardState(state);
    saveSources(state.sources);
  }, [state]);

  const goTo = useCallback((step: number) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const handleCatalogSettingsChange = useCallback((catalogSettings: CatalogSettings) => {
    setState((prev) => ({ ...prev, catalogSettings }));
  }, []);

  const isMockMode = import.meta.env.VITE_USE_MOCKS === 'true';

  // --- Source management per kind ---
  const makeSourceHandlers = useCallback((kind: SourceKind) => ({
    onAdd: async (path: string) => {
      // Deduplication check
      const dedup = checkDeduplication(state.sources, kind, path);
      if (dedup.crossKindConflict) {
        setErrors((prev) => ({
          ...prev,
          [kind]: {
            ...prev[kind],
            [state.sources[kind].length]: `This directory is registered under ${dedup.crossKindConflict}`,
          },
        }));
        return;
      }
      if (dedup.sameKindDuplicate) {
        setErrors((prev) => ({
          ...prev,
          [kind]: {
            ...prev[kind],
            [state.sources[kind].length]: 'This directory is already added',
          },
        }));
        return;
      }

      // Client-side validation (T020)
      {
        const validationError = validatePath(state.sources, path, kind);
        if (validationError) {
          // Show error inline but still add the path so user can see and remove it
          setState((prev) => ({
            ...prev,
            sources: addSource(prev.sources, kind, path),
          }));
          setErrors((prev) => ({
            ...prev,
            [kind]: {
              ...prev[kind],
              [state.sources[kind].length]: validationError.message,
            },
          }));
          return;
        }
      }

      setState((prev) => ({
        ...prev,
        sources: addSource(prev.sources, kind, path),
      }));
      // Clear any error for this index
      setErrors((prev) => {
        const kindErrors = { ...prev[kind] };
        delete kindErrors[state.sources[kind].length];
        return { ...prev, [kind]: kindErrors };
      });
    },
    onRemove: (index: number) => {
      setState((prev) => ({
        ...prev,
        sources: removeSource(prev.sources, kind, index),
      }));
      // Clear error for removed index and reindex remaining errors
      setErrors((prev) => {
        const oldErrors = prev[kind];
        const newErrors: Record<number, string> = {};
        for (const [key, value] of Object.entries(oldErrors)) {
          const idx = Number(key);
          if (idx < index) newErrors[idx] = value;
          else if (idx > index) newErrors[idx - 1] = value;
          // skip the removed index
        }
        return { ...prev, [kind]: newErrors };
      });
    },
    onScanDepthChange: (index: number, depth: ScanDepth) => {
      setState((prev) => {
        const entries = [...prev.sources[kind]];
        entries[index] = { ...entries[index], scanDepth: depth };
        return {
          ...prev,
          sources: { ...prev.sources, [kind]: entries },
        };
      });
    },
  }), [state.sources, isMockMode]);

  // Derived folder count for footer
  const totalFolders = useMemo(() => {
    let count = 0;
    const kinds: SourceKind[] = ['raw', 'calibration', 'project', 'inbox'];
    for (const k of kinds) {
      count += state.sources[k].length;
    }
    return count;
  }, [state.sources]);

  const handleComplete = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // Flush all sources to the database
      const flushResult = await flushToDB(state.sources);

      if (!flushResult.allSucceeded) {
        // Show errors on the confirm step but don't block — user can retry
        console.warn('Some source registrations failed:', flushResult.results.filter((r) => !r.success));
      }

      // Mark first-run complete via backend
      if (!isMockMode) {
        await completeFirstRun();
      }

      // Mark setup complete in local preferences
      setPreference('setupCompleted', true);

      // Clean up wizard progress
      clearWizardState();

      // Navigate to sessions
      navigate({ to: '/sessions' });
    } catch {
      // On failure, allow retry -- stay on confirm step
      setIsSubmitting(false);
    }
  }, [state.sources, isMockMode, navigate]);

  // Determine whether "Continue" should be enabled
  // Raw (step 1) and Project (step 3) require at least one path.
  // All others advance freely.
  const canProceed = useMemo(() => {
    if (isMockMode) return true;
    const step = state.currentStep;
    if (step === 1) {
      // Raw step: requires at least one path
      return state.sources.raw.length > 0;
    }
    if (step === 3) {
      // Project step: requires at least one path
      return state.sources.project.length > 0;
    }
    return true;
  }, [state.currentStep, state.sources, isMockMode]);

  const step = state.currentStep;
  const stepMeta = STEPS[step];

  const resetWizard = useCallback(() => {
    clearWizardState();
    setState({
      currentStep: 0,
      sources: { raw: [], calibration: [], project: [], inbox: [] },
      catalogSettings: DEFAULT_CATALOG_SETTINGS,
    });
    setErrors({ raw: {}, calibration: {}, project: {}, inbox: {} });
  }, []);

  const wizardSteps = STEPS.map((s, i) => ({
    label: s.label,
    completed: i < step,
  }));

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
      {/* Folder count summary on source steps */}
      {step >= 1 && step <= 4 && totalFolders > 0 && (
        <span
          style={{
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
          }}
        >
          {totalFolders} folder{totalFolders !== 1 ? 's' : ''} selected
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
            <StepRaw
              entries={state.sources.raw}
              errors={errors.raw}
              {...makeSourceHandlers('raw')}
            />
          )}
          {step === 2 && (
            <StepCalibration
              entries={state.sources.calibration}
              errors={errors.calibration}
              {...makeSourceHandlers('calibration')}
            />
          )}
          {step === 3 && (
            <StepProject
              entries={state.sources.project}
              errors={errors.project}
              {...makeSourceHandlers('project')}
            />
          )}
          {step === 4 && (
            <StepInbox
              entries={state.sources.inbox}
              errors={errors.inbox}
              {...makeSourceHandlers('inbox')}
            />
          )}
          {step === 5 && <StepDetectTools />}
          {step === 6 && (
            <StepCatalogs
              settings={state.catalogSettings}
              onSettingsChange={handleCatalogSettingsChange}
              onSkip={() => goTo(7)}
            />
          )}
          {step === 7 && (
            <StepConfirm
              sources={state.sources}
              catalogSettings={state.catalogSettings}
              isSubmitting={isSubmitting}
            />
          )}
        </WizardShell>
      </div>
    </div>
  );
}
