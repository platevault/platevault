// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { m } from '@/lib/i18n';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';
import {
  wizardNameSchema,
  type WizardNameValues,
} from '@/features/projects/schemas';

export type StepNameData = WizardNameValues;

/**
 * Server-side `projects.create` error routed onto this step (WP-008-B).
 * `name` and `tool` both land here because the wizard's `workflowProfile`
 * radio group is what maps onto the backend `tool` enum at create time — this
 * step is the only place a `tool.*` error can be actionable.
 */
export interface StepNameServerError {
  field: 'name' | 'tool';
  message: string;
}

export interface StepNameProps {
  data: StepNameData;
  onChange: (data: StepNameData) => void;
  /** Cleared by the wizard once the user edits the corresponding field. */
  serverError?: StepNameServerError | null;
}

// `label`/`description` are render-time thunks so they re-read the active locale (spec 046 #8).
const PROFILES = [
  {
    id: 'pixinsight' as const,
    label: () => m.projects_wizard_profile_pixinsight(),
    description: () => m.projects_wizard_profile_pixinsight_desc(),
  },
  {
    id: 'siril' as const,
    label: () => m.projects_wizard_profile_siril(),
    description: () => m.projects_wizard_profile_siril_desc(),
  },
  {
    id: 'planetary' as const,
    label: () => m.projects_wizard_profile_planetary(),
    description: () => m.projects_wizard_profile_planetary_desc(),
  },
];

/**
 * StepName — spec 042 US5 (T171): RHF-backed wizard name/profile step.
 *
 * The wizard keeps its `data` / `onChange` contract so WizardPage's draft,
 * summary rail, and create payload are untouched. RHF owns the inputs locally
 * and propagates every change up via `onChange`, while `wizardNameSchema`
 * (zodResolver) drives the same "name required" message the wizard relied on.
 */
export function StepName({ data, onChange, serverError }: StepNameProps) {
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
        workflowProfile: value.workflowProfile ?? 'pixinsight',
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
        {}
        <label htmlFor="project-name" className="alm-wizard-name__label">
          {m.projects_name_label()}
        </label>
        <input
          id="project-name"
          type="text"
          placeholder={m.projects_wizard_step_name_placeholder()}
          aria-invalid={Boolean(errors.name) || serverError?.field === 'name'}
          aria-describedby={
            errors.name || serverError?.field === 'name'
              ? 'project-name-error'
              : undefined
          }
          {...register('name')}
          className="alm-wizard-name__input"
        />
        {errors.name ? (
          <span
            id="project-name-error"
            role="alert"
            className="alm-wizard-name__error"
          >
            {errors.name.message}
          </span>
        ) : serverError?.field === 'name' ? (
          <span
            id="project-name-error"
            role="alert"
            className="alm-wizard-name__error"
          >
            {serverError.message}
          </span>
        ) : null}
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
              onValueChange={(value) => field.onChange(value)}
              aria-label={m.projects_wizard_workflow_label()}
              className="alm-wizard-name__radio-group"
            >
              {PROFILES.map((profile) => (
                // eslint-disable-next-line jsx-a11y/label-has-associated-control -- wraps a Base UI <Radio.Root> (not a native input the rule recognises); the label text + nested radio form the accessible option
                <label
                  key={profile.id}
                  className="alm-wizard-name__profile-option"
                  data-selected={field.value === profile.id ? 'true' : 'false'}
                >
                  <Radio.Root
                    value={profile.id}
                    className="alm-radio"
                    aria-label={profile.label()}
                  >
                    <Radio.Indicator className="alm-radio__indicator" />
                  </Radio.Root>
                  <div>
                    <div className="alm-wizard-name__profile-label">
                      {profile.label()}
                    </div>
                    <div className="alm-wizard-name__profile-description">
                      {profile.description()}
                    </div>
                  </div>
                </label>
              ))}
            </RadioGroup>
          )}
        />
        {serverError?.field === 'tool' && (
          <span role="alert" className="alm-wizard-name__error">
            {serverError.message}
          </span>
        )}
      </div>
    </div>
  );
}
