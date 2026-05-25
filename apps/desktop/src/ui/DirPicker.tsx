import { Folder } from 'lucide-react';
import { Btn } from './Btn';

export interface DirPickerProps {
  value?: string;
  onChange: (path: string) => void;
  label?: string;
}

export function DirPicker({ value, onChange, label }: DirPickerProps) {
  const handleChoose = async () => {
    console.log('[DirPicker] handleChoose fired');
    try {
      console.log('[DirPicker] importing plugin-dialog...');
      const mod = await import('@tauri-apps/plugin-dialog');
      console.log('[DirPicker] import ok, calling open()...');
      const selected = await mod.open({ directory: true, multiple: false });
      console.log('[DirPicker] open() returned:', selected);
      if (typeof selected === 'string') {
        onChange(selected);
      }
    } catch (err) {
      console.error('[DirPicker] error:', err);
      const path = window.prompt('Enter folder path:');
      if (path) onChange(path);
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
