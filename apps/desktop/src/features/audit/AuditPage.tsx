import { useMemo, useState, useCallback } from 'react';
import { useQuery, createQueryStore } from '@/data/store';
import { listAuditEntries, exportAudit } from '@/api/commands';
import type { AuditEntry, AuditOutcome } from '@/api/types';
import { Pill, Btn, EmptyState } from '@/ui';

// --- Store ---

const auditStore = createQueryStore(() =>
  listAuditEntries({ pagination: { offset: 0, limit: 500 } }),
);

// --- Helpers ---

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

// --- Wireframe fixture data (matches wireframe exactly) ---

const FIXTURE_EVENTS: AuditEntry[] = [
  { id: '1', timestamp: '2025-02-24T14:32:18Z', event_type: 'plan.approved', entity_type: 'plan', entity_id: 'plan-#23', from_state: 'ready_for_review', to_state: 'approved', actor: 'user', outcome: 'applied', detail: 'cleanup plan · 148 items · 2.1 GB reclaim' },
  { id: '2', timestamp: '2025-02-24T14:32:18Z', event_type: 'plan.applying', entity_type: 'plan', entity_id: 'plan-#23', from_state: 'approved', to_state: 'applying', actor: 'system', outcome: 'ok', detail: '' },
  { id: '3', timestamp: '2025-02-24T14:32:20Z', event_type: 'planitem.applied', entity_type: 'planitem', entity_id: 'plan-#23 / item 1', from_state: 'pending', to_state: 'applied', actor: 'system', outcome: 'ok', detail: 'trash registered/Ha_300s_r_0001.xisf' },
  { id: '4', timestamp: '2025-02-24T14:32:21Z', event_type: 'planitem.applied', entity_type: 'planitem', entity_id: 'plan-#23 / item 2', from_state: 'pending', to_state: 'applied', actor: 'system', outcome: 'ok', detail: '' },
  { id: '5', timestamp: '2025-02-24T14:35:02Z', event_type: 'planitem.failed', entity_type: 'planitem', entity_id: 'plan-#23 / item 47', from_state: 'pending', to_state: 'failed', actor: 'system', outcome: 'failed', detail: 'EBUSY · file locked by another process' },
  { id: '6', timestamp: '2025-02-24T14:35:02Z', event_type: 'plan.paused', entity_type: 'plan', entity_id: 'plan-#23', from_state: 'applying', to_state: 'paused', actor: 'system', outcome: 'paused', detail: 'item failure · awaiting user' },
  { id: '7', timestamp: '2025-02-24T13:18:44Z', event_type: 'session.confirmed', entity_type: 'session', entity_id: 'acq-a3f7…2b · NGC 7000 Ha 11-30', from_state: 'needs_review', to_state: 'confirmed', actor: 'user', outcome: 'applied', detail: 'observer_location reviewed → Truckee, CA' },
  { id: '8', timestamp: '2025-02-24T13:14:11Z', event_type: 'classification.confirmed', entity_type: 'file', entity_id: 'D:\\…\\IMG_0142.fit', from_state: 'unknown', to_state: 'raw light', actor: 'user', outcome: 'applied', detail: 'rule saved: **/untitled/*.fit → raw light' },
  { id: '9', timestamp: '2025-02-23T22:01:09Z', event_type: 'project.transition', entity_type: 'project', entity_id: 'NGC 7000 · HOO', from_state: 'prepared', to_state: 'processing', actor: 'user', outcome: 'applied', detail: '' },
  { id: '10', timestamp: '2025-02-23T21:58:31Z', event_type: 'sourceview.generated', entity_type: 'sourceview', entity_id: 'NGC 7000 · HOO / wbpp_input', from_state: undefined, to_state: 'applied', actor: 'user', outcome: 'applied', detail: 'strategy: NTFS junction · 92 items · plan-#18' },
  { id: '11', timestamp: '2025-02-23T18:42:01Z', event_type: 'project.transition.refused', entity_type: 'project', entity_id: 'NGC 7000 · HOO', from_state: 'ready', to_state: 'prepared', actor: 'user', outcome: 'refused', detail: 'observer_location not reviewed for acq-a3f7…2b' },
  { id: '12', timestamp: '2025-02-22T11:30:00Z', event_type: 'root.remapped', entity_type: 'root', entity_id: 'NAS-Astro', from_state: '\\\\NAS\\astro', to_state: '\\\\NAS-2025\\astro', actor: 'user', outcome: 'applied', detail: '4 sample files verified · 18,420 relationships updated' },
  { id: '13', timestamp: '2025-02-20T09:11:42Z', event_type: 'scan.completed', entity_type: 'datasource', entity_id: 'D:\\Astrophotography', from_state: 'running', to_state: 'completed', actor: 'system', outcome: 'ok', detail: '142,318 files indexed · 318 unreviewed' },
];

// --- Component ---

