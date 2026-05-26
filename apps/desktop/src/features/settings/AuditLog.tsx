import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { Btn, Pill } from '@/ui';

/* ---------- types ---------- */

type AuditOutcome = 'applied' | 'ok' | 'refused' | 'failed' | 'paused';

interface AuditEntry {
  id: string;
  timestamp: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  from_state?: string;
  to_state?: string;
  actor: string;
  outcome: AuditOutcome;
  detail: string;
}

/* ---------- mock data ---------- */

const MOCK_EVENTS: AuditEntry[] = [
  { id: '1', timestamp: '2025-02-24T14:32:18Z', event_type: 'plan.approved', entity_type: 'plan', entity_id: 'plan-#23', from_state: 'ready_for_review', to_state: 'approved', actor: 'user', outcome: 'applied', detail: 'cleanup plan -- 148 items -- 2.1 GB reclaim' },
  { id: '2', timestamp: '2025-02-24T14:32:18Z', event_type: 'plan.applying', entity_type: 'plan', entity_id: 'plan-#23', from_state: 'approved', to_state: 'applying', actor: 'system', outcome: 'ok', detail: '' },
  { id: '3', timestamp: '2025-02-24T14:32:20Z', event_type: 'planitem.applied', entity_type: 'planitem', entity_id: 'plan-#23 / item 1', from_state: 'pending', to_state: 'applied', actor: 'system', outcome: 'ok', detail: 'trash registered/Ha_300s_r_0001.xisf' },
  { id: '4', timestamp: '2025-02-24T14:32:21Z', event_type: 'planitem.applied', entity_type: 'planitem', entity_id: 'plan-#23 / item 2', from_state: 'pending', to_state: 'applied', actor: 'system', outcome: 'ok', detail: '' },
  { id: '5', timestamp: '2025-02-24T14:35:02Z', event_type: 'planitem.failed', entity_type: 'planitem', entity_id: 'plan-#23 / item 47', from_state: 'pending', to_state: 'failed', actor: 'system', outcome: 'failed', detail: 'EBUSY -- file locked by another process' },
  { id: '6', timestamp: '2025-02-24T14:35:02Z', event_type: 'plan.paused', entity_type: 'plan', entity_id: 'plan-#23', from_state: 'applying', to_state: 'paused', actor: 'system', outcome: 'paused', detail: 'item failure -- awaiting user' },
  { id: '7', timestamp: '2025-02-24T13:18:44Z', event_type: 'session.confirmed', entity_type: 'session', entity_id: 'acq-a3f7...2b -- NGC 7000 Ha 11-30', from_state: 'needs_review', to_state: 'confirmed', actor: 'user', outcome: 'applied', detail: 'observer_location reviewed -- Truckee, CA' },
  { id: '8', timestamp: '2025-02-24T13:14:11Z', event_type: 'classification.confirmed', entity_type: 'file', entity_id: 'D:\\...\\IMG_0142.fit', from_state: 'unknown', to_state: 'raw light', actor: 'user', outcome: 'applied', detail: 'rule saved: **/untitled/*.fit -- raw light' },
  { id: '9', timestamp: '2025-02-23T22:01:09Z', event_type: 'project.transition', entity_type: 'project', entity_id: 'NGC 7000 -- HOO', from_state: 'prepared', to_state: 'processing', actor: 'user', outcome: 'applied', detail: '' },
  { id: '10', timestamp: '2025-02-23T21:58:31Z', event_type: 'sourceview.generated', entity_type: 'sourceview', entity_id: 'NGC 7000 -- HOO / wbpp_input', from_state: undefined, to_state: 'applied', actor: 'user', outcome: 'applied', detail: 'strategy: NTFS junction -- 92 items -- plan-#18' },
  { id: '11', timestamp: '2025-02-23T18:42:01Z', event_type: 'project.transition.refused', entity_type: 'project', entity_id: 'NGC 7000 -- HOO', from_state: 'ready', to_state: 'prepared', actor: 'user', outcome: 'refused', detail: 'observer_location not reviewed for acq-a3f7...2b' },
  { id: '12', timestamp: '2025-02-22T11:30:00Z', event_type: 'root.remapped', entity_type: 'root', entity_id: 'NAS-Astro', from_state: '\\\\NAS\\astro', to_state: '\\\\NAS-2025\\astro', actor: 'user', outcome: 'applied', detail: '4 sample files verified -- 18,420 relationships updated' },
  { id: '13', timestamp: '2025-02-20T09:11:42Z', event_type: 'scan.completed', entity_type: 'datasource', entity_id: 'D:\\Astrophotography', from_state: 'running', to_state: 'completed', actor: 'system', outcome: 'ok', detail: '142,318 files indexed -- 318 unreviewed' },
];

const ITEMS_PER_PAGE = 10;

/* ---------- helpers ---------- */

