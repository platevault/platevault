// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell } from '@/ui/WizardShell';
import { Btn } from '@/ui/Btn';
import { Banner } from '@/ui';
import { m } from '@/lib/i18n';
import { setPreference } from '@/data/preferences';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { errMessage } from '@/lib/errors';
import {
  StepSourceFolders,
  StepTools,
  StepCatalogs,
  StepSite,
  StepConfirm,
  StepScan,
  DEFAULT_CATALOG_SETTINGS,
  DEFAULT_TOOLS_STATE,
  DEFAULT_SITE_STEP_STATE,
  SITE_STEP_DEFAULT_TWILIGHT,
  SITE_STEP_DEFAULT_MIN_HORIZON_ALT_DEG,
  siteStepHasSite,
  siteStepError,
} from './steps';
import type { CatalogSettings, ToolsState, SiteStepState } from './steps';
import type {
  SourcesState,
  SourceKind,
  OrganizationState,
} from './sources-store';
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
import { saveSites } from '@/features/targets/observing-sites/site-store';
import type { ObserverSite } from '@/features/targets/observing-sites/observer-site';

function newSiteId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `site-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const STORAGE_KEY = 'alm-setup-wizard-state';

interface WizardState {
  currentStep: number;
  sources: SourcesState;
  catalogSettings: CatalogSettings;
  tools: ToolsState;
  site: SiteStepState;
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
    label: () => m.setup_step_site_label(),
    heading: () => m.setup_step_site_heading(),
    description: () => m.setup_step_site_desc(),
  },
  {
    label: () => m.common_confirm(),
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

// Index of the (optional) Observing Site step.
const SITE_STEP = 3;

function loadWizardState(): WizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      // Persisted state is untrusted JSON; type it as a partial of the runtime
      // shape so field access is checked while the guards below still coerce
      // any missing/legacy fields to defaults.
      const parsed = JSON.parse(raw) as Partial<WizardState>;
      // If persisted state had the wizard already at the scan step, reset to
      // confirm so the scan always starts fresh (avoids stale scan guard).
      const currentStep =
        parsed.currentStep === SCAN_STEP
          ? SCAN_STEP - 1
          : (parsed.currentStep ?? 0);
      return {
        currentStep,
        sources: Array.isArray(parsed.sources) ? parsed.sources : loadSources(),
        // Guard: accept persisted catalogSettings only if it matches the current
        // shape (`{ downloadAll }`); older/corrupt shapes fall back to the default.
        catalogSettings:
          typeof parsed.catalogSettings?.downloadAll === 'boolean'
            ? parsed.catalogSettings
            : DEFAULT_CATALOG_SETTINGS,
        tools: parsed.tools ?? DEFAULT_TOOLS_STATE,
        // spec 044 T016: older persisted state (pre-Site step) has no `site`
        // key — default to the empty (skippable) step state.
        site: parsed.site ?? DEFAULT_SITE_STEP_STATE,
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
    site: DEFAULT_SITE_STEP_STATE,
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
  // Wizard-level submit error (source registration / finish), surfaced as a
  // Banner in the step body. Previously these failures were console-only.
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const handleCatalogSettingsChange = useCallback(
    (catalogSettings: CatalogSettings) => {
      setState((prev) => ({ ...prev, catalogSettings }));
    },
    [],
  );

  const handleToolsChange = useCallback((tools: ToolsState) => {
    setState((prev) => ({ ...prev, tools }));
  }, []);

  // Skipping the (optional) Observing Site step is acknowledged, not blocked:
  // the first Continue on an empty step surfaces the consequence, the second
  // proceeds. Spec 044 T016 keeps the step optional on purpose — a user may
  // not have coordinates to hand — but silently skipping it leaves the Targets
  // planner unable to compute visibility, which is invisible until they reach
  // that page (#1050).
  const [siteSkipAcked, setSiteSkipAcked] = useState(false);

  const handleSiteChange = useCallback((site: SiteStepState) => {
    setState((prev) => ({ ...prev, site }));
    // Editing the step withdraws a previous "skip anyway" acknowledgement, so
    // clearing the fields again re-arms the warning rather than silently
    // inheriting the earlier consent.
    setSiteSkipAcked(false);
  }, []);

  const isMockMode = import.meta.env.VITE_USE_MOCKS === 'true';

  // --- Source management ---
  const handleAddSource = useCallback(
    (path: string, kind: SourceKind) => {
      // Deduplication check
      const dedup = checkDeduplication(state.sources, kind, path);
      if (dedup.crossKindConflict) {
        const conflictKind = dedup.crossKindConflict;
        setErrors((prev) => ({
          ...prev,
          [state.sources.length]: m.setup_sources_error_registered_under({
            kind: conflictKind,
          }),
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

  const handleRemoveSource = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      sources: removeSource(
        prev.sources,
        prev.sources[index]?.kind ?? 'light_frames',
        index,
      ),
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
  }, []);

  const handleKindChange = useCallback((index: number, kind: SourceKind) => {
    setState((prev) => {
      const next = [...prev.sources];
      next[index] = { ...next[index], kind };
      return { ...prev, sources: next };
    });
  }, []);

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
    setSubmitError(null);
    try {
      const result = await flushToDB(state.sources);

      // Issue #704: the restart flow pre-fills already-registered folders, and
      // a mixed batch may add new folders alongside them. An "already
      // registered" item is the desired end state, not a failure — only a
      // genuine registration failure (invalid path, overlap, DB error) should
      // block advancing. Previously ANY non-success item (including benign
      // already-registered ones) stuck the wizard on Confirm behind a
      // misleading "batch failed" banner while newly-added folders were still
      // silently written to the DB.
      const genuineFailures = result.results.filter(
        (r) => !r.success && !r.alreadyRegistered,
      );
      if (genuineFailures.length > 0) {
        const detail =
          genuineFailures
            .map((r) => r.error)
            .filter(Boolean)
            .join('; ') || String(genuineFailures.length);
        setSubmitError(
          m.setup_sources_error_batch_registration_failed({ message: detail }),
        );
        return;
      }

      setFlushResult(result);
      goTo(SCAN_STEP);
    } catch (err) {
      setSubmitError(
        m.setup_sources_error_batch_registration_failed({
          message: errMessage(err),
        }),
      );
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
    setSubmitError(null);
    try {
      if (!isMockMode) {
        // Persist processing-tool config from the wizard so Settings →
        // Processing Tools reflects whatever the user set in Step 2.
        const toolEntries: Array<{
          id: string;
          enabled: boolean;
          path: string | null;
        }> = [
          {
            id: 'pixinsight',
            enabled: state.tools.pixinsight.enabled,
            path: state.tools.pixinsight.path,
          },
          {
            id: 'siril',
            enabled: state.tools.siril.enabled,
            path: state.tools.siril.path,
          },
        ];
        await Promise.all(
          toolEntries.map(async (t) =>
            unwrap(
              await commands.toolsUpdate({
                id: t.id,
                enabled: t.enabled,
                path: t.path,
              }),
            ),
          ),
        );

        // spec 044 T016: the Observing Site step is optional (FR-025 never
        // blocks Finish); only persist a site when the user actually filled
        // one in and it validates. Becomes both the default AND the active
        // site (US6 continuity — no-site state is skipped entirely rather
        // than requiring a separate "make active" step post-setup).
        if (siteStepHasSite(state.site)) {
          const site: ObserverSite = {
            id: newSiteId(),
            name: state.site.name.trim(),
            latitudeDeg: Number(state.site.latitudeDegText.trim()),
            longitudeDeg: Number(state.site.longitudeDegText.trim()),
            elevationM:
              state.site.elevationMText.trim() === ''
                ? null
                : Number(state.site.elevationMText.trim()),
            timezone: state.site.timezone,
            twilight: SITE_STEP_DEFAULT_TWILIGHT,
            minHorizonAltDeg: SITE_STEP_DEFAULT_MIN_HORIZON_ALT_DEG,
          };
          await saveSites([site], site.id, site.id);
        }

        unwrap(await commands.firstrunComplete());
      }

      setPreference('setupCompleted', true);
      clearWizardState();
      void navigate({ to: '/inbox' });
    } catch (err) {
      setSubmitError(
        m.setup_wizard_finish_failed({ message: errMessage(err) }),
      );
      setIsFinishing(false);
    }
    // `state.tools` was already read here without being a dependency (stale
    // closure risk pre-dating this change); adding `state.site` for the new
    // T016 persistence surfaced it, so both are listed now for correctness.
  }, [isMockMode, navigate, state.tools, state.site]);

  // Validation gate for a given step index. Step 0 (Source Folders) and the
  // Confirm step require all required folder kinds; the Observing Site step
  // (T016) must be internally consistent (FR-025 never blocks, but a partially
  // filled-in, out-of-range site can't silently proceed). Every other step
  // advances freely. Used both for "Continue" and for validation-gated forward
  // step-tab jumps (issue #512).
  const isStepValid = useCallback(
    (i: number): boolean => {
      if (isMockMode) return true;
      if (i === 0 || i === SCAN_STEP - 1) {
        return getMissingRequiredKinds(state.sources).length === 0;
      }
      if (i === SITE_STEP) {
        return siteStepError(state.site) === null;
      }
      return true;
    },
    [state.sources, state.site, isMockMode],
  );

  const step = state.currentStep;

  // Whether the step-tab for index `i` can be jumped to from the current step
  // (issue #512): backward/visited steps are always free; a forward jump is
  // allowed only when every step between here and the target validates; the
  // Scan step is never a jump target (reaching it runs registration via the
  // "Start scan" action, not a plain navigation).
  const isStepReachable = useCallback(
    (i: number): boolean => {
      if (i === step) return true;
      if (i < step) return true;
      if (i >= SCAN_STEP) return false;
      for (let j = step; j < i; j++) {
        if (!isStepValid(j)) return false;
      }
      return true;
    },
    [step, isStepValid],
  );

  const isOnScanStep = step === SCAN_STEP;

  const handleStepSelect = useCallback(
    (i: number) => {
      if (i === step || isOnScanStep || !isStepReachable(i)) return;
      goTo(i);
    },
    [step, isOnScanStep, isStepReachable, goTo],
  );

  // The Scan step (SCAN_STEP) uses the shared footer Finish button, which is
  // enabled by scanComplete — canProceed is not consulted for that step.
  const canProceed = isStepValid(step);

  // True while the user is sitting on an empty Observing Site step and has not
  // yet acknowledged skipping it. Drives both the warning banner and the
  // Continue button's label/behaviour.
  const siteSkipNeedsAck =
    step === SITE_STEP && !siteStepHasSite(state.site) && !siteSkipAcked;

  const stepMeta = STEPS[step];

  const wizardSteps = STEPS.map((s, i) => ({
    label: s.label(),
    completed: i < step,
    disabled: !isStepReachable(i),
  }));

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
      <div className="pv-setup-wizard__footer-spacer" />
      {/* Folder count summary on source step */}
      {step === 0 && totalFolders > 0 && (
        <span className="pv-setup-wizard__folder-count">
          {m.setup_wizard_folder_count({ count: totalFolders })}
        </span>
      )}
      {isOnScanStep ? (
        // Scan step: Finish navigates to /inbox after completing first-run.
        // Enabled only once all source scans are done (or errored).
        <Btn
          data-testid="finish-button"
          variant="primary"
          onClick={() => {
            void handleFinish();
          }}
          disabled={!scanComplete || isFinishing}
        >
          {isFinishing ? m.setup_wizard_finishing() : m.setup_wizard_finish()}
        </Btn>
      ) : step < SCAN_STEP - 1 ? (
        // Steps 0–2: "Continue to <next>"
        <Btn
          variant="primary"
          onClick={() => {
            // First click on an empty site step only acknowledges the skip;
            // the banner it reveals explains what is lost. Second click moves on.
            if (siteSkipNeedsAck) {
              setSiteSkipAcked(true);
              return;
            }
            goTo(step + 1);
          }}
          disabled={!canProceed}
          data-testid={siteSkipNeedsAck ? 'setup-site-skip-ack' : undefined}
        >
          {siteSkipNeedsAck
            ? m.setup_wizard_continue_without_site()
            : m.setup_wizard_continue_to({
                label: STEPS[step + 1].label().toLowerCase(),
              })}
        </Btn>
      ) : (
        // Step 3 (Confirm): register + enter Scan
        <Btn
          variant="primary"
          onClick={() => {
            void handleEnterScan();
          }}
          disabled={isSubmitting || !canProceed}
        >
          {isSubmitting
            ? m.setup_wizard_registering()
            : m.setup_wizard_start_scan()}
        </Btn>
      )}
    </>
  );

  return (
    // Layout fix (mirrors the project wizard): flex column + minHeight:0 so the
    // WizardShell fills the main content area instead of overflowing/mis-placing.
    <div className="pv-page pv-setup-wizard">
      <WizardShell
        steps={wizardSteps}
        currentStep={step}
        footer={footer}
        // Scan runs registration side-effects on entry, so disable step-tab
        // navigation while on it (Back button still works) — issue #512.
        onStepSelect={isOnScanStep ? undefined : handleStepSelect}
        className="pv-setup-wizard__shell"
      >
        {/* Step label + heading */}
        <div className="pv-setup-wizard__step-label">
          {m.setup_wizard_step_label({ step: step + 1, total: STEPS.length })}
        </div>
        <h1 className="pv-setup-wizard__heading">{stepMeta.heading()}</h1>
        {stepMeta.description && (
          <p className="pv-setup-wizard__description">
            {stepMeta.description()}
          </p>
        )}

        {/* Wizard-level submit error (source registration / finish failures) */}
        {submitError && (
          <Banner variant="danger" data-testid="setup-submit-error">
            {submitError}
          </Banner>
        )}

        {/* Step body */}
        {step === 0 && (
          <StepSourceFolders
            entries={state.sources}
            errors={errors}
            onAdd={handleAddSource}
            onRemove={handleRemoveSource}
            onKindChange={handleKindChange}
            onOrganizationStateChange={handleOrganizationStateChange}
          />
        )}
        {step === 1 && (
          <StepTools tools={state.tools} onToolsChange={handleToolsChange} />
        )}
        {step === 2 && (
          <StepCatalogs
            settings={state.catalogSettings}
            onSettingsChange={handleCatalogSettingsChange}
          />
        )}
        {step === SITE_STEP && (
          <>
            <StepSite state={state.site} onChange={handleSiteChange} />
            {siteSkipAcked && !siteStepHasSite(state.site) && (
              <Banner variant="warn" data-testid="setup-site-skip-warning">
                {m.setup_step_site_skip_warning()}
              </Banner>
            )}
          </>
        )}
        {step === 4 && (
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
