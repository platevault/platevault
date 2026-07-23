// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { DetailPanel } from '@/components';
import { m } from '@/lib/i18n';
import { Pill, Section, Table, EmptyState, Skeleton } from '@/ui';
import { useArchiveAudit } from './store';
import type { ArchiveEntry, AuditOutcome } from '@/bindings/index';

// ─── Audit outcome rendering ────────────────────────────────────────────────
// Mirrors Settings → Audit Log's outcomeVariant/outcomeLabel
// (apps/desktop/src/features/settings/AuditLog.tsx) — kept local rather than
// shared since that file isn't in this feature's scope and the mapping is a
// five-case switch, not worth a cross-feature extraction for one more caller.

function outcomeVariant(
  outcome: AuditOutcome,
): 'ok' | 'danger' | 'warn' | 'neutral' {
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

function outcomeLabel(outcome: AuditOutcome): string {
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

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  /**
   * The selected entry. Non-null by contract: ArchivePage mounts this detail
   * (in the ListPageLayout bottom panel) only when an entry is selected —
   * no empty-selection dashboard (spec 043).
   */
  item: ArchiveEntry;
}

export function ArchiveDetail({ item }: Props) {
  const { data: history = [], loading, error } = useArchiveAudit(item.id);

  return (
    <DetailPanel
      fill
      title={item.name}
      titleExtra={
        <>
          <Pill variant="info">{item.entityType}</Pill>
          <Pill variant="ghost">{m.archive_status_pill()}</Pill>
        </>
      }
      subtitle={
        item.originalPath !== '—'
          ? item.originalPath
          : m.archive_subtitle_no_path()
      }
    >
      {/* Single column — no rail. The old rail (Status/Storage/Audit trail)
          duplicated the Details table and the Audit history table, so it was
          dropped along with the hero MetricLine. The "Details" table that
          used to sit here (archivedAt/reason/entityType/size/originalPath)
          was ALSO dropped (spec-030 Q16/#619, T133 detail-as-delta audit):
          every one of those fields already renders on the ArchiveTable row
          (Reason/Size/Type/Archived columns) or in this header (title=name,
          pill=entityType, subtitle=originalPath), so the table was a pure
          echo with zero new information — FR-139 requires a detail panel to
          add information beyond the row, not restate it. Audit history below
          is the panel's one real information class (SC-011). */}
      <Section title={m.archive_audit_history_title()} count={history.length}>
        {loading ? (
          <Skeleton count={4} label={m.common_loading()} />
        ) : error ? (
          <EmptyState title={m.archive_load_error()} />
        ) : (
          <Table
            columns={[
              {
                key: 'ts',
                label: m.archive_prop_date(),
                style: { width: 160 },
              },
              { key: 'detail', label: m.archive_prop_event() },
              {
                key: 'outcome',
                label: m.settings_auditlog_col_outcome(),
                style: { width: 90 },
              },
              {
                key: 'actor',
                label: m.settings_auditlog_col_actor(),
                style: { width: 72 },
              },
            ]}
            rows={history.map((h) => ({
              ts: <span className="pv-mono">{h.timestamp}</span>,
              detail: h.detail,
              outcome: (
                <Pill variant={outcomeVariant(h.outcome)}>
                  {outcomeLabel(h.outcome)}
                </Pill>
              ),
              actor: <span className="pv-mono">{h.actor}</span>,
            }))}
          />
        )}
      </Section>
    </DetailPanel>
  );
}
