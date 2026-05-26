import { useState } from 'react';
import { Switch } from '@base-ui-components/react/switch';
import { DirPicker } from '@/ui';

interface ToolsProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface ToolConfig {
  id: string;
  label: string;
  path: string;
  version: string;
  enabled: boolean;
}

const INITIAL_TOOLS: ToolConfig[] = [
  {
    id: 'pixinsight',
    label: 'PixInsight',
    path: '/Applications/PixInsight/PixInsight.app',
    version: '1.8.9-6',
    enabled: true,
  },
  {
    id: 'siril',
    label: 'Siril',
    path: '',
    version: 'Not detected',
    enabled: false,
  },
  {
    id: 'planetary',
    label: 'Planetary (AutoStakkert / Registax)',
    path: '',
    version: 'Not detected',
    enabled: false,
  },
];

export function Tools({ save }: ToolsProps) {
  const [tools, setTools] = useState<ToolConfig[]>(INITIAL_TOOLS);

  const handleChange = (id: string, field: keyof ToolConfig, value: string | boolean) => {
    const updated = tools.map((t) =>
      t.id === id ? { ...t, [field]: value } : t,
    );
    setTools(updated);
    save('tools', {
      tools: updated.map(({ id, path, enabled }) => ({ id, path, enabled })),
    });
  };

  return (
    <div className="alm-tools">
      {tools.map((tool) => (
        <div key={tool.id} className="alm-tools__item">
          <div className="alm-tools__header">
            <label className="alm-tools__toggle">
              <Switch.Root
                className="alm-switch"
                checked={tool.enabled}
                onCheckedChange={(checked) => handleChange(tool.id, 'enabled', checked)}
                aria-label={`Enable ${tool.label}`}
              >
                <Switch.Thumb className="alm-switch__thumb" />
              </Switch.Root>
              <strong>{tool.label}</strong>
            </label>
            <span className="alm-tools__version">{tool.version}</span>
          </div>
          <DirPicker
            value={tool.path}
            onChange={(path) => handleChange(tool.id, 'path', path)}
            label="Executable path"
          />
        </div>
      ))}
    </div>
  );
}
