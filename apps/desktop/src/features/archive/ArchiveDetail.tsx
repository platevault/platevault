import { DetailPane, DetailHeader, PropertyTable } from '@/components';
import { m } from '@/lib/i18n';
import { Pill, Section, Table, EmptyState } from '@/ui';
import { formatBytes } from '@/lib/format';
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
    <DetailPane fill>
      <DetailHeader
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
      />

      {/* Single column — no rail. The old rail (Status/Storage/Audit trail)
          duplicated the Details table and the Audit history table; dropped it
          along with the hero MetricLine. */}
      <Section title={m.common_details()}>
        <PropertyTable
          mode="view"
          properties={[
            {
              key: 'archivedAt',
              label: m.archive_prop_archived_at(),
              value: item.archivedAt,
            },
            {
              key: 'reason',
              label: m.archive_prop_reason(),
              value: item.reason,
            },
            {
              key: 'entityType',
              label: m.archive_prop_entity_type(),
              value: item.entityType,
            },
            {
              key: 'size',
              label: m.archive_prop_size(),
              value: formatBytes(item.sizeBytes),
            },
            {
              key: 'originalPath',
              label: m.archive_prop_original_path(),
              value: item.originalPath,
            },
          ]}
        />
      </Section>

      <Section title={m.archive_audit_history_title()} count={history.length}>
        {loading ? (
          <EmptyState title={m.common_loading()} />
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
    </DetailPane>
  );
}
