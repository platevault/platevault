import { useState } from 'react';
import { Switch } from '@base-ui-components/react/switch';
import { Btn, DirPicker } from '@/ui';

interface ProcessingToolsProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface ToolConfig {
  id: string;
  label: string;
  enabled: boolean;
  executablePath: string;
  processingDir: string;
  outputDir: string;
  defaultProcessingDir: string;
  defaultOutputDir: string;
}

const INITIAL_TOOLS: ToolConfig[] = [
  {
    id: 'pixinsight',
    label: 'PixInsight',
    enabled: true,
    executablePath: '/Applications/PixInsight/PixInsight.app',
    processingDir: 'processing/',
    outputDir: 'output/',
    defaultProcessingDir: 'processing/',
    defaultOutputDir: 'output/',
  },
  {
    id: 'siril',
    label: 'Siril',
    enabled: false,
    executablePath: '',
    processingDir: 'process/',
    outputDir: 'output/',
    defaultProcessingDir: 'process/',
    defaultOutputDir: 'output/',
  },
];

export function ProcessingTools({ save }: ProcessingToolsProps) {
  const [tools, setTools] = useState<ToolConfig[]>(INITIAL_TOOLS);

  const persistTools = (updated: ToolConfig[]) => {
    setTools(updated);
    save('processing_tools', {
      tools: updated.map(({ id, enabled, executablePath, processingDir, outputDir }) => ({
        id,
        enabled,
        executable_path: executablePath,
        processing_dir: processingDir,
        output_dir: outputDir,
      })),
    });
  };

  const handleToggle = (toolId: string) => {
    const updated = tools.map((t) =>
      t.id === toolId ? { ...t, enabled: !t.enabled } : t,
    );
    persistTools(updated);
  };

  const handlePathChange = (toolId: string, path: string) => {
    const updated = tools.map((t) =>
      t.id === toolId ? { ...t, executablePath: path } : t,
    );
    persistTools(updated);
  };

  const handleDirChange = (toolId: string, field: 'processingDir' | 'outputDir', value: string) => {
    const updated = tools.map((t) =>
      t.id === toolId ? { ...t, [field]: value } : t,
    );
    persistTools(updated);
  };

  const handleResetDirs = (toolId: string) => {
    const updated = tools.map((t) =>
      t.id === toolId
        ? { ...t, processingDir: t.defaultProcessingDir, outputDir: t.defaultOutputDir }
        : t,
    );
    persistTools(updated);
  };

  return (
    <div className="alm-processing-tools">
      {tools.map((tool) => (
        <section key={tool.id} className="alm-processing-tools__item">
          <div className="alm-processing-tools__header">
            <label className="alm-processing-tools__toggle-label">
              <Switch.Root
                className="alm-switch"
                checked={tool.enabled}
                onCheckedChange={() => handleToggle(tool.id)}
                aria-label={`Enable ${tool.label}`}
              >
                <Switch.Thumb className="alm-switch__thumb" />
              </Switch.Root>
              <strong className="alm-processing-tools__name">{tool.label}</strong>
            </label>
          </div>

          <div className="alm-processing-tools__body">
            <div className="alm-processing-tools__field">
              <label
                className="alm-processing-tools__field-label"
                htmlFor={`${tool.id}-exec`}
              >
                Executable
              </label>
              <DirPicker
                value={tool.executablePath}
                onChange={(path) => handlePathChange(tool.id, path)}
                label={`${tool.label} executable path`}
              />
            </div>

            <div className="alm-processing-tools__field">
              <label
                className="alm-processing-tools__field-label"
                htmlFor={`${tool.id}-proc-dir`}
              >
                Processing directory (relative to project root)
              </label>
              <input
                id={`${tool.id}-proc-dir`}
                className="alm-input"
                value={tool.processingDir}
                onChange={(e) => handleDirChange(tool.id, 'processingDir', e.target.value)}
                placeholder={tool.defaultProcessingDir}
              />
            </div>

            <div className="alm-processing-tools__field">
              <label
                className="alm-processing-tools__field-label"
                htmlFor={`${tool.id}-out-dir`}
              >
                Output directory (relative to project root)
              </label>
              <input
                id={`${tool.id}-out-dir`}
                className="alm-input"
                value={tool.outputDir}
                onChange={(e) => handleDirChange(tool.id, 'outputDir', e.target.value)}
                placeholder={tool.defaultOutputDir}
              />
            </div>

            <div className="alm-processing-tools__actions">
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => handleResetDirs(tool.id)}
              >
                Reset to vendor defaults
              </Btn>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
