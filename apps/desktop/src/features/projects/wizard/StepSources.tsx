// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { m } from '@/lib/i18n';
import { SessionSourcePicker } from '@/features/projects/SessionSourcePicker';

export interface StepSourcesData {
  selectedSessionIds: string[];
}

export interface StepSourcesProps {
  data: StepSourcesData;
  onChange: (data: StepSourcesData) => void;
}

/**
 * Wizard adapter over the shared `SessionSourcePicker` (WP-008-C extraction).
 * Keeps the wizard's `{ data, onChange }` step-data shape; the picker itself
 * is reused unchanged in `EditProjectPane`'s post-creation "add sources" flow.
 *
 * #719 FR-004/SC-001: selecting a session is optional — `WizardPage.canAdvance()`
 * no longer gates on this step, so a project can be created with zero sources
 * (backend returns lifecycle `setup_incomplete`). The hint below makes that
 * an intentional, visible choice rather than a silent skip.
 */
export function StepSources({ data, onChange }: StepSourcesProps) {
  return (
    <div className="alm-wizard-sources">
      {data.selectedSessionIds.length === 0 && (
        <div className="alm-wizard-sources__zero-hint">
          {m.projects_wizard_zero_sources_hint()}
        </div>
      )}
      <SessionSourcePicker
        selectedSessionIds={data.selectedSessionIds}
        onChange={(selectedSessionIds) => onChange({ selectedSessionIds })}
      />
    </div>
  );
}
