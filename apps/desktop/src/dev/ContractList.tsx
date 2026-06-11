/**
 * ContractList — renders the registered contract registry table (spec 021 US1).
 *
 * Columns: name, version, direction, replay-safe, mismatch warning, schema path,
 * and a "View schema" action.
 */

import type { ContractMeta } from '@/api/commands';

interface ContractListProps {
  contracts: ContractMeta[];
  onViewSchema: (contract: ContractMeta) => void;
}

export function ContractList({ contracts, onViewSchema }: ContractListProps) {
  if (contracts.length === 0) {
    return (
      <p style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
        No contracts loaded.
      </p>
    );
  }

  return (
    <table
      style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--alm-text-xs)' }}
      aria-label="Contract registry"
    >
      <thead>
        <tr style={{ borderBottom: '1px solid var(--alm-border)', textAlign: 'left' }}>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Name</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Version</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Direction</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Replay</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Schema path</th>
          <th style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {contracts.map((c) => (
          <tr
            key={c.name}
            style={{ borderBottom: '1px solid var(--alm-border-subtle)' }}
            data-testid={`contract-row-${c.name}`}
          >
            <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)', fontFamily: 'monospace' }}>
              {c.mismatch === true && (
                <span
                  title="Version mismatch between TypeScript and Rust registries"
                  aria-label="Version mismatch warning"
                  style={{ color: 'var(--alm-warn)', marginRight: 'var(--alm-sp-1)' }}
                >
                  ⚠
                </span>
              )}
              {c.name}
            </td>
            <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>{c.version}</td>
            <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)', color: 'var(--alm-text-muted)' }}>
              {c.direction}
            </td>
            <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)', textAlign: 'center' }}>
              {c.replaySafe ? (
                <span
                  title="Replay-safe: read-only contract, replay allowed"
                  style={{ color: 'var(--alm-success)' }}
                >
                  ✓
                </span>
              ) : (
                <span
                  title="Not replay-safe: write contract, replay disabled"
                  style={{ color: 'var(--alm-text-muted)' }}
                >
                  —
                </span>
              )}
            </td>
            <td
              style={{
                padding: 'var(--alm-sp-1) var(--alm-sp-2)',
                fontFamily: 'monospace',
                maxWidth: 280,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--alm-text-muted)',
              }}
              title={c.schemaPath || 'Schema path not available'}
            >
              {c.schemaPath || <em>N/A</em>}
            </td>
            <td style={{ padding: 'var(--alm-sp-1) var(--alm-sp-2)' }}>
              <button
                type="button"
                className="alm-btn alm-btn--xs"
                onClick={() => onViewSchema(c)}
                aria-label={`View schema for ${c.name}`}
              >
                View schema
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
