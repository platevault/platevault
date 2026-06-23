import { useState, useMemo, useId } from 'react';
import { Btn, Pill, Table } from '@/ui';
import { AUDIT_EVENTS, type AuditEventFixture } from '@/data/fixtures/settings';
import { formatDateTime, compareDateDesc, toEpochMs } from '@/lib/datetime';
import { m } from '@/lib/i18n';
import { SettingsSection } from './SettingsKit';

type AuditOutcome = AuditEventFixture['outcome'];

const ITEMS_PER_PAGE = 8;

function outcomeVariant(outcome: AuditOutcome): 'ok' | 'danger' | 'warn' | 'neutral' {
  switch (outcome) {
    case 'ok': return 'ok';
    case 'warn': return 'warn';
    case 'error': return 'danger';
    default: return 'neutral';
  }
}

export function AuditLog() {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const dateFromId = useId();
  const dateToId = useId();

  const filtered = useMemo(() => {
    let result = AUDIT_EVENTS;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.event.toLowerCase().includes(q) ||
          e.entity.toLowerCase().includes(q) ||
          e.detail.toLowerCase().includes(q) ||
          e.actor.toLowerCase().includes(q),
      );
    }
    if (dateFrom) {
      const from = toEpochMs(dateFrom);
      result = result.filter((e) => toEpochMs(e.timestamp) >= from);
    }
    if (dateTo) {
      const to = toEpochMs(dateTo) + 86400000;
      result = result.filter((e) => toEpochMs(e.timestamp) < to);
    }
    return [...result].sort((a, b) => compareDateDesc(a.timestamp, b.timestamp));
  }, [search, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const pageItems = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  return (
    <>
      <SettingsSection title={m.settings_auditlog_title()}>
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

        <Table
          columns={[
            { key: 'timestamp', label: m.settings_auditlog_col_timestamp(), style: { width: 150 } },
            { key: 'event', label: m.settings_auditlog_col_event() },
            { key: 'entity', label: m.settings_auditlog_col_entity() },
            { key: 'outcome', label: m.settings_auditlog_col_outcome(), style: { width: 90 } },
            { key: 'actor', label: m.settings_auditlog_col_actor(), style: { width: 72 } },
          ]}
          rows={pageItems.map((e) => ({
            timestamp: (
              <code className="alm-mono alm-audit-log__ts">
                {formatDateTime(e.timestamp)}
              </code>
            ),
            event: (
              <span className="alm-audit-log__event">
                {e.event}
              </span>
            ),
            entity: (
              <span className="alm-audit-log__entity" title={e.entity}>
                {e.entity}
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

        {pageItems.length === 0 && (
          <p className="alm-audit-log__empty">
            {m.settings_auditlog_empty()}
          </p>
        )}

        {/* Pagination */}
        <div className="alm-audit-log__pagination">
          <span className="alm-audit-log__page-count">
            {/* eslint-disable-next-line alm/no-user-string -- pagination separator fragments "· page X of Y" are structural, not translatable copy */}
            {m.settings_auditlog_event_count({ count: filtered.length })} &middot; page {page + 1} of {totalPages}
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
