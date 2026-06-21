import { useState, useEffect } from 'react';
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
          message: `Project "${wizardData.name.name}" created. Review the folder plan before applying.`,
          variant: 'info',
          action: {
            label: 'View plan',
            onClick: () => void navigate({ to: '/archive', search: { selected: undefined } as never }),
          },
        });
      } else {
        addToast({ message: `Project "${wizardData.name.name}" created.`, variant: 'success' });
      }

      // Navigate back to projects list; the list re-fetches automatically.
      void navigate({ to: '/projects' });
    } catch (err: unknown) {
      const msg = errMessage(err);
      addToast({ message: `Could not create project: ${msg}`, variant: 'error' });
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

  const projectLabel = wizardData.name.name || 'New project';
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)', fontSize: 'var(--alm-text-xs)' }}>
      <div style={{ color: 'var(--alm-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>
        Project summary
      </div>
      <div>
        <div style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}>{projectLabel}</div>
        <div style={{ color: 'var(--alm-text-muted)' }}>{profileLabel}</div>
      </div>

      <div>
        <div style={{ color: 'var(--alm-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
          What&rsquo;s selected so far
        </div>
        <div style={{ marginTop: 'var(--alm-space-2)' }}>
          <SummaryRow label="Lights" value={`${wizardData.sources.selectedSessionIds.length} sess`} />
          <SummaryRow label="Darks" value={`${darkSelected} master`} />
          <SummaryRow label="Flats" value={`${flatsMapped} masters`} />
          <SummaryRow label="Bias" value={`${biasSelected} master`} />
        </div>
      </div>

      {currentStep < 5 && (
        <div>
          <div style={{ color: 'var(--alm-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Coming up
          </div>
          <div style={{ marginTop: 'var(--alm-space-2)' }}>
            {STEP_LABELS.slice(currentStep + 1).map((label, i) => (
              <div key={label} style={{ padding: '3px 0', borderBottom: i < STEP_LABELS.length - currentStep - 2 ? '1px dotted var(--alm-border)' : 'none' }}>
                {currentStep + i + 2}. {label}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: 'var(--alm-space-3)', background: 'var(--alm-bg)', border: '1px solid var(--alm-border)' }}>
        <div style={{ color: 'var(--alm-text-muted)' }}>Estimated on-disk footprint</div>
        <div className="alm-mono" style={{ fontSize: '16px', fontWeight: 600, marginTop: 2 }}>
          ~12 KB
        </div>
        <div style={{ fontSize: '10.5px', color: 'var(--alm-text-muted)' }}>
          plan will create directories + manifest only &middot; no light frames are copied
        </div>
      </div>

      {/* Navigation buttons in the summary rail */}
      <div style={{ display: 'flex', gap: 'var(--alm-space-2)', marginTop: 'var(--alm-space-3)' }}>
        {currentStep > 0 && (
          <Btn size="sm" onClick={handleBack}>
            {backLabels[currentStep]}
          </Btn>
        )}
        {currentStep < 5 && (
          <Btn variant="primary" size="sm" onClick={handleNext} disabled={!canAdvance()} style={{ flex: 1 }}>
            {nextLabels[currentStep]}
          </Btn>
        )}
        {currentStep === 5 && (
          <Btn
            variant="primary"
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || !wizardData.name.name.trim()}
            style={{ flex: 1 }}
            data-testid="wizard-create-btn"
          >
            {creating ? 'Creating…' : 'Create project'}
          </Btn>
        )}
      </div>
    </div>
  );

  // T078c layout fix: min-height: 0 prevents flex overflow that caused the
  // wizard to render at the bottom of the window instead of filling the main area.
  return (
    <div className="alm-page" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Wizard toolbar — styled consistently with other page toolbars */}
      <div
        className="alm-page__bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--alm-space-3)',
          padding: '0 var(--alm-space-4)',
          height: 'var(--alm-toolbar-height, 44px)',
          borderBottom: '1px solid var(--alm-border)',
        }}
      >
        <span style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}>
          New project &mdash; {projectLabel}
        </span>
        <span style={{ flex: 1 }} />
        <Btn size="sm" onClick={() => saveDraft(wizardData)}>Save draft</Btn>
        {devSkip && (
          <Btn size="sm" onClick={() => { clearDraft(); setWizardData(INITIAL_DATA); setCurrentStep(0); }}>
            Reset wizard
          </Btn>
        )}
        <Btn size="sm" onClick={handleCancel}>Cancel</Btn>
      </div>

      {/* Sub-toolbar: workflow profile breadcrumb */}
      <div
        className="alm-page__bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--alm-space-2)',
          padding: '4px var(--alm-space-4)',
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          borderBottom: '1px solid var(--alm-border)',
        }}
      >
        <span>Workflow profile: {profileLabel}</span>
        <span>&middot;</span>
        {wizardData.name.name && (
          <span>From target context: {wizardData.name.name.split(/[\s·—]/)[0]}</span>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--alm-text-faint)' }}>
          Sources are selected here; the filesystem plan is shown at step 6 before anything is created.
        </span>
      </div>

      {/* WizardShell fills the remaining space */}
      <WizardShell steps={steps} currentStep={currentStep} summary={summary} style={{ flex: 1, minHeight: 0 }}>
        {/* Step title + description */}
        {currentStep < 5 && (
          <div style={{ marginBottom: 'var(--alm-space-5)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
              Step {currentStep + 1} &middot; {STEP_LABELS[currentStep]}
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
    <div style={{ padding: '3px 0', borderBottom: '1px dotted var(--alm-border)', display: 'flex' }}>
      <span style={{ flex: 1 }}>{label}</span>
      <span className="alm-mono">{value}</span>
    </div>
  );
}
