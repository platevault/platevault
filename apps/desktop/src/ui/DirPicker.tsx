import { Folder } from 'lucide-react';
import { Btn } from './Btn';

export interface DirPickerProps {
  value?: string;
  onChange: (path: string) => void;
  label?: string;
}

export function DirPicker({ value, onChange, label }: DirPickerProps) {
  const handleChoose = async () => {
    // Type-stub: Tauri dialog not wired yet
    const tauri = await import('@tauri-apps/api');
    const selected = await (tauri as any).dialog?.open({ directory: true });
    if (typeof selected === 'string') {
      onChange(selected);
    }
  };

  return (
    <div className="alm-kv-row">
      {label && <span className="alm-kv-row__label">{label}</span>}
      <span className="alm-kv-row__value">
        <Folder size={14} />
        <span style={{ fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || 'No folder selected'}
        </span>
        <Btn size="sm" onClick={handleChoose}>Choose folder&hellip;</Btn>
      </span>
    </div>
  );
}
