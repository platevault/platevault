import { useState } from 'react';
import { Select } from '@base-ui-components/react/select';
import { DirPicker } from '@/ui';

interface CleanupPolicyProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

const DATA_TYPES = [
  'Registered',
  'Calibrated',
  'Drizzle',
  'Weights',
  'Rejection maps',
  'Logs',
] as const;

const TOOLS = ['PI', 'Siril', 'Planetary'] as const;
const ACTIONS = ['Keep', 'Archive', 'Trash', 'Delete'] as const;

type MatrixState = Record<string, Record<string, string>>;

function buildInitialMatrix(): MatrixState {
  const matrix: MatrixState = {};
  for (const dt of DATA_TYPES) {
    matrix[dt] = {};
    for (const tool of TOOLS) {
      matrix[dt][tool] = 'Keep';
    }
  }
  // Some sensible defaults
  matrix['Registered']['PI'] = 'Trash';
  matrix['Registered']['Siril'] = 'Trash';
  matrix['Calibrated']['PI'] = 'Trash';
  matrix['Calibrated']['Siril'] = 'Trash';
  matrix['Weights']['PI'] = 'Trash';
  matrix['Weights']['Siril'] = 'Trash';
  matrix['Weights']['Planetary'] = 'Delete';
  matrix['Rejection maps']['PI'] = 'Trash';
  matrix['Rejection maps']['Siril'] = 'Delete';
  matrix['Rejection maps']['Planetary'] = 'Delete';
  return matrix;
}

function CleanupSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (action: string) => void;
  label: string;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(newValue) => {
        if (newValue !== null) onChange(newValue);
      }}
    >
      <Select.Trigger
        className="alm-select alm-select--sm"
        aria-label={label}
      >
        <Select.Value />
        <Select.Icon className="alm-select__icon" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup className="alm-select__popup">
            {ACTIONS.map((a) => (
              <Select.Item key={a} value={a} className="alm-select__item">
                <Select.ItemText>{a}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function CleanupPolicy({ save }: CleanupPolicyProps) {
  const [processingDir, setProcessingDir] = useState('processing/');
  const [matrix, setMatrix] = useState<MatrixState>(buildInitialMatrix);

  const handleDirChange = (path: string) => {
    setProcessingDir(path);
    save('cleanup', { processing_directory: path, matrix });
  };

  const handleCellChange = (dataType: string, tool: string, action: string) => {
    const updated = {
      ...matrix,
      [dataType]: { ...matrix[dataType], [tool]: action },
    };
    setMatrix(updated);
    save('cleanup', { processing_directory: processingDir, matrix: updated });
  };

  return (
    <div className="alm-cleanup">
      <DirPicker
        value={processingDir}
        onChange={handleDirChange}
        label="Processing directory"
      />

      <table className="alm-cleanup__matrix">
        <thead>
          <tr>
            <th>Data Type</th>
            {TOOLS.map((tool) => (
              <th key={tool}>{tool}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DATA_TYPES.map((dt) => (
            <tr key={dt}>
              <td>{dt}</td>
              {TOOLS.map((tool) => (
                <td key={tool}>
                  <CleanupSelect
                    value={matrix[dt][tool]}
                    onChange={(action) => handleCellChange(dt, tool, action)}
                    label={`${dt} - ${tool} cleanup action`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
