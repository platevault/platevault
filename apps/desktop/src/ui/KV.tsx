import { forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

export interface KVProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  provenance?: string;
  mono?: boolean;
}

export const KV = forwardRef<HTMLDivElement, KVProps>(
  function KV({ label, value, provenance, mono, className, ...rest }, ref) {
    const cls = ['alm-kv', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={cls} {...rest}>
        <span className="alm-kv__label">{label}</span>
        <span
          className="alm-kv__value"
          // eslint-disable-next-line no-restricted-syntax -- dynamic: conditional compact-size passthrough (caller-supplied prop). Font family is enforced globally (reset.css); never set here.
          style={mono ? { fontSize: 'var(--alm-text-xs)' } : undefined}
        >
          {value}
          {provenance && <span className="alm-kv__provenance">{provenance}</span>}
        </span>
      </div>
    );
  }
);
KV.displayName = 'KV';
