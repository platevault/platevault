// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { Folder } from 'lucide-react';
import { Btn } from './Btn';
import { useDirectoryPicker, type LastPathKind } from '@/shared/native/picker';
import { m } from '@/lib/i18n';

export interface DirPickerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value?: string;
  onChange: (path: string) => void;
  label?: string;
  /** Affordance kind for last-path persistence. */
  lastPathKind?: LastPathKind;
}

export const DirPicker = forwardRef<HTMLDivElement, DirPickerProps>(
  function DirPicker(
    { value, onChange, label, lastPathKind, className, ...rest },
    ref,
  ) {
    const { pick, loading, error } = useDirectoryPicker();

    const handleChoose = async () => {
      const result = await pick(undefined, lastPathKind);
      if (result.path) {
        onChange(result.path);
      }
    };

    const rootCls = ['pv-kv-row', className].filter(Boolean).join(' ');

    return (
      <div ref={ref} className={rootCls} {...rest}>
        {label && <span className="pv-kv-row__label">{label}</span>}
        <span className="pv-kv-row__value">
          <Folder size={14} />
          {/*
            Manual entry (#662): the native picker guarantees an existing
            directory but can't be scripted (WebDriver can't drive OS dialogs)
            and can't produce inputs the journey's inline validation needs to
            reject (nonexistent path, duplicate, overlap, file-not-folder) —
            those all require typing/pasting a path. Real path validation still
            happens where it always did (each consumer's onChange handler /
            backend round-trip); this is just the missing input affordance.
          */}
          <input
            type="text"
            className="pv-dir-picker__input pv-mono"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={m.ui_dir_picker_no_folder()}
            aria-label={label ?? m.ui_dir_picker_manual_path_aria()}
          />
          <Btn size="sm" onClick={handleChoose} disabled={loading}>
            {loading ? m.setup_choosing() : m.ui_dir_picker_choose()}
          </Btn>
        </span>
        {error && (
          <div className="pv-dir-picker__error" title={error.message}>
            {m.ui_dir_picker_error()}
          </div>
        )}
      </div>
    );
  },
);
DirPicker.displayName = 'DirPicker';
