import { useEffect } from 'react';
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Project name */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}>
        <label
          htmlFor="project-name"
          style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}
        >
          Project name
        </label>
        <input
          id="project-name"
          type="text"
          placeholder="e.g. NGC 7000 — HOO Narrowband"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'project-name-error' : undefined}
          {...register('name')}
          style={{
            padding: 'var(--alm-space-2) var(--alm-space-3)',
            border: '1px solid var(--alm-border)',
            borderRadius: 4,
            fontSize: 'var(--alm-text-sm)',
            background: 'var(--alm-surface)',
            color: 'var(--alm-text)',
          }}
        />
        {errors.name && (
          <span
            id="project-name-error"
            role="alert"
            style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-danger, #c0392b)' }}
          >
            {errors.name.message}
          </span>
        )}
      </div>

      {/* Workflow profile */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)' }}>
        <span style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}>
          Workflow profile
        </span>
        <Controller
          control={control}
          name="workflowProfile"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(value) => field.onChange(value as StepNameData['workflowProfile'])}
              aria-label="Workflow profile"
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}
            >
              {PROFILES.map((profile) => (
                <label
                  key={profile.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--alm-space-3)',
                    padding: 'var(--alm-space-3)',
                    border: `1px solid ${field.value === profile.id ? 'var(--alm-gray-900)' : 'var(--alm-border)'}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: field.value === profile.id ? 'var(--alm-surface)' : 'transparent',
                  }}
                >
                  <Radio.Root
                    value={profile.id}
                    className="alm-radio"
                    aria-label={profile.label}
                  >
                    <Radio.Indicator className="alm-radio__indicator" />
                  </Radio.Root>
                  <div>
                    <div style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 500 }}>
                      {profile.label}
                    </div>
                    <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
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
