export interface SegControlProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  danger?: boolean;
}

export function SegControl({ options, value, onChange, danger }: SegControlProps) {
  return (
    <div className="alm-seg">
      {options.map(o => (
        <button
          key={o}
          className={[
            'alm-seg__btn',
            value === o && 'alm-seg__btn--active',
            danger && o === 'Delete' && 'alm-seg__btn--danger',
          ].filter(Boolean).join(' ')}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
