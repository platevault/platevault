import { useState } from 'react';
import { Select } from '@base-ui-components/react/select';
import { m } from '@/lib/i18n';

interface SourceViewStrategyProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface StrategyOption {
  id: string;
  label: string;
  description: string;
}

const STRATEGIES: StrategyOption[] = [
  {
    id: 'junctions',
    label: m.settings_sourceview_label_junctions(),
    description:
      'Directory junctions on Windows. WBPP-friendly, no admin privileges required. Only works on the same volume.',
  },
  {
    id: 'symlinks',
    label: m.settings_sourceview_label_symlinks(),
    description:
      'POSIX-style symlinks. Cross-platform, cross-volume. May require admin/developer mode on Windows.',
  },
  {
    id: 'hardlinks',
    label: m.settings_sourceview_label_hardlinks(),
    description:
      'Same-volume file links sharing an inode. Zero extra disk usage but cannot cross volume boundaries.',
  },
  {
    id: 'copy',
    label: m.settings_sourceview_label_copy(),
    description:
      'Duplicate every source file into the project tree. Maximum compatibility but uses significant disk space.',
  },
];

export function SourceViewStrategy({ save }: SourceViewStrategyProps) {
  const [selected, setSelected] = useState('junctions');

  const handleChange = (value: string | null) => {
    if (value === null) return;
    setSelected(value);
    save('source_view', { strategy: value });
  };

  const current = STRATEGIES.find((s) => s.id === selected);

  return (
    <div className="alm-svs">
      <div className="alm-svs__field">
        <label className="alm-svs__label" htmlFor="svs-strategy">
          {m.settings_sourceview_default_strategy()}
        </label>
        <Select.Root value={selected} onValueChange={handleChange}>
          <Select.Trigger className="alm-select" aria-label={m.settings_sourceview_strategy_aria()}>
            <Select.Value />
            <Select.Icon className="alm-select__icon" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner>
              <Select.Popup className="alm-select__popup">
                {STRATEGIES.map((s) => (
                  <Select.Item key={s.id} value={s.id} className="alm-select__item">
                    <Select.ItemText>{s.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>

      {current && (
        <p className="alm-svs__description">{current.description}</p>
      )}

      <div className="alm-svs__all-options">
        {STRATEGIES.map((s) => (
          <div key={s.id} className="alm-svs__option-card">
            <strong className="alm-svs__option-name">{s.label}</strong>
            <p className="alm-svs__option-desc">{s.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
