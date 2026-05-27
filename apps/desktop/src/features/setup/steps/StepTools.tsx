import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';
import { Box } from '@/ui/Box';
import { useDirectoryPicker } from '@/shared/native/picker';
import { Switch } from '@base-ui-components/react/switch';
import { clsx } from 'clsx';

export interface ToolConfig {
  enabled: boolean;
  path: string | null;
}

export interface ToolsState {
  pixinsight: ToolConfig;
  siril: ToolConfig;
}

export const DEFAULT_TOOLS_STATE: ToolsState = {
  pixinsight: { enabled: false, path: null },
  siril: { enabled: false, path: null },
};

export interface StepToolsProps {
  tools: ToolsState;
  onToolsChange: (tools: ToolsState) => void;
}

interface ToolDef {
  key: keyof ToolsState;
  name: string;
  description: string;
}

const TOOL_DEFS: ToolDef[] = [
  {
    key: 'pixinsight',
    name: 'PixInsight',
    description: 'Advanced image processing and analysis platform',
  },
  {
    key: 'siril',
    name: 'Siril',
    description: 'Free astronomical image processing tool',
  },
];

/**
 * Step 2 -- Processing Tools.
 * Toggle-based tool configuration with optional executable path picker.
 * Backend commands are stubs for now -- this is a UI-only step.
 */
export function StepTools({ tools, onToolsChange }: StepToolsProps) {
  const handleToggle = (key: keyof ToolsState, checked: boolean) => {
    onToolsChange({
      ...tools,
      [key]: { ...tools[key], enabled: checked, path: checked ? tools[key].path : null },
    });
  };

  const handlePathChange = (key: keyof ToolsState, path: string | null) => {
    onToolsChange({
      ...tools,
      [key]: { ...tools[key], path },
    });
  };

  return (
    <div className="alm-step-tools">
      <p className="alm-step-tools__intro">
        Configure your processing tools so the app can prepare project inputs and
        suggest workflow profiles. Auto-detection will be available in a future update.
      </p>

      <div className="alm-step-tools__list">
        {TOOL_DEFS.map((def) => {
          const config = tools[def.key];
          return (
            <Box key={def.key}>
              <div className="alm-step-tools__row">
                <div className="alm-step-tools__row-info">
                  <div className="alm-step-tools__row-header">
                    <span className="alm-step-tools__row-name">{def.name}</span>
                    <Pill variant="neutral">Not detected</Pill>
                  </div>
                  <span className="alm-step-tools__row-desc">{def.description}</span>
                </div>
                <Switch.Root
                  className={clsx('alm-switch', config.enabled && 'alm-switch--checked')}
                  checked={config.enabled}
                  onCheckedChange={(checked) => handleToggle(def.key, checked)}
                  aria-label={`Enable ${def.name}`}
                >
                  <Switch.Thumb className="alm-switch__thumb" />
                </Switch.Root>
              </div>

              {config.enabled && (
                <div className="alm-step-tools__path-row">
                  <ToolPathPicker
                    toolName={def.name}
                    path={config.path}
                    onPathChange={(path) => handlePathChange(def.key, path)}
                  />
                </div>
              )}
            </Box>
          );
        })}
      </div>

      <p className="alm-step-tools__note">
        You can skip this step. Tool configuration can be changed later in
        Settings.
      </p>
    </div>
  );
}

function ToolPathPicker({
  toolName,
  path,
  onPathChange,
}: {
  toolName: string;
  path: string | null;
  onPathChange: (path: string | null) => void;
}) {
  const { pick, loading } = useDirectoryPicker();

  const handleChoose = async () => {
    const result = await pick();
    if (result.path) {
      onPathChange(result.path);
    }
  };

  return (
    <div className="alm-step-tools__path-picker">
      <span className="alm-step-tools__path-label">Executable:</span>
      {path ? (
        <>
          <span className="alm-step-tools__path-value">{path}</span>
          <Pill variant="ok">OK</Pill>
        </>
      ) : (
        <span className="alm-step-tools__path-value alm-step-tools__path-value--empty">
          No path set
        </span>
      )}
      <Btn size="sm" onClick={handleChoose} disabled={loading}>
        {loading ? 'Choosing...' : `Choose ${toolName} executable...`}
      </Btn>
    </div>
  );
}
