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
  const cls = ['alm-kv', className].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={cls} {...rest}>
      <span className="alm-kv__label">{label}</span>
      <span
        className={`alm-kv__value${mono ? ' alm-mono' : ''}`}
        // eslint-disable-next-line no-restricted-syntax -- dynamic: conditional compact-size passthrough (caller-supplied prop). Family comes from the shared `.alm-mono` utility (spec 055), not an inline override.
        style={mono ? { fontSize: 'var(--alm-text-xs)' } : undefined}
      >
        {value}
        {provenance && <span className="alm-kv__provenance">{provenance}</span>}
      </span>
    </div>
  );
});
KV.displayName = 'KV';
