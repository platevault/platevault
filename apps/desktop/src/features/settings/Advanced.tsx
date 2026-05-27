import { useState } from 'react';
import { Select } from '@base-ui-components/react/select';
import { Switch } from '@base-ui-components/react/switch';
import { Btn, KV, Box } from '@/ui';

interface AdvancedProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export function Advanced({ save }: AdvancedProps) {
  const [logLevel, setLogLevel] = useState<string>('info');
  const [debugMode, setDebugMode] = useState(false);

  const handleLevelChange = (level: string | null) => {
    if (level === null) return;
    setLogLevel(level);
    save('advanced', { log_level: level, debug_mode: debugMode });
  };

  const handleDebugToggle = (checked: boolean) => {
    setDebugMode(checked);
    save('advanced', { log_level: logLevel, debug_mode: checked });
  };

  const handleExportDiagnostics = () => {
    console.log('Export diagnostics triggered');
  };

  return (
    <div className="alm-advanced">
      {/* Application log level */}
      <section className="alm-advanced__section">
        <h3 className="alm-advanced__subtitle">Application Log Level</h3>
        <div className="alm-advanced__field">
          <label className="alm-advanced__field-label" htmlFor="adv-log-level">
            Log level
          </label>
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
      </section>

      {/* Debug toggle */}
      <section className="alm-advanced__section">
        <h3 className="alm-advanced__subtitle">Debug Mode</h3>
        <div className="alm-advanced__toggle-row">
          <label className="alm-advanced__toggle-label">
            <Switch.Root
              className="alm-switch"
              checked={debugMode}
              onCheckedChange={handleDebugToggle}
              aria-label="Enable debug mode"
            >
              <Switch.Thumb className="alm-switch__thumb" />
            </Switch.Root>
            <span>
              Enable verbose logging and developer diagnostics
            </span>
          </label>
        </div>
      </section>

      {/* Database info */}
      <section className="alm-advanced__section">
        <h3 className="alm-advanced__subtitle">Database</h3>
        <Box>
          <KV label="Engine" value="SQLite" />
          <KV label="Location" value={<code className="alm-mono">~/.alm/astro-library.db</code>} />
          <KV label="Size" value="24.8 MB" />
          <KV label="Schema version" value="v1.0" />
          <KV label="Records" value="142,318 files / 22 sessions / 3 projects" />
        </Box>
      </section>

      {/* Export diagnostics */}
      <section className="alm-advanced__section">
        <h3 className="alm-advanced__subtitle">Diagnostics</h3>
        <p className="alm-advanced__hint">
          Export a diagnostics bundle containing application logs, database
          statistics, and configuration (no image data or file contents).
        </p>
        <Btn onClick={handleExportDiagnostics}>
          Export diagnostics
        </Btn>
      </section>
    </div>
  );
}
