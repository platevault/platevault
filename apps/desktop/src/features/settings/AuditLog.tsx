import { useState, useMemo } from 'react';
import { Btn, Pill, Table } from '@/ui';
import { AUDIT_EVENTS, type AuditEventFixture } from '@/data/fixtures/settings';

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

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AuditLog() {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);

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
      const from = new Date(dateFrom).getTime();
      result = result.filter((e) => new Date(e.timestamp).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000;
      result = result.filter((e) => new Date(e.timestamp).getTime() < to);
    }
    return [...result].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [search, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const pageItems = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  return (
    <>
      {/* Filters */}
      <div className="alm-settings__group">
        <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', flexWrap: 'wrap', marginBottom: 'var(--alm-sp-3)' }}>
          <input
            type="text"
            className="alm-input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Search events, entities, details…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            aria-label="Search audit events"
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
            From
            <input
              type="date"
              className="alm-input"
              style={{ width: 140 }}
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
            To
            <input
              type="date"
              className="alm-input"
              style={{ width: 140 }}
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
            />
          </label>
        </div>

        <Table
          columns={[
            { key: 'timestamp', label: 'Timestamp', style: { width: 150 } },
            { key: 'event', label: 'Event' },
            { key: 'entity', label: 'Entity' },
            { key: 'outcome', label: 'Outcome', style: { width: 90 } },
            { key: 'actor', label: 'Actor', style: { width: 72 } },
          ]}
          rows={pageItems.map((e) => ({
            timestamp: (
              <code className="alm-mono" style={{ fontSize: 'var(--alm-text-2xs)' }}>
                {formatTimestamp(e.timestamp)}
              </code>
            ),
            event: (
              <span style={{ fontSize: 'var(--alm-text-xs)', fontFamily: 'var(--alm-font-mono)' }}>
                {e.event}
              </span>
            ),
            entity: (
              <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={e.entity}>
                {e.entity}
              </span>
            ),
            outcome: <Pill variant={outcomeVariant(e.outcome)}>{e.outcome}</Pill>,
            actor: (
              <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                {e.actor}
              </span>
            ),
          }))}
        />

        {pageItems.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)', padding: 'var(--alm-sp-4)' }}>
            No matching audit events.
          </p>
        )}

        {/* Pagination */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--alm-sp-3)' }}>
          <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            {filtered.length} event{filtered.length !== 1 ? 's' : ''} &middot; page {page + 1} of {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 'var(--alm-sp-1)' }}>
            <Btn size="sm" variant="ghost" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
              Previous
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
              Next
            </Btn>
          </div>
        </div>
      </div>
    </>
  );
}
