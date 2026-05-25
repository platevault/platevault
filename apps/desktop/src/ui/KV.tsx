import type { ReactNode } from 'react';
import type { ProvenanceOrigin, ConfidenceLevel } from '@/api/types';
import { Provenance } from './Provenance';
import { Confidence } from './Confidence';

export interface KVProps {
  label: string;
  value: ReactNode;
  origin?: ProvenanceOrigin;
  confidence?: ConfidenceLevel;
}

export function KV({ label, value, origin, confidence }: KVProps) {
  return (
    <div className="alm-kv-row">
      <span className="alm-kv-row__label">{label}</span>
      <span className="alm-kv-row__value">
        {value}
        {origin && <Provenance origin={origin} />}
        {confidence && <Confidence level={confidence} />}
      </span>
    </div>
  );
}
