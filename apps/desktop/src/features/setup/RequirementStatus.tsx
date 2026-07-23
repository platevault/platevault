// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { m } from '@/lib/i18n';
import { Pill } from '@/ui/Pill';

export interface RequirementStatusProps {
  required: boolean;
  met?: boolean;
  'data-testid'?: string;
}

/** Explicit requirement metadata using the shared semantic Pill variants. */
export function RequirementStatus({
  required,
  met = false,
  'data-testid': dataTestId,
}: RequirementStatusProps) {
  const label = required
    ? met
      ? `${m.setup_sources_required()} ✓`
      : m.setup_sources_required()
    : m.setup_sources_optional();

  return (
    <Pill
      variant={required ? (met ? 'ok' : 'warn') : 'ghost'}
      data-testid={dataTestId}
    >
      {label}
    </Pill>
  );
}
