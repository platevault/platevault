import { useState, useEffect } from 'react';
import { WizardShell, Btn } from '@/ui';
import type { WizardStep } from '@/ui';
import { StepName, type StepNameData } from './StepName';
import { StepSources, type StepSourcesData } from './StepSources';
import { StepCalibration, type CalibrationMapping } from './StepCalibration';
import { StepViews, type StepViewsData, type SourceViewStrategy } from './StepViews';
import { StepLayout, type StepLayoutData } from './StepLayout';
import { StepReview } from './StepReview';

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
  views: { strategy: 'symlink' },
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
  'Sources',
  'Calibration',
  'Source views',
  'Naming & layout',
  'Review plan',
];

export function WizardPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>(loadDraft);

  // Save draft on step change
  useEffect(() => {
    saveDraft(wizardData);
  }, [currentStep, wizardData]);

  // Step validation
  function canAdvance(): boolean {
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

  // Summary for right rail
  const summary = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)', fontSize: 'var(--alm-text-xs)' }}>
      <h4 style={{ margin: 0, fontSize: 'var(--alm-text-xs)', fontWeight: 600, color: 'var(--alm-text-muted)', textTransform: 'uppercase' }}>
        Summary
      </h4>
      {wizardData.name.name && (
        <div>
          <span style={{ color: 'var(--alm-text-muted)' }}>Name: </span>
          <strong>{wizardData.name.name}</strong>
        </div>
      )}
      <div>
        <span style={{ color: 'var(--alm-text-muted)' }}>Profile: </span>
        <strong>{wizardData.name.workflowProfile}</strong>
      </div>
      <div>
        <span style={{ color: 'var(--alm-text-muted)' }}>Sessions: </span>
        <strong>{wizardData.sources.selectedSessionIds.length}</strong>
      </div>
      <div>
        <span style={{ color: 'var(--alm-text-muted)' }}>Flats mapped: </span>
        <strong>{Object.values(wizardData.calibration.flatMappings).filter(Boolean).length}</strong>
      </div>
      <div>
        <span style={{ color: 'var(--alm-text-muted)' }}>View strategy: </span>
        <strong>{wizardData.views.strategy}</strong>
      </div>
    </div>
  );

  return (
    <div className="alm-page" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <WizardShell steps={steps} currentStep={currentStep} summary={summary}>
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

        {/* Navigation */}
        {currentStep < 5 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--alm-space-7)', paddingTop: 'var(--alm-space-5)', borderTop: '1px solid var(--alm-border)' }}>
            <Btn variant="ghost" onClick={handleBack} disabled={currentStep === 0}>
              Back
            </Btn>
            <Btn variant="primary" onClick={handleNext} disabled={!canAdvance()}>
              Next
            </Btn>
          </div>
        )}
      </WizardShell>
    </div>
  );
}
