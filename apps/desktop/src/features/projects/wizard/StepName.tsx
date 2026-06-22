import { useEffect } from 'react';
import { m } from '@/lib/i18n';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';
import { wizardNameSchema, type WizardNameValues } from '@/features/projects/schemas';

export type StepNameData = WizardNameValues;

export interface StepNameProps {
  data: StepNameData;
  onChange: (data: StepNameData) => void;
}

const PROFILES = [
  { id: 'pixinsight' as const, label: 'PixInsight / WBPP', description: 'Deep-sky processing with WeightedBatchPreProcessing' },
  { id: 'siril' as const, label: 'Siril', description: 'Free deep-sky stacking and processing' },
  { id: 'planetary' as const, label: 'Planetary / Lunar', description: 'Video-based capture with stacking tools' },
];

/**
 * StepName — spec 042 US5 (T171): RHF-backed wizard name/profile step.
 *
 * The wizard keeps its `data` / `onChange` contract so WizardPage's draft,
 * summary rail, and create payload are untouched. RHF owns the inputs locally
 * and propagates every change up via `onChange`, while `wizardNameSchema`
 * (zodResolver) drives the same "name required" message the wizard relied on.
 */
export function StepName({ data, onChange }: StepNameProps) {
  const {
    control,
    register,
    watch,
    reset,
    formState: { errors },
  } = useForm<WizardNameValues>({
    resolver: zodResolver(wizardNameSchema),
    defaultValues: data,
    mode: 'onChange',
  });

  // Push local edits back to the wizard on every change so the parent's draft
  // and summary rail stay in sync with the prior controlled behaviour.
  useEffect(() => {
    const sub = watch((value) => {
      onChange({
        name: value.name ?? '',
        workflowProfile: (value.workflowProfile ?? 'pixinsight') as StepNameData['workflowProfile'],
      });
    });
    return () => sub.unsubscribe();
  }, [watch, onChange]);

  // Re-sync if the wizard restores a different draft (e.g. Reset wizard).
  useEffect(() => {
    reset(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.name, data.workflowProfile, reset]);

  return (
    <div className="alm-wizard-name">
      {/* Project name */}
      <div className="alm-wizard-name__field-group">
        <label
          htmlFor="project-name"
          className="alm-wizard-name__label"
        >
          {m.projects_name_label()}
        </label>
        <input
          id="project-name"
          type="text"
          placeholder={m.projects_wizard_step_name_placeholder()}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'project-name-error' : undefined}
          {...register('name')}
          className="alm-wizard-name__input"
        />
        {errors.name && (
          <span
            id="project-name-error"
            role="alert"
            className="alm-wizard-name__error"
          >
            {errors.name.message}
          </span>
        )}
      </div>

      {/* Workflow profile */}
      <div className="alm-wizard-name__profile-group">
        <span className="alm-wizard-name__label">
          {m.projects_wizard_workflow_label()}
        </span>
        <Controller
          control={control}
          name="workflowProfile"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(value) => field.onChange(value as StepNameData['workflowProfile'])}
              aria-label={m.projects_wizard_workflow_label()}
              className="alm-wizard-name__radio-group"
            >
              {PROFILES.map((profile) => (
                <label
                  key={profile.id}
                  className="alm-wizard-name__profile-option"
                  data-selected={field.value === profile.id ? 'true' : 'false'}
                >
                  <Radio.Root
                    value={profile.id}
                    className="alm-radio"
                    aria-label={profile.label}
                  >
                    <Radio.Indicator className="alm-radio__indicator" />
                  </Radio.Root>
                  <div>
                    <div className="alm-wizard-name__profile-label">
                      {profile.label}
                    </div>
                    <div className="alm-wizard-name__profile-description">
                      {profile.description}
                    </div>
                  </div>
                </label>
              ))}
            </RadioGroup>
          )}
        />
      </div>
    </div>
  );
}
