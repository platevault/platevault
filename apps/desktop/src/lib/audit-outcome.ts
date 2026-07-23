// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared `AuditOutcome` → pill variant/label mapping.
 *
 * Settings → Audit Log (`features/settings/AuditLog.tsx`) and the Archive
 * detail panel (`features/archive/ArchiveDetail.tsx`) each keep their own
 * copy of this five-case switch (documented there as intentional at the
 * time — one extra caller wasn't worth a cross-feature extraction). Project
 * history (#833) is a third caller, which crosses that threshold; new
 * callers should use this module rather than adding a fourth copy.
 */

import type { AuditOutcome } from '@/bindings/index';
import type { PillVariant } from '@/ui';
import { m } from '@/lib/i18n';

export function auditOutcomeVariant(outcome: AuditOutcome): PillVariant {
  switch (outcome) {
    case 'applied':
    case 'ok':
      return 'ok';
    case 'refused':
    case 'paused':
      return 'warn';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function auditOutcomeLabel(outcome: AuditOutcome): string {
  switch (outcome) {
    case 'applied':
      return m.settings_auditlog_outcome_applied();
    case 'ok':
      return m.settings_auditlog_outcome_ok();
    case 'refused':
      return m.settings_auditlog_outcome_refused();
    case 'failed':
      return m.settings_auditlog_outcome_failed();
    case 'paused':
      return m.settings_auditlog_outcome_paused();
  }
}
