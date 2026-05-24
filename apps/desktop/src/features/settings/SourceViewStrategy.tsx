import { useState } from 'react';
import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';

interface SourceViewStrategyProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface Strategy {
  id: string;
  name: string;
  description: string;
  platformNote: string;
}

const STRATEGIES: Strategy[] = [
  {
    id: 'symlinks',
    name: 'Symlinks (recommended)',
    description:
      'Creates symbolic links pointing to source files. Does not duplicate data on disk.',
    platformNote: 'Works on macOS, Linux, and Windows (with developer mode or elevated privileges).',
  },
  {
    id: 'junctions',
    name: 'Junctions (Windows)',
    description:
      'Creates NTFS junction points for directories. No extra disk space used.',
    platformNote: 'Windows only. Requires NTFS filesystem.',
  },
  {
    id: 'copy',
    name: 'Copy',
    description:
      'Creates full copies of source files. Uses additional disk space equal to source size.',
    platformNote: 'Works on all platforms. Safest but most disk-intensive.',
  },
  {
    id: 'hardlinks',
    name: 'Hardlinks',
    description:
      'Creates hard links that share the same inode. No extra disk space, but files must be on the same filesystem.',
    platformNote: 'Works on macOS, Linux, and NTFS. Cannot span filesystems.',
  },
];

export function SourceViewStrategy({ save }: SourceViewStrategyProps) {
  const [selected, setSelected] = useState('symlinks');

  const handleChange = (value: unknown) => {
    const id = value as string;
    setSelected(id);
    save('source_view', { strategy: id });
  };

  return (
    <div className="alm-svs">
      <RadioGroup
        value={selected}
        onValueChange={handleChange}
        aria-label="Source view strategy"
        className="alm-svs__table-wrapper"
      >
        <table className="alm-svs__table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Strategy</th>
              <th>Description</th>
              <th>Platform</th>
            </tr>
          </thead>
          <tbody>
            {STRATEGIES.map((strat) => (
              <tr
                key={strat.id}
                className={selected === strat.id ? 'alm-svs__row--selected' : undefined}
                onClick={() => handleChange(strat.id)}
              >
                <td>
                  <Radio.Root
                    value={strat.id}
                    className="alm-radio"
                    aria-label={strat.name}
                  >
                    <Radio.Indicator className="alm-radio__indicator" />
                  </Radio.Root>
                </td>
                <td>
                  <strong>{strat.name}</strong>
                </td>
                <td>{strat.description}</td>
                <td>
                  <span className="alm-svs__platform">{strat.platformNote}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </RadioGroup>
    </div>
  );
}
