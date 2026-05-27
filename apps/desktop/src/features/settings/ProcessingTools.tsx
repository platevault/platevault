import { useState } from 'react';
import { Toggle, Table, Pill } from '@/ui';
import { PROCESSING_TOOLS, type ProcessingToolFixture } from '@/data/fixtures/settings';

interface ProcessingToolsProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

export function ProcessingTools({ save }: ProcessingToolsProps) {
  const [tools, setTools] = useState<ProcessingToolFixture[]>(PROCESSING_TOOLS);

  const handleToggle = (id: number, enabled: boolean) => {
    const updated = tools.map((t) => (t.id === id ? { ...t, enabled } : t));
    setTools(updated);
    save('processing_tools', { tools: updated });
  };

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Configured Tools</div>
        <Table
          columns={[
            { key: 'name', label: 'Tool' },
            { key: 'version', label: 'Version', style: { width: 100 } },
            { key: 'path', label: 'Executable path' },
            { key: 'status', label: 'Status', style: { width: 100 } },
            { key: 'enabled', label: 'Enabled', style: { width: 80 } },
          ]}
          rows={tools.map((t) => ({
            name: <strong>{t.name}</strong>,
            version: t.version
              ? <code className="alm-mono">{t.version}</code>
              : <span style={{ color: 'var(--alm-text-muted)' }}>—</span>,
            path: t.path
              ? <code className="alm-mono" style={{ fontSize: 'var(--alm-text-2xs)', wordBreak: 'break-all' }}>{t.path}</code>
              : <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>Not configured</span>,
            status: t.detected
              ? <Pill variant="ok">Detected</Pill>
              : <Pill variant="neutral">Not found</Pill>,
            enabled: (
              <Toggle
                checked={t.enabled}
                onChange={(v) => handleToggle(t.id, v)}
              />
            ),
          }))}
        />
      </div>
    </>
  );
}
