import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { Folder } from 'lucide-react';
import { Btn } from './Btn';
import { useDirectoryPicker, type LastPathKind } from '@/shared/native/picker';

export interface DirPickerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value?: string;
  onChange: (path: string) => void;
  label?: string;
  /** Affordance kind for last-path persistence. */
  lastPathKind?: LastPathKind;
}

export const DirPicker = forwardRef<HTMLDivElement, DirPickerProps>(
  function DirPicker({ value, onChange, label, lastPathKind, className, ...rest }, ref) {
    const { pick, loading, error } = useDirectoryPicker();

    const handleChoose = async () => {
      const result = await pick(undefined, lastPathKind);
      if (result.path) {
        onChange(result.path);
      }
    };

    const rootCls = ['alm-kv-row', className].filter(Boolean).join(' ');

    return (
      <div ref={ref} className={rootCls} {...rest}>
        {label && <span className="alm-kv-row__label">{label}</span>}
        <span className="alm-kv-row__value">
          <Folder size={14} />
          <span className="alm-dir-picker__path">
            {value || 'No folder selected'}
          </span>
          <Btn size="sm" onClick={handleChoose} disabled={loading}>
            {loading ? 'Choosing…' : 'Choose folder…'}
          </Btn>
        </span>
        {error && (
          <div className="alm-dir-picker__error" title={error.message}>
            Couldn&apos;t open the folder picker.
          </div>
        )}
      </div>
    );
  }
);
DirPicker.displayName = 'DirPicker';
