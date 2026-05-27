export interface CoverageBarProps {
  label: string;
  value: number;
  max: number;
}

export function CoverageBar({ label, value, max }: CoverageBarProps) {
  const pct = Math.min(100, (value / max) * 100);
  const cls = pct < 40 ? '--low' : pct >= 80 ? '--ok' : '';
  return (
    <div className="alm-coverage">
      <span className="alm-coverage__label">{label}</span>
      <div className="alm-coverage__bar">
        <div
          className={`alm-coverage__fill${cls ? ` alm-coverage__fill${cls}` : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="alm-coverage__value">{value}h</span>
    </div>
  );
}
