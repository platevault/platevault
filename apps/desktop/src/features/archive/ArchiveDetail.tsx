import type { ArchiveFixture } from '@/data/fixtures/archive';
import { DetailPane, DetailHeader, PropertyTable } from '@/components';
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
          title="Select an archived item"
          desc="Choose an item from the list to view its details."
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
            <Pill variant="ghost">archived</Pill>
          </>
        }
        subtitle={item.originalPath !== '—' ? item.originalPath : 'No original path recorded'}
      />

      {/* Single column — no rail. The old rail (Status/Storage/Audit trail)
          duplicated the Details table and the Audit history table; dropped it
          along with the hero MetricLine. */}
      <Section title="Details">
        <PropertyTable
          mode="view"
          properties={[
            { key: 'archivedAt', label: 'Archived', value: item.archivedAt },
            { key: 'reason', label: 'Reason', value: item.reason },
            { key: 'entityType', label: 'Entity type', value: item.entityType },
            { key: 'size', label: 'Size on disk', value: item.size },
            { key: 'originalPath', label: 'Original path', value: item.originalPath },
          ]}
        />
      </Section>

      <Section title="Audit history" count={history.length}>
        <Table
          columns={[
            { key: 'ts', label: 'Date', style: { width: 120 } },
            { key: 'detail', label: 'Event' },
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
