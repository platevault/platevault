import { useEffect } from 'react';
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
 * Auto-detects installed tools (`tools.discover`, application-based per OS) on mount,
 * then lets the user toggle/override the executable path.
 */
export function StepTools({ tools, onToolsChange }: StepToolsProps) {
  // Auto-detect installed tools once on mount and fill in any unset paths.
  useEffect(() => {
    if (import.meta.env.VITE_USE_MOCKS === 'true') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { commands } = await import('@/bindings/index');
        const res = await commands.toolsDiscover({ toolId: null });
        if (cancelled || res.status !== 'ok') return;
        const found = new Map(
          res.data.entries.filter((e) => e.available).map((e) => [e.toolId, e.path]),
        );
        let changed = false;
        const next: ToolsState = { ...tools };
        for (const def of TOOL_DEFS) {
          const path = found.get(def.key);
          if (path && !next[def.key].path) {
            next[def.key] = { enabled: true, path };
            changed = true;
          }
        }
        if (changed) onToolsChange(next);
      } catch {
        // detection is best-effort; the user can still set paths manually.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount; merging only fills empty paths so re-runs are safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        suggest workflow profiles. Installed tools are detected automatically; you can
        override or set a path manually.
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
                    {config.path ? (
                      <Pill variant="ok">Detected</Pill>
                    ) : (
                      <Pill variant="neutral">Not detected</Pill>
                    )}
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
