export interface RadioOption {
  value: string;
  label: string;
  desc?: string;
}
export interface RadioGroupProps {
  options: (string | RadioOption)[];
  value: string;
  onChange: (value: string) => void;
}

export function RadioGroup({ options, value, onChange }: RadioGroupProps) {
  return (
    <div className="alm-radio-group">
      {options.map(o => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        const desc = typeof o === 'string' ? null : o.desc;
        return (
          <button
            key={val}
            className={`alm-radio ${value === val ? 'alm-radio--active' : ''}`}
            onClick={() => onChange(val)}
          >
            <div>{label}</div>
            {desc && <div className="alm-radio__desc">{desc}</div>}
          </button>
        );
      })}
    </div>
  );
}
