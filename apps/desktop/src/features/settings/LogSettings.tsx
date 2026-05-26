import { useState } from 'react';
import { Select } from '@base-ui-components/react/select';
import { Btn } from '@/ui';

interface LogSettingsProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export function LogSettings({ save }: LogSettingsProps) {
  const [logLevel, setLogLevel] = useState<string>('info');
  const [retentionDays, setRetentionDays] = useState(30);

  const handleLevelChange = (level: string | null) => {
    if (level === null) return;
    setLogLevel(level);
    save('logs', { log_level: level, log_retention_days: retentionDays });
  };

  const handleRetentionChange = (days: number) => {
    setRetentionDays(days);
    save('logs', { log_level: logLevel, log_retention_days: days });
  };

  const handleExport = () => {
    // In a real app, this triggers a file-save dialog via Tauri
    console.log('Export logs triggered');
  };

  return (
    <div className="alm-logs">
      <div className="alm-logs__field">
        <span className="alm-logs__label">Log level</span>
        <Select.Root value={logLevel} onValueChange={handleLevelChange}>
          <Select.Trigger className="alm-select" aria-label="Log level">
            <Select.Value />
            <Select.Icon className="alm-select__icon" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner>
              <Select.Popup className="alm-select__popup">
                {LOG_LEVELS.map((level) => (
                  <Select.Item key={level} value={level} className="alm-select__item">
                    <Select.ItemText>{level}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>

      <div className="alm-logs__field">
        <label className="alm-logs__label" htmlFor="retention-days">
          Retention (days)
        </label>
        <input
          id="retention-days"
          type="number"
          className="alm-input"
          value={retentionDays}
          min={1}
          max={365}
          onChange={(e) => handleRetentionChange(parseInt(e.target.value, 10) || 1)}
        />
      </div>

      <div className="alm-logs__actions">
        <Btn onClick={handleExport}>Export logs</Btn>
      </div>
    </div>
  );
}
