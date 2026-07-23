// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

export interface KVProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  provenance?: string;
  mono?: boolean;
}

export const KV = forwardRef<HTMLDivElement, KVProps>(function KV(
  { label, value, provenance, mono, className, ...rest },
  ref,
) {
  const cls = ['pv-kv', className].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={cls} {...rest}>
      <span className="pv-kv__label">{label}</span>
      <span
        className={`pv-kv__value${mono ? ' pv-mono' : ''}`}
        // eslint-disable-next-line no-restricted-syntax -- dynamic: conditional compact-size passthrough (caller-supplied prop). Family comes from the shared `.pv-mono` utility (spec 055), not an inline override.
        style={mono ? { fontSize: 'var(--pv-text-xs)' } : undefined}
      >
        {value}
        {provenance && <span className="pv-kv__provenance">{provenance}</span>}
      </span>
    </div>
  );
});
KV.displayName = 'KV';
