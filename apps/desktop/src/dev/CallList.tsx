// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CallList — renders the recent-calls ring buffer table (spec 021 US2).
 *
 * Columns: id, contract, version, started_at, duration, outcome, truncation,
 * and actions (view schema, replay when replay-safe).
 */

import type { ContractCall, ContractMeta } from '@/bindings/index';

interface CallListProps {
  calls: ContractCall[];
  contracts: ContractMeta[];
  onViewSchema: (call: ContractCall) => void;
  onReplay: (call: ContractCall) => void;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
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

export function CallList({
  calls,
  contracts,
  onViewSchema,
  onReplay,
}: CallListProps) {
  if (calls.length === 0) {
    return (
      <p className="pv-dev-calls__empty">
        No calls recorded yet. Make some API calls with devMode on.
      </p>
    );
  }

  return (
    <table className="pv-dev-calls__table" aria-label="Recent contract calls">
      <thead>
        <tr className="pv-dev-calls__thead-row">
          <th className="pv-dev-calls__th">ID</th>
          <th className="pv-dev-calls__th">Contract</th>
          <th className="pv-dev-calls__th">Version</th>
          <th className="pv-dev-calls__th">Started</th>
          <th className="pv-dev-calls__th">Duration</th>
          <th className="pv-dev-calls__th">Outcome</th>
          <th className="pv-dev-calls__th">Actions</th>
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
              className="pv-dev-calls__row"
              data-testid={`call-row-${call.id}`}
            >
              <td className="pv-dev-calls__td--id">{call.id}</td>
              <td className="pv-dev-calls__td--contract">
                {call.contract}
                {call.payloadTruncated && (
                  <span
                    title="Payload was truncated (exceeded 64 KB)"
                    className="pv-dev-calls__truncated"
                  >
                    ⚠T
                  </span>
                )}
              </td>
              <td className="pv-dev-calls__td">{call.contractVersion}</td>
              <td className="pv-dev-calls__td--started">
                {formatStarted(call.startedAt)}
              </td>
              <td className="pv-dev-calls__td">
                {formatDuration(call.durationMs)}
              </td>
              <td className="pv-dev-calls__td">
                {isError ? (
                  <span
                    className="pv-dev-calls__outcome--error"
                    title={call.error?.message}
                  >
                    error: {call.error?.code}
                  </span>
                ) : (
                  <span className="pv-dev-calls__outcome--ok">ok</span>
                )}
              </td>
              <td className="pv-dev-calls__td--actions">
                <button
                  type="button"
                  className="pv-btn pv-btn--xs"
                  onClick={() => onViewSchema(call)}
                  aria-label={`View schema for ${call.contract} v${call.contractVersion}`}
                >
                  Schema
                </button>
                <button
                  type="button"
                  className={
                    'pv-btn pv-btn--xs' +
                    (isReplaySafe
                      ? ' pv-dev-calls__replay-btn--safe'
                      : ' pv-dev-calls__replay-btn--unsafe')
                  }
                  onClick={() => onReplay(call)}
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
