import type { AuditEntry, AuditOutcome } from '@/bindings/types';
import { Pill, Box } from '@/ui';

export interface AuditContextProps {
  entry: AuditEntry;
  allEntries: AuditEntry[];
}

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

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function AuditContext({ entry, allEntries }: AuditContextProps) {
  // Related events: same entity_id, excluding current
  const relatedEvents = allEntries
    .filter((e) => e.entity_id === entry.entity_id && e.id !== entry.id)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, 10);

  // Entity quick info
  const entityEvents = allEntries.filter(
    (e) => e.entity_id === entry.entity_id,
  );
  const firstEvent = entityEvents.reduce((earliest, e) =>
    new Date(e.timestamp) < new Date(earliest.timestamp) ? e : earliest,
  );
  const lastEvent = entityEvents.reduce((latest, e) =>
    new Date(e.timestamp) > new Date(latest.timestamp) ? e : latest,
  );
  const failCount = entityEvents.filter(
    (e) => e.outcome === 'failed' || e.outcome === 'refused',
  ).length;

  return (
    <div className="alm-inspector">
      {/* Entity quick info */}
      <div className="alm-inspector__section">
        <div className="alm-inspector__section-label">Entity</div>
        <div className="alm-inspector__kv-compact">
          <div className="alm-inspector__kv-row">
            <span className="alm-inspector__kv-key">Type</span>
            <span className="alm-inspector__kv-val">{entry.entity_type}</span>
          </div>
          <div className="alm-inspector__kv-row">
            <span className="alm-inspector__kv-key">ID</span>
            <span className="alm-inspector__kv-val alm-mono" title={entry.entity_id}>
              {entry.entity_id}
            </span>
          </div>
          <div className="alm-inspector__kv-row">
            <span className="alm-inspector__kv-key">Total events</span>
            <span className="alm-inspector__kv-val alm-mono">{entityEvents.length}</span>
          </div>
          {failCount > 0 && (
            <div className="alm-inspector__kv-row">
              <span className="alm-inspector__kv-key">Failures</span>
              <span
                className="alm-inspector__kv-val alm-mono"
                style={{ color: 'var(--alm-danger)' }}
              >
                {failCount}
              </span>
            </div>
          )}
          <div className="alm-inspector__kv-row">
            <span className="alm-inspector__kv-key">First seen</span>
            <span className="alm-inspector__kv-val alm-mono">
              {formatDate(firstEvent.timestamp)}
            </span>
          </div>
          <div className="alm-inspector__kv-row">
            <span className="alm-inspector__kv-key">Last seen</span>
            <span className="alm-inspector__kv-val alm-mono">
              {formatDate(lastEvent.timestamp)}
            </span>
          </div>
        </div>
      </div>

      {/* Related events timeline */}
      <div className="alm-inspector__section">
        <div className="alm-inspector__section-label">
          Related events ({relatedEvents.length})
        </div>
        {relatedEvents.length === 0 ? (
          <div className="alm-inspector__empty">
            No other events for this entity
          </div>
        ) : (
          <div className="alm-inspector__timeline">
            {relatedEvents.map((e) => (
              <div key={e.id} className="alm-inspector__timeline-entry">
                <span className="alm-inspector__timeline-time alm-mono">
                  {formatTime(e.timestamp)}
                </span>
                <span className="alm-inspector__timeline-type">
                  {e.event_type}
                </span>
                <Pill
                  label={e.outcome}
                  variant={outcomeVariant(e.outcome)}
                  size="sm"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent transitions */}
      <div className="alm-inspector__section">
        <div className="alm-inspector__section-label">Transition history</div>
        <div className="alm-inspector__timeline">
          {entityEvents
            .filter((e) => e.from_state && e.to_state && e.from_state !== e.to_state)
            .sort(
              (a, b) =>
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
            )
            .slice(0, 8)
            .map((e) => (
              <div key={e.id} className="alm-inspector__timeline-entry">
                <span className="alm-inspector__timeline-time alm-mono">
                  {formatTime(e.timestamp)}
                </span>
                <span className="alm-inspector__timeline-states alm-mono">
                  <span style={{ color: 'var(--alm-text-muted)' }}>
                    {e.from_state}
                  </span>
                  {' '}
                  <span style={{ color: 'var(--alm-text-faint)' }}>&rarr;</span>
                  {' '}
                  <span>{e.to_state}</span>
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
