// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
 */
export function StepSources({ data, onChange }: StepSourcesProps) {
  return (
    <SessionSourcePicker
      selectedSessionIds={data.selectedSessionIds}
      onChange={(selectedSessionIds) => onChange({ selectedSessionIds })}
    />
  );
}
