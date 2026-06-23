import type { ArchiveFixture } from '@/data/fixtures/archive';
import { DetailPane, DetailHeader, PropertyTable } from '@/components';
import { m } from '@/lib/i18n';
import { Pill, Section, Table, EmptyState } from '@/ui';

// ─── Entity-type pill variant ────────────────────────────────────────────────

type EntityType = ArchiveFixture['entityType'];

function entityVariant(type: EntityType) {
  const map: Record<EntityType, 'info' | 'accent' | 'warn' | 'neutral' | 'ghost'> = {
    project: 'info',
    session: 'accent',
    master: 'warn',
    target: 'neutral',
    plan: 'ghost',
  };
  return map[type] ?? 'neutral';
}

// ─── Audit history ───────────────────────────────────────────────────────────
// STUB: no backend audit-history endpoint yet. These rows are static per entity
// type so the single-column layout can be designed; replace with the real audit
// log once `archive.history` (or equivalent) ships.

const AUDIT_ROWS: Record<EntityType, { ts: string; detail: string }[]> = {
  project: [
    { ts: '2024-12-18', detail: 'archived — superseded by reprocess' },
    { ts: '2024-12-17', detail: 'cleanup plan reviewed' },
    { ts: '2024-12-16', detail: 'marked completed' },
  ],
  session: [
    { ts: '2024-10-14', detail: 'archived — rejected session' },
    { ts: '2024-10-13', detail: 'flagged for rejection' },
    { ts: '2024-10-12', detail: 'discovered in inbox scan' },
  ],
  master: [
    { ts: '2024-08-21', detail: 'archived — aging > 1 year' },
    { ts: '2024-08-20', detail: 'age check triggered' },
  ],
  target: [
    { ts: '2024-07-19', detail: 'archived — merged into M45' },
    { ts: '2024-07-18', detail: 'duplicate target detected' },
  ],
  plan: [
    { ts: '2024-06-02', detail: 'archived — plan deprecated' },
    { ts: '2024-06-01', detail: 'superseded by updated sequence' },
  ],
};

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  item: ArchiveFixture | null;
}

export function ArchiveDetail({ item }: Props) {
  if (!item) {
    return (
      <DetailPane>
        <EmptyState
          title={m.archive_select_item_title()}
          desc={m.archive_select_item_desc()}
        />
      </DetailPane>
    );
  }

  const history = AUDIT_ROWS[item.entityType] ?? [];

  return (
    <DetailPane fill>
      <DetailHeader
        title={item.name}
        titleExtra={
          <>
            <Pill variant={entityVariant(item.entityType)}>{item.entityType}</Pill>
            <Pill variant="ghost">{m.archive_status_pill()}</Pill>
          </>
        }
        subtitle={item.originalPath !== '—' ? item.originalPath : m.archive_subtitle_no_path()}
      />

      {/* Single column — no rail. The old rail (Status/Storage/Audit trail)
          duplicated the Details table and the Audit history table; dropped it
          along with the hero MetricLine. */}
      <Section title={m.common_details()}>
        <PropertyTable
          mode="view"
          properties={[
            { key: 'archivedAt', label: m.archive_prop_archived_at(), value: item.archivedAt },
            { key: 'reason', label: m.archive_prop_reason(), value: item.reason },
            { key: 'entityType', label: m.archive_prop_entity_type(), value: item.entityType },
            { key: 'size', label: m.archive_prop_size(), value: item.size },
            { key: 'originalPath', label: m.archive_prop_original_path(), value: item.originalPath },
          ]}
        />
      </Section>

      <Section title={m.archive_audit_history_title()} count={history.length}>
        <Table
          columns={[
            { key: 'ts', label: m.archive_prop_date(), style: { width: 120 } },
            { key: 'detail', label: m.archive_prop_event() },
          ]}
          rows={history.map((h) => ({
            ts: <span className="alm-mono">{h.ts}</span>,
            detail: h.detail,
          }))}
        />
      </Section>
    </DetailPane>
  );
}
