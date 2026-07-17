// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { DetailPanel } from '@/components';
import { m } from '@/lib/i18n';
import { Pill, Section, Table, EmptyState, Skeleton } from '@/ui';
import { useArchiveAudit } from './store';
import type { ArchiveEntry } from '@/bindings/index';

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
    // Migrated onto the shared `DetailPanel` (spec 054 T012, D5 "completely
    // shared components" mandate) — was raw `DetailPane`+`DetailHeader`,
    // bypassing the container-level scroll containment guarantee (FR-009).
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
            ]}
            rows={history.map((h) => ({
              ts: <span className="alm-mono">{h.timestamp}</span>,
              detail: h.detail,
            }))}
          />
        )}
      </Section>
    </DetailPanel>
  );
}
