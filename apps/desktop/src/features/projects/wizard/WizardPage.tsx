import { useState, useEffect } from 'react';
import { m } from '@/lib/i18n';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell, Btn } from '@/ui';
import type { WizardStep } from '@/ui';
import { StepName, type StepNameData } from './StepName';
import { StepSources, type StepSourcesData } from './StepSources';
import { StepCalibration, type CalibrationMapping } from './StepCalibration';
import { StepViews, type StepViewsData } from './StepViews';
import { StepLayout, type StepLayoutData } from './StepLayout';
import { StepReview } from './StepReview';
import { callCreateProject } from '@/features/projects/store';
import { addToast } from '@/shared/toast';
import { errMessage } from '@/lib/errors';

const STORAGE_KEY = 'alm-project-wizard-draft';

interface WizardData {
  name: StepNameData;
  sources: StepSourcesData;
  calibration: CalibrationMapping;
  views: StepViewsData;
  layout: StepLayoutData;
}

const INITIAL_DATA: WizardData = {
  name: { name: '', workflowProfile: 'pixinsight' },
  sources: { selectedSessionIds: [] },
  calibration: { flatMappings: {}, sharedDarkId: '', sharedBiasId: '', sharedDarkFlatId: '' },
  views: { strategy: 'junction' },
  layout: { namingPattern: '' },
};

function loadDraft(): WizardData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...INITIAL_DATA, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return INITIAL_DATA;
}

