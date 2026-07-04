import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell } from '@/ui/WizardShell';
import { Btn } from '@/ui/Btn';
import { m } from '@/lib/i18n';
import { setPreference } from '@/data/preferences';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import {
  StepSourceFolders,
  StepTools,
  StepCatalogs,
  StepConfirm,
  StepScan,
  DEFAULT_CATALOG_SETTINGS,
  DEFAULT_TOOLS_STATE,
} from './steps';
import type { CatalogSettings, ToolsState } from './steps';
import type { SourcesState, SourceKind, ScanDepth, OrganizationState } from './sources-store';
import type { FlushResult } from './sources-store';
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
    label: () => m.setup_step_sources_label(),
    heading: () => m.setup_step_sources_heading(),
    description: () => m.setup_step_sources_desc(),
  },
  {
    label: () => m.setup_step_tools_label(),
    heading: () => m.setup_step_tools_heading(),
    description: () => m.setup_step_tools_desc(),
  },
  {
    // Step 3: label and heading share the same key (identical text).
    label: () => m.setup_step_config_label_heading(),
    heading: () => m.setup_step_config_label_heading(),
    description: () => m.setup_step_config_desc(),
  },
  {
    label: () => m.setup_step_confirm_label(),
    heading: () => m.setup_step_confirm_heading(),
    description: () => m.setup_step_confirm_desc(),
  },
  {
    label: () => m.setup_step_scan_label(),
    heading: () => m.setup_step_scan_heading(),
    description: () => m.setup_step_scan_desc(),
  },
];

// Index of the Scan step (last step).
const SCAN_STEP = STEPS.length - 1;

function loadWizardState(): WizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // If persisted state had the wizard already at the scan step, reset to
      // confirm so the scan always starts fresh (avoids stale scan guard).
      const currentStep = parsed.currentStep === SCAN_STEP
        ? SCAN_STEP - 1
        : (parsed.currentStep ?? 0);
      return {
        currentStep,
        sources: Array.isArray(parsed.sources) ? parsed.sources : loadSources(),
        // Migrate/guard: older persisted state used `{ downloadAll }` (no
        // `selectedCatalogIds`); coerce any shape lacking the array to the default so
        // consumers reading `selectedCatalogIds.length` never hit `undefined`.
        catalogSettings: Array.isArray(parsed.catalogSettings?.selectedCatalogIds)
          ? parsed.catalogSettings
          : DEFAULT_CATALOG_SETTINGS,
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
    // Intentional ignore: clearing persisted wizard state is best-effort;
    // localStorage may be unavailable (private mode / quota) and a failure here
    // does not affect the in-progress setup flow.
  }
}

