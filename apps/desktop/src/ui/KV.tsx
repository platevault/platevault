import type { ReactNode } from 'react';

export interface KVProps {
  label: string;
  value: ReactNode;
  provenance?: string;
  mono?: boolean;
}

export function KV({ label, value, provenance, mono }: KVProps) {
  return (
    <div className="alm-kv">
      <span className="alm-kv__label">{label}</span>
      <span
        className="alm-kv__value"
        style={mono ? { fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)' } : undefined}
      >
        {value}
        {provenance && <span className="alm-kv__provenance">{provenance}</span>}
      </span>
    </div>
  );
}