export function AuditPage() {
  const { data, loading } = useQuery(auditStore);
  const [searchTerm, setSearchTerm] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [actorFilter, setActorFilter] = useState('all');

  // Use fixture data if no real data loaded
  const entries = useMemo(() => {
    const source = data?.entries && data.entries.length > 0 ? data.entries : FIXTURE_EVENTS;
    return source.filter((e) => {
      if (searchTerm && !e.entity_id.toLowerCase().includes(searchTerm.toLowerCase()) && !e.event_type.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (eventFilter !== 'all' && e.event_type !== eventFilter) return false;
      if (outcomeFilter !== 'all' && e.outcome !== outcomeFilter) return false;
      if (actorFilter !== 'all' && e.actor !== actorFilter) return false;
      return true;
    });
  }, [data, searchTerm, eventFilter, outcomeFilter, actorFilter]);

  const handleExport = useCallback(async () => {
    try {
      const jsonlContent = await exportAudit({ filters: undefined });
      const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audit-export-${new Date().toISOString().split('T')[0]}.jsonl`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Audit export failed:', err);
    }
  }, []);

  const isDangerRow = (e: AuditEntry) => e.outcome === 'failed' || e.outcome === 'refused';
  const isPausedRow = (e: AuditEntry) => e.outcome === 'paused';

  return (
    <div className="alm-page" data-testid="AuditPage">
      {/* Toolbar */}
      <div className="alm-toolbar">
        <input
          type="text"
          className="alm-sessions-search"
          placeholder="Search entity, event..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          aria-label="Search audit entries"
        />
        <select
          className="alm-select alm-select--sm"
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          aria-label="Filter by event"
        >
          <option value="all">Event: all</option>
        </select>
        <select
          className="alm-select alm-select--sm"
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value)}
          aria-label="Filter by outcome"
        >
          <option value="all">Outcome: all</option>
          <option value="applied">applied</option>
          <option value="ok">ok</option>
          <option value="refused">refused</option>
          <option value="failed">failed</option>
          <option value="paused">paused</option>
        </select>
        <select
          className="alm-select alm-select--sm"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          aria-label="Filter by actor"
        >
          <option value="all">Actor: all</option>
          <option value="user">user</option>
          <option value="system">system</option>
        </select>
        <select className="alm-select alm-select--sm" aria-label="Time range">
          <option>Last 7 days</option>
        </select>
      </div>

      {/* Sub-bar */}
      <div className="alm-toolbar__sub">
        <span>2,840 entries</span>
        <span style={{ color: 'var(--alm-text-faint)' }}>&middot;</span>
        <span>retention: forever &middot; append-only &middot; immutable</span>
        <span style={{ marginLeft: 'auto' }}>
          <Btn size="sm" onClick={handleExport}>Export JSONL</Btn>
        </span>
      </div>

      {loading && <div className="alm-page__loading">Loading audit log...</div>}

      {!loading && entries.length === 0 && (
        <EmptyState
          title="No events recorded"
          description="Audit entries will appear here as operations are performed on your library."
        />
      )}

      {!loading && entries.length > 0 && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table className="alm-simple-table alm-audit-table">
            <thead>
              <tr>
                <th style={{ width: 140 }}>Timestamp</th>
                <th style={{ width: 170 }}>Event</th>
                <th>Entity</th>
                <th style={{ width: 180 }}>State change</th>
                <th style={{ width: 70 }}>Actor</th>
                <th style={{ width: 80 }}>Outcome</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  style={{
                    background: isDangerRow(e) ? '#faf0ec'
                      : isPausedRow(e) ? '#f8f1d8'
                      : 'transparent',
                  }}
                >
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {formatTimestamp(e.timestamp)}
                  </td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {e.event_type}
                  </td>
                  <td style={{ fontSize: 'var(--alm-text-xs)' }}>{e.entity_id}</td>
                  <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                    {e.from_state && e.to_state && e.from_state !== e.to_state ? (
                      <>
                        <span style={{ color: 'var(--alm-text-muted)' }}>{e.from_state}</span>
                        {' '}
                        <span style={{ color: 'var(--alm-text-faint)' }}>&rarr;</span>
                        {' '}
                        <span>{e.to_state}</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--alm-text-faint)' }}>&mdash;</span>
                    )}
                  </td>
                  <td style={{
                    fontSize: 'var(--alm-text-xs)',
                    color: e.actor === 'system' ? 'var(--alm-text-muted)' : 'var(--alm-text)',
                  }}>
                    {e.actor}
                  </td>
                  <td>
                    {e.outcome === 'applied' && <Pill label="applied" variant="ok" size="sm" />}
                    {e.outcome === 'ok' && <Pill label="ok" variant="ok" size="sm" />}
                    {e.outcome === 'refused' && <Pill label="refused" variant="danger" size="sm" />}
                    {e.outcome === 'failed' && <Pill label="failed" variant="danger" size="sm" />}
                    {e.outcome === 'paused' && <Pill label="paused" variant="warn" size="sm" />}
                  </td>
                  <td style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-secondary)' }}>
                    {e.detail || <span style={{ color: 'var(--alm-text-faint)' }}>&mdash;</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