function outcomeVariant(outcome: AuditOutcome): 'ok' | 'danger' | 'warn' | 'neutral' {
  switch (outcome) {
    case 'applied':
    case 'ok':
      return 'ok';
    case 'refused':
    case 'failed':
      return 'danger';
    case 'paused':
      return 'warn';
    default:
      return 'neutral';
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDate(iso: string): string {
  return iso.split('T')[0];
}

/* ---------- component ---------- */

export function AuditLog() {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = MOCK_EVENTS;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.event_type.toLowerCase().includes(q) ||
          e.entity_id.toLowerCase().includes(q) ||
          e.detail.toLowerCase().includes(q) ||
          e.actor.toLowerCase().includes(q),
      );
    }

    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      result = result.filter((e) => new Date(e.timestamp).getTime() >= from);
    }

    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000; // end of day
      result = result.filter((e) => new Date(e.timestamp).getTime() < to);
    }

    return result.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [search, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const pageItems = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
  const selected = filtered.find((e) => e.id === selectedId);

  return (
    <div className="alm-audit-log">
      {/* Filters */}
      <div className="alm-audit-log__filters">
        <input
          type="text"
          className="alm-input alm-audit-log__search"
          placeholder="Search events..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          aria-label="Search audit events"
        />
        <div className="alm-audit-log__date-range">
          <label className="alm-audit-log__date-label" htmlFor="audit-date-from">
            From
          </label>
          <input
            id="audit-date-from"
            type="date"
            className="alm-input alm-input--sm"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(0);
            }}
          />
          <label className="alm-audit-log__date-label" htmlFor="audit-date-to">
            To
          </label>
          <input
            id="audit-date-to"
            type="date"
            className="alm-input alm-input--sm"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>

      {/* Event table */}
      <table className="alm-audit-log__table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Event</th>
            <th>Entity</th>
            <th>Outcome</th>
            <th>Actor</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((entry) => (
            <tr
              key={entry.id}
              className={clsx(
                'alm-audit-log__row',
                selectedId === entry.id && 'alm-audit-log__row--selected',
              )}
              onClick={() => setSelectedId(entry.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSelectedId(entry.id);
              }}
            >
              <td className="alm-mono alm-audit-log__cell-time">
                {formatTimestamp(entry.timestamp)}
              </td>
              <td className="alm-audit-log__cell-event">{entry.event_type}</td>
              <td className="alm-audit-log__cell-entity">
                <span className="alm-audit-log__entity-type">{entry.entity_type}</span>
                <span className="alm-mono alm-audit-log__entity-id" title={entry.entity_id}>
                  {entry.entity_id}
                </span>
              </td>
              <td>
                <Pill
                  label={entry.outcome}
                  variant={outcomeVariant(entry.outcome)}
                  size="sm"
                />
              </td>
              <td className="alm-audit-log__cell-actor">{entry.actor}</td>
              <td className="alm-audit-log__cell-detail" title={entry.detail}>
                {entry.detail || '--'}
              </td>
            </tr>
          ))}
          {pageItems.length === 0 && (
            <tr>
              <td colSpan={6} className="alm-audit-log__empty">
                No matching audit events.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="alm-audit-log__pagination">
        <span className="alm-audit-log__page-info">
          {filtered.length} event{filtered.length !== 1 ? 's' : ''} &middot; page{' '}
          {page + 1} of {totalPages}
        </span>
        <div className="alm-audit-log__page-btns">
          <Btn size="sm" variant="ghost" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            Previous
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </Btn>
        </div>
      </div>

      {/* Inline detail */}
      {selected && (
        <div className="alm-audit-log__detail">
          <h4 className="alm-audit-log__detail-title">
            {selected.event_type}
          </h4>
          <div className="alm-audit-log__detail-grid">
            <span className="alm-audit-log__detail-key">Entity</span>
            <span className="alm-audit-log__detail-val">
              {selected.entity_type}: <code className="alm-mono">{selected.entity_id}</code>
            </span>

            {(selected.from_state || selected.to_state) && (
              <>
                <span className="alm-audit-log__detail-key">State</span>
                <span className="alm-audit-log__detail-val alm-mono">
                  {selected.from_state ?? '--'} &rarr; {selected.to_state ?? '--'}
                </span>
              </>
            )}

            <span className="alm-audit-log__detail-key">Actor</span>
            <span className="alm-audit-log__detail-val">{selected.actor}</span>

            <span className="alm-audit-log__detail-key">Outcome</span>
            <span className="alm-audit-log__detail-val">
              <Pill
                label={selected.outcome}
                variant={outcomeVariant(selected.outcome)}
                size="sm"
              />
            </span>

            <span className="alm-audit-log__detail-key">Timestamp</span>
            <span className="alm-audit-log__detail-val alm-mono">
              {formatTimestamp(selected.timestamp)}
            </span>

            {selected.detail && (
              <>
                <span className="alm-audit-log__detail-key">Detail</span>
                <span className="alm-audit-log__detail-val">{selected.detail}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