export function SetupWizard() {
  const navigate = useNavigate();
  const [state, setState] = useState<WizardState>(loadWizardState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});

  // flushResult is set when the user advances from Confirm → Scan so StepScan
  // can use the registered rootIds.  Null until flushToDB has been called.
  const [flushResult, setFlushResult] = useState<FlushResult | null>(null);

  // Persist wizard progress on every state change.
  // The Scan step (SCAN_STEP) is intentionally NOT persisted — persisting it
  // would require restoring scan state across sessions, which we don't support.
  // loadWizardState() guards against this by resetting to Confirm.
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
        const conflictKind = dedup.crossKindConflict;
        setErrors((prev) => ({
          ...prev,
          [state.sources.length]: m.setup_sources_error_registered_under({ kind: conflictKind }),
        }));
        return;
      }
      if (dedup.sameKindDuplicate) {
        setErrors((prev) => ({
          ...prev,
          [state.sources.length]: m.setup_sources_error_already_added(),
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

  const handleOrganizationStateChange = useCallback(
    (index: number, orgState: OrganizationState) => {
      setState((prev) => {
        const next = [...prev.sources];
        const entry = next[index];
        // Inbox sources are always unorganized — the UI hides the control for them,
        // but guard here too so the state stays consistent.
        if (entry && entry.kind !== 'inbox') {
          next[index] = { ...entry, organizationState: orgState };
        }
        return { ...prev, sources: next };
      });
    },
    [],
  );

  // Derived folder count for footer
  const totalFolders = state.sources.length;

  // Called from the Confirm step footer: register roots, then advance to Scan.
  const handleEnterScan = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const result = await flushToDB(state.sources);

      if (!result.allSucceeded) {
        console.warn('Some source registrations failed:', result.results.filter((r) => !r.success));
      }

      setFlushResult(result);
      goTo(SCAN_STEP);
    } catch (err) {
      console.error('Failed to register sources:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [state.sources, goTo]);

  // Tracks whether all sources on the Scan step have finished (done/error).
  // Updated via StepScan's onAllDoneChange callback and used to enable the
  // Finish button in the shared footer.
  const [scanComplete, setScanComplete] = useState(false);

  // Called from StepScan's Finish button: complete first-run and navigate.
  const handleFinish = useCallback(async () => {
    setIsFinishing(true);
    try {
      if (!isMockMode) {
        // Persist processing-tool config from the wizard so Settings →
        // Processing Tools reflects whatever the user set in Step 2.
        const toolEntries: Array<{ id: string; enabled: boolean; path: string | null }> = [
          { id: 'pixinsight', enabled: state.tools.pixinsight.enabled, path: state.tools.pixinsight.path },
          { id: 'siril', enabled: state.tools.siril.enabled, path: state.tools.siril.path },
        ];
        await Promise.all(
          toolEntries.map(async (t) =>
            unwrap(await commands.toolsUpdate({ id: t.id, enabled: t.enabled, path: t.path })),
          ),
        );

        unwrap(await commands.firstrunComplete());
      }

      setPreference('setupCompleted', true);
      clearWizardState();
      void navigate({ to: '/inbox' });
    } catch {
      setIsFinishing(false);
    }
  }, [isMockMode, navigate]);

  // Determine whether "Continue" should be enabled.
  // Step 0 (Source Folders) and step 3 (Confirm) require all required folder kinds.
  // All other intermediate steps advance freely.
  // The Scan step (SCAN_STEP) uses the shared footer Finish button, which is
  // enabled by scanComplete — canProceed is not consulted for that step.
  const canProceed = useMemo(() => {
    if (isMockMode) return true;
    const step = state.currentStep;
    if (step === 0 || step === SCAN_STEP - 1) {
      return getMissingRequiredKinds(state.sources).length === 0;
    }
    return true;
  }, [state.currentStep, state.sources, isMockMode]);

  const step = state.currentStep;
  const stepMeta = STEPS[step];

  const wizardSteps = STEPS.map((s, i) => ({
    label: s.label(),
    completed: i < step,
  }));

  const isOnScanStep = step === SCAN_STEP;

  // Build the navigation footer for the current step.
  // The Scan step (SCAN_STEP) now renders Back + Finish here, consistent with
  // every other step; StepScan no longer owns its own action buttons.
  const footer = (
    <>
      {step > 0 ? (
        <Btn
          variant="ghost"
          onClick={() => goTo(isOnScanStep ? SCAN_STEP - 1 : step - 1)}
          disabled={isSubmitting || isFinishing}
        >
          {m.setup_wizard_back()}
        </Btn>
      ) : (
        <span />
      )}
      <div className="alm-setup-wizard__footer-spacer" />
      {/* Folder count summary on source step */}
      {step === 0 && totalFolders > 0 && (
        <span className="alm-setup-wizard__folder-count">
          {m.setup_wizard_folder_count({ count: totalFolders })}
        </span>
      )}
      {isOnScanStep ? (
        // Scan step: Finish navigates to /inbox after completing first-run.
        // Enabled only once all source scans are done (or errored).
        <Btn
          data-testid="finish-button"
          variant="primary"
          onClick={() => { void handleFinish(); }}
          disabled={!scanComplete || isFinishing}
        >
          {isFinishing ? m.setup_wizard_finishing() : m.setup_wizard_finish()}
        </Btn>
      ) : step < SCAN_STEP - 1 ? (
        // Steps 0–2: "Continue to <next>"
        <Btn
          variant="primary"
          onClick={() => goTo(step + 1)}
          disabled={!canProceed}
        >
          {m.setup_wizard_continue_to({ label: STEPS[step + 1].label().toLowerCase() })}
        </Btn>
      ) : (
        // Step 3 (Confirm): register + enter Scan
        <Btn
          variant="primary"
          onClick={() => { void handleEnterScan(); }}
          disabled={isSubmitting || !canProceed}
        >
          {isSubmitting ? m.setup_wizard_registering() : m.setup_wizard_start_scan()}
        </Btn>
      )}
    </>
  );

  return (
    // Layout fix (mirrors the project wizard): flex column + minHeight:0 so the
    // WizardShell fills the main content area instead of overflowing/mis-placing.
    <div
      className="alm-page alm-setup-wizard"
    >
      <WizardShell steps={wizardSteps} currentStep={step} footer={footer} className="alm-setup-wizard__shell">
        {/* Step label + heading */}
        <div className="alm-setup-wizard__step-label">
          {m.setup_wizard_step_label({ step: step + 1, total: STEPS.length })}
        </div>
        <h1 className="alm-setup-wizard__heading">
          {stepMeta.heading()}
        </h1>
        {stepMeta.description && (
          <p className="alm-setup-wizard__description">
            {stepMeta.description()}
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
              onOrganizationStateChange={handleOrganizationStateChange}
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
          {step === SCAN_STEP && flushResult && (
            <StepScan
              sources={state.sources}
              flushResult={flushResult}
              onAllDoneChange={setScanComplete}
            />
          )}
      </WizardShell>
    </div>
  );
}
