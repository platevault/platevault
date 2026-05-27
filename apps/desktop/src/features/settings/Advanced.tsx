import { useState } from 'react';
import { Btn, RadioGroup } from '@/ui';

interface AdvancedProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export function Advanced({ save }: AdvancedProps) {
  const [logLevel, setLogLevel] = useState<LogLevel>('info');

  const handleExport = () => console.log('Export DB triggered');
  const handleReset = () => console.log('Reset preferences triggered');

  return (
    <>
      {/* Database info */}
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Database</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Location</div>
          <div className="alm-settings__row-content">
            <code className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>~/.alm/astro-library.db</code>
          </div>
        </div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Engine</div>
          <div className="alm-settings__row-content">SQLite</div>
        </div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Size</div>
          <div className="alm-settings__row-content">24.8 MB</div>
        </div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-label">Schema version</div>
          <div className="alm-settings__row-content">v1.0</div>
        </div>
        <div className="alm-settings__row" style={{ borderBottom: 'none' }}>
          <div className="alm-settings__row-label">Records</div>
          <div className="alm-settings__row-content">142,318 files · 22 sessions · 3 projects</div>
        </div>
        <div style={{ marginTop: 'var(--alm-sp-3)' }}>
          <Btn size="sm" onClick={handleExport}>Export database</Btn>
        </div>
      </div>

      {/* Log level */}
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Log Level</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-content">
            <RadioGroup
              options={[
                { value: 'trace', label: 'Trace', desc: 'All internal events — very verbose' },
                { value: 'debug', label: 'Debug', desc: 'Diagnostic detail useful during development' },
                { value: 'info', label: 'Info', desc: 'Normal operational messages (default)' },
                { value: 'warn', label: 'Warn', desc: 'Warnings only' },
                { value: 'error', label: 'Error', desc: 'Errors only — quietest' },
              ]}
              value={logLevel}
              onChange={(v) => { setLogLevel(v as LogLevel); save('advanced', { log_level: v }); }}
            />
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Danger Zone</div>
        <div style={{
          border: '1px solid var(--alm-danger)',
          borderRadius: 'var(--alm-radius)',
          padding: 'var(--alm-sp-4)',
        }}>
          <div style={{ marginBottom: 'var(--alm-sp-2)' }}>
            <strong style={{ fontSize: 'var(--alm-text-sm)' }}>Reset preferences</strong>
          </div>
          <p style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-sp-3)' }}>
            Resets all UI preferences (theme, density, font size) to defaults. Library roots, equipment,
            and session data are not affected.
          </p>
          <Btn size="sm" variant="danger" onClick={handleReset}>
            Reset preferences
          </Btn>
        </div>
      </div>
    </>
  );
}
