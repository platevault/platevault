/**
 * ContractList — renders the registered contract registry table (spec 021 US1).
 *
 * Columns: name, version, direction, replay-safe, mismatch warning, schema path,
 * and a "View schema" action.
 */

import type { ContractMeta } from '@/bindings/index';

interface ContractListProps {
  contracts: ContractMeta[];
  onViewSchema: (contract: ContractMeta) => void;
}

export function ContractList({ contracts, onViewSchema }: ContractListProps) {
  if (contracts.length === 0) {
    return (
      <p className="alm-dev-contracts-list__empty">No contracts loaded.</p>
    );
  }

  return (
    <table
      className="alm-dev-contracts-list__table"
      aria-label="Contract registry"
    >
      <thead>
        <tr className="alm-dev-contracts-list__thead-row">
          <th className="alm-dev-contracts-list__th">Name</th>
          <th className="alm-dev-contracts-list__th">Version</th>
          <th className="alm-dev-contracts-list__th">Direction</th>
          <th className="alm-dev-contracts-list__th">Replay</th>
          <th className="alm-dev-contracts-list__th">Schema path</th>
          <th className="alm-dev-contracts-list__th">Actions</th>
        </tr>
      </thead>
      <tbody>
        {contracts.map((c) => (
          <tr
            key={c.name}
            className="alm-dev-contracts-list__row"
            data-testid={`contract-row-${c.name}`}
          >
            <td className="alm-dev-contracts-list__td-name">
              {c.mismatch === true && (
                <span
                  title="Version mismatch between TypeScript and Rust registries"
                  aria-label="Version mismatch warning"
                  className="alm-dev-contracts-list__mismatch-icon"
                >
                  ⚠
                </span>
              )}
              {c.name}
            </td>
            <td className="alm-dev-contracts-list__td">{c.version}</td>
            <td className="alm-dev-contracts-list__td-muted">{c.direction}</td>
            <td className="alm-dev-contracts-list__td-center">
              {c.replaySafe ? (
                <span
                  title="Replay-safe: read-only contract, replay allowed"
                  className="alm-dev-contracts-list__replay-ok"
                >
                  ✓
                </span>
              ) : (
                <span
                  title="Not replay-safe: write contract, replay disabled"
                  className="alm-dev-contracts-list__replay-na"
                >
                  —
                </span>
              )}
            </td>
            <td
              className="alm-dev-contracts-list__td-schema"
              title={c.schemaPath || 'Schema path not available'}
            >
              {c.schemaPath || <em>N/A</em>}
            </td>
            <td className="alm-dev-contracts-list__td">
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
