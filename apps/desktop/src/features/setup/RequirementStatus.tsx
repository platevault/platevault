// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { StatusTag } from '@/components/StatusTag';
import { m } from '@/lib/i18n';

export interface RequirementStatusProps {
  required: boolean;
  met?: boolean;
  'data-testid'?: string;
}

/**
 * Quiet requirement metadata for setup surfaces.
 *
 * The shared dot-and-label StatusTag is the app's standard compact status
 * language. It avoids adding another filled pill to already-accented source
 * cards while retaining explicit Required/Optional text.
 */
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
    <StatusTag
      variant={required ? (met ? 'ok' : 'warn') : 'ghost'}
      data-testid={dataTestId}
    >
      {label}
    </StatusTag>
  );
}
