import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell } from '@/ui/WizardShell';
import { Btn } from '@/ui/Btn';
import { setPreference } from '@/data/preferences';
import { completeFirstRun } from '@/api/commands';
import {
  StepSourceFolders,
  StepTools,
  StepCatalogs,
  StepConfirm,
  DEFAULT_CATALOG_SETTINGS,
  DEFAULT_TOOLS_STATE,
} from './steps';
import type { CatalogSettings, ToolsState } from './steps';
import type { SourcesState, SourceKind, ScanDepth } from './sources-store';
import {
  loadSources,
  saveSources,
  addSource,
  removeSource,
  checkDeduplication,
  validatePath,
  flushToDB,
  getMissingRequiredKinds,
} from './sources-store';

const STORAGE_KEY = 'alm-setup-wizard-state';

interface WizardState {
  currentStep: number;
  sources: SourcesState;
  catalogSettings: CatalogSettings;
  tools: ToolsState;
}

const STEPS = [
  {
    label: 'Source Folders',
    heading: 'Where does your data live?',
    description: 'Add the folders where your light frames, calibration frames, projects, and incoming captures are stored.',
  },
  {
    label: 'Processing Tools',
    heading: 'Processing tools',
    description: 'Configure the astrophotography processing tools installed on your system.',
  },
  {
    label: 'Catalogs',
    heading: 'Target catalogs',
    description: 'Choose which astronomical catalogs to use for resolving object names in your files.',
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
      return {
        currentStep: parsed.currentStep ?? 0,
        sources: Array.isArray(parsed.sources) ? parsed.sources : loadSources(),
        catalogSettings: parsed.catalogSettings ?? DEFAULT_CATALOG_SETTINGS,
        tools: parsed.tools ?? DEFAULT_TOOLS_STATE,
      };
    }
  } catch {
    // corrupt or stale state -- start fresh
  }
  return {
    currentStep: 0,
    sources: loadSources(),
    catalogSettings: DEFAULT_CATALOG_SETTINGS,
    tools: DEFAULT_TOOLS_STATE,
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
  const [errors, setErrors] = useState<Record<number, string>>({});

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

  const handleToolsChange = useCallback((tools: ToolsState) => {
    setState((prev) => ({ ...prev, tools }));
  }, []);

  const isMockMode = import.meta.env.VITE_USE_MOCKS === 'true';

  // --- Source management ---
  const handleAddSource = useCallback(
    async (path: string, kind: SourceKind) => {
      // Deduplication check
      const dedup = checkDeduplication(state.sources, kind, path);
      if (dedup.crossKindConflict) {
        setErrors((prev) => ({
          ...prev,
          [state.sources.length]: `This directory is registered under ${dedup.crossKindConflict}`,
        }));
        return;
      }
      if (dedup.sameKindDuplicate) {
        setErrors((prev) => ({
          ...prev,
          [state.sources.length]: 'This directory is already added',
        }));
        return;
      }

      // Client-side validation
      const validationError = validatePath(state.sources, path, kind);
      if (validationError) {
        setState((prev) => ({
          ...prev,
          sources: addSource(prev.sources, kind, path),
        }));
        setErrors((prev) => ({
          ...prev,
          [state.sources.length]: validationError.message,
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        sources: addSource(prev.sources, kind, path),
      }));
      // Clear any error for this index
      setErrors((prev) => {
        const next = { ...prev };
        delete next[state.sources.length];
        return next;
      });
    },
    [state.sources],
  );

  const handleRemoveSource = useCallback(
    (index: number) => {
      setState((prev) => ({
        ...prev,
        sources: removeSource(prev.sources, prev.sources[index]?.kind ?? 'light_frames', index),
      }));
      // Clear error for removed index and reindex remaining errors
      setErrors((prev) => {
        const newErrors: Record<number, string> = {};
        for (const [key, value] of Object.entries(prev)) {
          const idx = Number(key);
          if (idx < index) newErrors[idx] = value;
          else if (idx > index) newErrors[idx - 1] = value;
        }
        return newErrors;
      });
    },
    [],
  );

  const handleKindChange = useCallback(
    (index: number, kind: SourceKind) => {
      setState((prev) => {
        const next = [...prev.sources];
        next[index] = { ...next[index], kind };
        return { ...prev, sources: next };
      });
    },
    [],
  );

  const handleScanDepthChange = useCallback(
    (index: number, depth: ScanDepth) => {
      setState((prev) => {
        const next = [...prev.sources];
        next[index] = { ...next[index], scanDepth: depth };
        return { ...prev, sources: next };
      });
    },
    [],
  );

  // Derived folder count for footer
  const totalFolders = state.sources.length;

  const handleComplete = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const flushResult = await flushToDB(state.sources);

      if (!flushResult.allSucceeded) {
        console.warn('Some source registrations failed:', flushResult.results.filter((r) => !r.success));
      }

      if (!isMockMode) {
        await completeFirstRun();
      }

      setPreference('setupCompleted', true);
      clearWizardState();
      void navigate({ to: '/inbox' });
    } catch {
      setIsSubmitting(false);
    }
  }, [state.sources, isMockMode, navigate]);

  // Determine whether "Continue" should be enabled
  // Step 0 (Source Folders) requires at least one light_frames and one project folder.
  // All other steps advance freely.
  const canProceed = useMemo(() => {
    if (isMockMode) return true;
    const step = state.currentStep;
    if (step === 0) {
      return getMissingRequiredKinds(state.sources).length === 0;
    }
    // On the confirm step, also gate on required folders
    if (step === 3) {
      return getMissingRequiredKinds(state.sources).length === 0;
    }
    return true;
  }, [state.currentStep, state.sources, isMockMode]);

  const step = state.currentStep;
  const stepMeta = STEPS[step];

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
      <div className="alm-wizard-footer__spacer" />
      {/* Folder count summary on source step */}
      {step === 0 && totalFolders > 0 && (
        <span className="alm-wizard-footer__count">
          {totalFolders} folder{totalFolders !== 1 ? 's' : ''} selected
        </span>
      )}
      {step < STEPS.length - 1 ? (
        <Btn
          variant="primary"
          onClick={() => goTo(step + 1)}
          disabled={!canProceed}
        >
          Continue to {STEPS[step + 1].label.toLowerCase()} &rarr;
        </Btn>
      ) : (
        <Btn
          variant="primary"
          onClick={handleComplete}
          disabled={isSubmitting || !canProceed}
        >
          {isSubmitting ? 'Setting up...' : 'Complete setup'}
        </Btn>
      )}
    </>
  );

  return (
    <div className="alm-wizard-wrapper">
      <div className="alm-wizard-wrapper__inner">
        <WizardShell steps={wizardSteps} currentStep={step} footer={footer}>
          {/* Step label + heading */}
          <div className="alm-wizard__step-label">
            Setup &middot; Step {step + 1} of {STEPS.length}
          </div>
          <h1 className="alm-wizard__step-heading">
            {stepMeta.heading}
          </h1>
          {stepMeta.description && (
            <p className="alm-wizard__step-description">
              {stepMeta.description}
            </p>
          )}

          {/* Step body */}
          {step === 0 && (
            <StepSourceFolders
              entries={state.sources}
              errors={errors}
              onAdd={handleAddSource}
              onRemove={handleRemoveSource}
              onKindChange={handleKindChange}
              onScanDepthChange={handleScanDepthChange}
            />
          )}
          {step === 1 && (
            <StepTools
              tools={state.tools}
              onToolsChange={handleToolsChange}
            />
          )}
          {step === 2 && (
            <StepCatalogs
              settings={state.catalogSettings}
              onSettingsChange={handleCatalogSettingsChange}
            />
          )}
          {step === 3 && (
            <StepConfirm
              sources={state.sources}
              catalogSettings={state.catalogSettings}
              tools={state.tools}
              isSubmitting={isSubmitting}
            />
          )}
        </WizardShell>
      </div>
    </div>
  );
}
