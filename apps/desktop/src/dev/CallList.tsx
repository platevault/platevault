/**
 * CallList — renders the recent-calls ring buffer table (spec 021 US2).
 *
 * Columns: id, contract, version, started_at, duration, outcome, truncation,
 * and actions (view schema, replay when replay-safe).
 */

import type { ContractCall, ContractMeta } from '@/api/commands';

interface CallListProps {
  calls: ContractCall[];
  contracts: ContractMeta[];
  onViewSchema: (call: ContractCall) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatStarted(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export function CallList({ calls, contracts, onViewSchema }: CallListProps) {
  if (calls.length === 0) {
    return (
      <p style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
        No calls recorded yet. Make some API calls with devMode on.
      </p>
    );
  }

  return (
    <table
      style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--alm-text-xs)' }}
      aria-label="Recent contract calls"
    >
      <thead>
        <tr style={{ borderBottom: '1px solid var(--alm-border)', textAlign: 'left' }}>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>ID</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Contract</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Version</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Started</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Duration</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Outcome</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {calls.map((call) => {
          const contractMeta = contracts.find((c) => c.name === call.contract);
          const isReplaySafe = contractMeta?.replaySafe === true;
          const isError = call.error !== undefined;

          return (
            <tr
              key={call.id}
              style={{ borderBottom: '1px solid var(--alm-border-subtle)' }}
              data-testid={`call-row-${call.id}`}
            >
              <td
                style={{
                  padding: 'var(--alm-sp-1) var(--alm-sp-2)',
                  fontFamily: 'monospace',
                  color: 'var(--alm-text-muted)',
                  fontSize: '0.7rem',
                }}
              >
                {call.id}
              </td>
              <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)', fontFamily: 'monospace' }}>
                {call.contract}
                {call.payloadTruncated && (
                  <span
                    title="Payload was truncated (exceeded 64 KB)"
                    style={{ marginLeft: 'var(--alm-sp-1)', color: 'var(--alm-warn)' }}
                  >
                    ⚠T
                  </span>
                )}
              </td>
              <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>
                {call.contractVersion}
              </td>
              <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)', color: 'var(--alm-text-muted)' }}>
                {formatStarted(call.startedAt)}
              </td>
              <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>
                {formatDuration(call.durationMs)}
              </td>
              <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>
                {isError ? (
                  <span
                    style={{ color: 'var(--alm-danger)', fontFamily: 'monospace' }}
                    title={call.error?.message}
                  >
                    error: {call.error?.code}
                  </span>
                ) : (
                  <span style={{ color: 'var(--alm-success)' }}>ok</span>
                )}
              </td>
              <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)', display: 'flex', gap: 'var(--alm-sp-1)' }}>
                <button
                  type="button"
                  className="alm-btn alm-btn--xs"
                  onClick={() => onViewSchema(call)}
                  aria-label={`View schema for ${call.contract} v${call.contractVersion}`}
                >
                  Schema
                </button>
                <button
                  type="button"
                  className="alm-btn alm-btn--xs"
                  disabled={!isReplaySafe}
                  title={
                    isReplaySafe
                      ? `Replay ${call.contract}`
                      : 'Replay disabled: write contract'
                  }
                  aria-label={
                    isReplaySafe
                      ? `Replay call to ${call.contract}`
                      : `Replay disabled for write contract ${call.contract}`
                  }
                  aria-disabled={!isReplaySafe}
                  style={{ opacity: isReplaySafe ? 1 : 0.4, cursor: isReplaySafe ? 'pointer' : 'not-allowed' }}
                >
                  Replay
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
