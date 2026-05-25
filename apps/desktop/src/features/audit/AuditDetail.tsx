import type { AuditEntry, AuditOutcome } from '@/api/types';
import { Pill, KV, Box } from '@/ui';

export interface AuditDetailProps {
  entry: AuditEntry;
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

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function AuditDetail({ entry }: AuditDetailProps) {
  return (
    <div className="alm-audit-detail">
      {/* Header */}
      <div className="alm-audit-detail__header">
        <h2 className="alm-audit-detail__title alm-mono">{entry.event_type}</h2>
        <Pill
          label={entry.outcome}
          variant={outcomeVariant(entry.outcome)}
          size="sm"
        />
      </div>

      {/* Timestamp */}
      <div className="alm-audit-detail__timestamp alm-mono">
        {formatTimestamp(entry.timestamp)}
      </div>

      {/* Entity info */}
      <Box heading="Entity">
        <div className="alm-audit-detail__body-content">
          <KV label="Type" value={entry.entity_type} />
          <KV
            label="ID"
            value={<span className="alm-mono">{entry.entity_id}</span>}
          />
        </div>
      </Box>

      {/* State change */}
      {(entry.from_state || entry.to_state) && (
        <Box heading="State change">
          <div className="alm-audit-detail__state-change">
            {entry.from_state && entry.to_state && entry.from_state !== entry.to_state ? (
              <div className="alm-audit-detail__transition">
                <span className="alm-audit-detail__state alm-audit-detail__state--from">
                  {entry.from_state}
                </span>
                <span className="alm-audit-detail__arrow" aria-hidden="true">
                  &rarr;
                </span>
                <span className="alm-audit-detail__state alm-audit-detail__state--to">
                  {entry.to_state}
                </span>
              </div>
            ) : (
              <KV
                label="State"
                value={entry.to_state || entry.from_state || '--'}
              />
            )}
          </div>
        </Box>
      )}

      {/* Actor */}
      <Box heading="Actor">
        <div className="alm-audit-detail__body-content">
          <KV
            label="Actor"
            value={
              <span
                style={{
                  color:
                    entry.actor === 'system'
                      ? 'var(--alm-text-muted)'
                      : 'var(--alm-text)',
                }}
              >
                {entry.actor}
              </span>
            }
          />
        </div>
      </Box>

      {/* Detail */}
      {entry.detail && (
        <Box heading="Detail">
          <div className="alm-audit-detail__body-content">
            <p className="alm-audit-detail__detail-text">{entry.detail}</p>
          </div>
        </Box>
      )}
    </div>
  );
}
