import { useState, useMemo, useId, useCallback, useEffect } from 'react';
import { Btn, Pill, Table } from '@/ui';
import { auditList, auditExport } from './settingsIpc';
import type { AuditEntry, AuditFilterDto, AuditOutcome } from '@/bindings/index';
import { errMessage } from '@/lib/errors';
import { formatDateTime, toEpochMs } from '@/lib/datetime';
import { m } from '@/lib/i18n';
import { SettingsSection } from './SettingsKit';

const ITEMS_PER_PAGE = 8;

function outcomeVariant(outcome: AuditOutcome): 'ok' | 'danger' | 'warn' | 'neutral' {
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

/** Build the `audit.list` filter payload from the screen's search/date controls. */
function buildFilters(search: string, dateFrom: string, dateTo: string): AuditFilterDto | null {
  const filters: AuditFilterDto = {};
  let hasFilter = false;
  if (search.trim()) {
    filters.search = search.trim();
    hasFilter = true;
  }
  if (dateFrom) {
    filters.from = new Date(toEpochMs(dateFrom)).toISOString();
    hasFilter = true;
  }
  if (dateTo) {
    // Exclusive upper bound: the day after `dateTo`, so the whole day is included.
    filters.to = new Date(toEpochMs(dateTo) + 86400000).toISOString();
    hasFilter = true;
  }
  return hasFilter ? filters : null;
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const dateFromId = useId();
  const dateToId = useId();

  const filters = useMemo(
    () => buildFilters(search, dateFrom, dateTo),
    [search, dateFrom, dateTo],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    auditList(filters, { limit: ITEMS_PER_PAGE, offset: page * ITEMS_PER_PAGE })
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(errMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  const handleExport = useCallback(async () => {
    setExportError(null);
    setExporting(true);
    try {
      const ndjson = await auditExport(filters);
      const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `audit-log-export-${Date.now()}.ndjson`;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err: unknown) {
      setExportError(errMessage(err));
    } finally {
      setExporting(false);
    }
  }, [filters]);

  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));

  return (
    <>
      <SettingsSection
        title={m.settings_auditlog_title()}
        action={
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => void handleExport()}
            disabled={exporting || loading}
            aria-label={m.settings_auditlog_export_aria()}
          >
            {m.settings_auditlog_export()}
          </Btn>
        }
      >
        <div className="alm-audit-log__filters">
          <input
            type="text"
            className="alm-input alm-audit-log__search"
            placeholder={m.settings_auditlog_search_placeholder()}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            aria-label={m.settings_auditlog_search_aria()}
          />
          <label className="alm-audit-log__date-label" htmlFor={dateFromId}>
            {m.settings_auditlog_date_from()}
            {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the wrapping <label> (htmlFor + id + visible text); rule misses the wrapping-label association */}
            <input
              id={dateFromId}
              type="date"
              className="alm-input alm-audit-log__date-input"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
            />
          </label>
          <label className="alm-audit-log__date-label" htmlFor={dateToId}>
            {m.settings_auditlog_date_to()}
            {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the wrapping <label> (htmlFor + id + visible text); rule misses the wrapping-label association */}
            <input
              id={dateToId}
              type="date"
              className="alm-input alm-audit-log__date-input"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
            />
          </label>
        </div>

        {exportError && (
          <div className="alm-audit-log__export-error" role="alert">
            {m.settings_auditlog_export_failed({ error: exportError })}
          </div>
        )}

        {loading && (
          <div className="alm-audit-log__status">
            {m.common_loading()}
          </div>
        )}

        {loadError && (
          <div className="alm-audit-log__load-error">
            {m.settings_auditlog_load_error({ error: loadError })}
          </div>
        )}

        {!loading && !loadError && (
          <Table
            columns={[
              { key: 'timestamp', label: m.settings_auditlog_col_timestamp(), style: { width: 150 } },
              { key: 'event', label: m.settings_auditlog_col_event() },
              { key: 'entity', label: m.settings_auditlog_col_entity() },
              { key: 'outcome', label: m.settings_auditlog_col_outcome(), style: { width: 90 } },
              { key: 'actor', label: m.settings_auditlog_col_actor(), style: { width: 72 } },
            ]}
            rows={entries.map((e) => ({
              timestamp: (
                <code className="alm-mono alm-audit-log__ts">
                  {formatDateTime(e.timestamp)}
                </code>
              ),
              event: (
                <span className="alm-audit-log__event">
                  {e.eventType}
                </span>
              ),
              entity: (
                <span className="alm-audit-log__entity" title={e.detail}>
                  {e.entityType} · {e.entityId}
                </span>
              ),
              outcome: <Pill variant={outcomeVariant(e.outcome)}>{e.outcome}</Pill>,
              actor: (
                <span className="alm-audit-log__actor">
                  {e.actor}
                </span>
              ),
            }))}
          />
        )}

        {!loading && !loadError && entries.length === 0 && (
          <p className="alm-audit-log__empty">
            {m.settings_auditlog_empty()}
          </p>
        )}

        {/* Pagination */}
        <div className="alm-audit-log__pagination">
          <span className="alm-audit-log__page-count">
            {/* eslint-disable-next-line alm/no-user-string -- pagination separator fragments "· page X of Y" are structural, not translatable copy */}
            {m.settings_auditlog_event_count({ count: total })} &middot; page {page + 1} of {totalPages}
          </span>
          <div className="alm-audit-log__page-btns">
            <Btn size="sm" variant="ghost" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
              {m.settings_auditlog_previous()}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
              {m.settings_auditlog_next()}
            </Btn>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