function saveDraft(data: WizardData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

const STEP_LABELS = [
  'Name & profile',
  'Sources (lights)',
  'Calibration',
  'Source views',
  'Naming & layout',
  'Review plan & create',
];

const PROFILE_LABELS: Record<string, string> = {
  pixinsight: 'PixInsight/WBPP',
  siril: 'Siril',
  planetary: 'planetary/lunar',
};

// Map wizard workflowProfile to the ProjectTool enum expected by the backend.
const PROFILE_TO_TOOL: Record<string, 'PixInsight' | 'Siril'> = {
  pixinsight: 'PixInsight',
  siril: 'Siril',
  planetary: 'Siril',
};

export function WizardPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>(loadDraft);
  const [creating, setCreating] = useState(false);

  // In mock mode, allow skipping all validation to walk through the wizard quickly
  const devSkip = import.meta.env.VITE_USE_MOCKS === 'true';

  // Save draft on step/data change
  useEffect(() => {
    saveDraft(wizardData);
  }, [currentStep, wizardData]);

  // Step validation — devSkip bypasses all gates so you can walk through without data
  function canAdvance(): boolean {
    if (devSkip) return true;
    switch (currentStep) {
      case 0:
        return wizardData.name.name.trim().length > 0;
      case 1:
        return wizardData.sources.selectedSessionIds.length > 0;
      case 2:
        return true; // Calibration is optional
      case 3:
        return true; // View strategy has a default
      case 4:
        return true; // Layout has defaults
      default:
        return false;
    }
  }

  function handleNext() {
    if (currentStep < STEP_LABELS.length - 1 && canAdvance()) {
      setCurrentStep(currentStep + 1);
    }
  }

  function handleBack() {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }

  function handleCancel() {
    clearDraft();
    void navigate({ to: '/projects' });
  }

  // T078c: wire actual project creation at step 5 (Review & create).
  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const tool = PROFILE_TO_TOOL[wizardData.name.workflowProfile] ?? 'PixInsight';
      // Derive a safe path from the project name (kebab-case, no special chars).
      const safeName = wizardData.name.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const path = `projects/${safeName || 'new-project'}`;

      const result = await callCreateProject({
        requestId: crypto.randomUUID(),
        name: wizardData.name.name.trim(),
        tool,
        path,
        initialSources: wizardData.sources.selectedSessionIds,
        notes: null,
      });

      clearDraft();

      if (result.planId) {
        addToast({
          message: m.projects_wizard_toast_created_plan({ name: wizardData.name.name }),
          variant: 'info',
          action: {
            label: m.projects_wizard_view_plan_btn(),
            onClick: () => void navigate({ to: '/archive', search: { selected: undefined } as never }),
          },
        });
      } else {
        addToast({ message: m.projects_wizard_toast_created({ name: wizardData.name.name }), variant: 'success' });
      }

      // Navigate back to projects list; the list re-fetches automatically.
      void navigate({ to: '/projects' });
    } catch (err: unknown) {
      const msg = errMessage(err);
      addToast({ message: m.projects_wizard_toast_failed({ msg }), variant: 'error' });
    } finally {
      setCreating(false);
    }
  }

  const steps: WizardStep[] = STEP_LABELS.map((label, i) => ({
    label,
    completed: i < currentStep,
  }));

  // Build wizard state for the review step
  const fullWizardState: Record<string, unknown> = {
    name: wizardData.name.name,
    workflow_profile: wizardData.name.workflowProfile,
    session_ids: wizardData.sources.selectedSessionIds,
    calibration: wizardData.calibration,
    source_view_strategy: wizardData.views.strategy,
    naming_pattern: wizardData.layout.namingPattern,
  };

  const projectLabel = wizardData.name.name || m.projects_create_title();
  const profileLabel = PROFILE_LABELS[wizardData.name.workflowProfile] || wizardData.name.workflowProfile;

  // Computed summary counts
  const flatsMapped = Object.values(wizardData.calibration.flatMappings).filter(Boolean).length;
  const darkSelected = wizardData.calibration.sharedDarkId ? 1 : 0;
  const biasSelected = wizardData.calibration.sharedBiasId ? 1 : 0;

  // Back / Next button labels per wireframe
  const backLabels = ['', '← Back', '← Back to sources', '← Calibration', '← Source views', '← Back'];
  const nextLabels = ['Next: sources →', 'Next: calibration →', 'Next: source views →', 'Next: naming →', 'Next: review →', ''];

  // Summary panel (right rail)
  const summary = (
    <div className="alm-wizard-page__summary">
      <div className="alm-wizard-page__summary-heading">
        {m.projects_wizard_summary_title()}
      </div>
      <div>
        <div className="alm-wizard-page__summary-project-name">{projectLabel}</div>
        <div className="alm-wizard-page__summary-profile">{profileLabel}</div>
      </div>

      <div>
        <div className="alm-wizard-page__summary-section-heading">
          {m.projects_wizard_summary_selected()}
        </div>
        <div className="alm-wizard-page__summary-list">
          <SummaryRow label={m.projects_wizard_summary_lights_label()} value={`${wizardData.sources.selectedSessionIds.length} sess`} />
          <SummaryRow label={m.projects_wizard_summary_darks_label()} value={`${darkSelected} master`} />
          <SummaryRow label={m.projects_wizard_flats_label()} value={`${flatsMapped} masters`} />
          <SummaryRow label={m.projects_wizard_bias_label()} value={`${biasSelected} master`} />
        </div>
      </div>

      {currentStep < 5 && (
        <div>
          <div className="alm-wizard-page__summary-section-heading">
            {m.projects_wizard_summary_coming_up()}
          </div>
          <div className="alm-wizard-page__summary-list">
            {STEP_LABELS.slice(currentStep + 1).map((label, i) => (
              <div
                key={label}
                className={'alm-wizard-page__coming-up-item' + (i < STEP_LABELS.length - currentStep - 2 ? ' alm-wizard-page__coming-up-item--sep' : '')}
              >
                {currentStep + i + 2}. {label}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="alm-wizard-page__footprint">
        <div className="alm-wizard-page__footprint-label">{m.projects_wizard_footprint_label()}</div>
        <div className="alm-mono alm-wizard-page__footprint-value">
          {m.projects_wizard_footprint_value()}
        </div>
        <div className="alm-wizard-page__footprint-note">
          {m.projects_wizard_footprint_note()}
        </div>
      </div>

      {/* Navigation buttons in the summary rail */}
      <div className="alm-wizard-page__summary-nav">
        {currentStep > 0 && (
          <Btn size="sm" onClick={handleBack}>
            {backLabels[currentStep]}
          </Btn>
        )}
        {currentStep < 5 && (
          <Btn variant="primary" size="sm" onClick={handleNext} disabled={!canAdvance()} className="alm-wizard-page__flex-fill">
            {nextLabels[currentStep]}
          </Btn>
        )}
        {currentStep === 5 && (
          <Btn
            variant="primary"
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || !wizardData.name.name.trim()}
            className="alm-wizard-page__flex-fill"
            data-testid="wizard-create-btn"
          >
            {creating ? m.projects_create_creating() : m.projects_create_btn()}
          </Btn>
        )}
      </div>
    </div>
  );

  // T078c layout fix: min-height: 0 prevents flex overflow that caused the
  // wizard to render at the bottom of the window instead of filling the main area.
  return (
    <div className="alm-page alm-wizard-page">
      {/* Wizard toolbar — styled consistently with other page toolbars */}
      <div className="alm-page__bar alm-wizard-page__toolbar">
        <span className="alm-wizard-page__toolbar-title">
          {m.projects_wizard_toolbar_title()} {projectLabel}
        </span>
        <span className="alm-wizard-page__spacer" />
        <Btn size="sm" onClick={() => saveDraft(wizardData)}>{m.projects_wizard_save_draft_btn()}</Btn>
        {devSkip && (
          <Btn size="sm" onClick={() => { clearDraft(); setWizardData(INITIAL_DATA); setCurrentStep(0); }}>
            {m.projects_wizard_reset_btn()}
          </Btn>
        )}
        <Btn size="sm" onClick={handleCancel}>{m.common_cancel()}</Btn>
      </div>

      {/* Sub-toolbar: workflow profile breadcrumb */}
      <div className="alm-page__bar alm-wizard-page__subbbar">
        <span>{m.projects_wizard_workflow_profile_label()} {profileLabel}</span>
        <span>&middot;</span>
        {wizardData.name.name && (
          <span>{m.projects_wizard_from_target_label()} {wizardData.name.name.split(/[\s·—]/)[0]}</span>
        )}
        <span className="alm-wizard-page__subbar-note">
          {m.projects_wizard_subbar_note()}
        </span>
      </div>

      {/* WizardShell fills the remaining space */}
      <WizardShell steps={steps} currentStep={currentStep} summary={summary} className="alm-wizard-page__flex-fill--noscroll">
        {/* Step title + description */}
        {currentStep < 5 && (
          <div className="alm-wizard-page__step-header">
            <h2 className="alm-wizard-page__step-title">
              {m.projects_wizard_step_label()} {currentStep + 1} &middot; {STEP_LABELS[currentStep]}
            </h2>
          </div>
        )}

        {/* Step content */}
        {currentStep === 0 && (
          <StepName
            data={wizardData.name}
            onChange={(name) => setWizardData({ ...wizardData, name })}
          />
        )}
        {currentStep === 1 && (
          <StepSources
            data={wizardData.sources}
            onChange={(sources) => setWizardData({ ...wizardData, sources })}
          />
        )}
        {currentStep === 2 && (
          <StepCalibration
            selectedSessionIds={wizardData.sources.selectedSessionIds}
            data={wizardData.calibration}
            onChange={(calibration) => setWizardData({ ...wizardData, calibration })}
          />
        )}
        {currentStep === 3 && (
          <StepViews
            data={wizardData.views}
            onChange={(views) => setWizardData({ ...wizardData, views })}
          />
        )}
        {currentStep === 4 && (
          <StepLayout
            data={wizardData.layout}
            nameData={wizardData.name}
            strategy={wizardData.views.strategy}
            onChange={(layout) => setWizardData({ ...wizardData, layout })}
          />
        )}
        {currentStep === 5 && <StepReview wizardState={fullWizardState} />}
      </WizardShell>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="alm-wizard-page__summary-row">
      <span className="alm-wizard-page__summary-row-label">{label}</span>
      <span className="alm-mono">{value}</span>
    </div>
  );
}
