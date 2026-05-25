import { clsx } from 'clsx';
import type { ConfidenceLevel } from '@/api/types';

const LEVEL_CONFIG: Record<ConfidenceLevel, { width: string; color: string; label: string }> = {
  unknown: { width: '0%', color: 'var(--alm-gray-300)', label: 'Unknown' },
  low: { width: '20%', color: 'var(--alm-danger)', label: 'Low' },
  medium: { width: '50%', color: 'var(--alm-warn)', label: 'Medium' },
  high: { width: '75%', color: 'var(--alm-ok)', label: 'High' },
  confirmed: { width: '100%', color: 'var(--alm-ok)', label: 'Confirmed' },
  rejected: { width: '100%', color: 'var(--alm-danger)', label: 'Rejected' },
};

export interface ConfidenceProps {
  level: ConfidenceLevel;
}

export function Confidence({ level }: ConfidenceProps) {
  const config = LEVEL_CONFIG[level];
  return (
    <span className="alm-confidence" title={config.label}>
      <span
        className="alm-confidence__track"
        style={{ display: 'inline-block', width: 40, height: 4, background: 'var(--alm-gray-200)', borderRadius: 2, verticalAlign: 'middle' }}
      >
        <span
          className="alm-confidence__fill"
          style={{ display: 'block', width: config.width, height: '100%', background: config.color, borderRadius: 2 }}
        />
      </span>
      <span className="alm-confidence__label" style={{ marginLeft: 4, fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
        {config.label}
      </span>
    </span>
  );
}
