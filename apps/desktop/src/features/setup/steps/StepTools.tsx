import { useEffect } from 'react';
import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';
import { Toggle } from '@/ui/Toggle';
import { useDirectoryPicker } from '@/shared/native/picker';

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
    <div
      className="alm-step-tools"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-3)' }}
    >
      <p
        className="alm-step-tools__intro"
        style={{
          margin: 0,
          fontSize: 'var(--alm-text-sm)',
          lineHeight: 'var(--alm-leading-normal)',
          color: 'var(--alm-text-secondary)',
        }}
      >
        Configure your processing tools so the app can prepare project inputs and suggest
        workflow profiles. Installed tools are detected automatically; you can override or
        set a path manually.
      </p>

      <div
        className="alm-step-tools__list"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}
      >
        {TOOL_DEFS.map((def) => {
          const config = tools[def.key];
          return (
            <ToolCard
              key={def.key}
              def={def}
              config={config}
              onToggle={(checked) => handleToggle(def.key, checked)}
              onPathChange={(path) => handlePathChange(def.key, path)}
            />
          );
        })}
      </div>

      <p
        className="alm-step-tools__note"
        style={{
          margin: 0,
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-faint)',
        }}
      >
        You can skip this step. Tool configuration can be changed later in Settings.
      </p>
    </div>
  );
}

/** A single tool card: name + detected status + description + enable toggle + path picker. */
function ToolCard({
  def,
  config,
  onToggle,
  onPathChange,
}: {
  def: ToolDef;
  config: ToolConfig;
  onToggle: (checked: boolean) => void;
  onPathChange: (path: string | null) => void;
}) {
  const detected = Boolean(config.path);

  return (
    <div
      className="alm-step-tools__card"
      data-testid={`tool-card-${def.key}`}
      style={{
        border: '1px solid var(--alm-border)',
        borderRadius: 'var(--alm-radius-sm)',
        background: 'var(--alm-bg)',
        overflow: 'hidden',
      }}
    >
      {/* Header row: name + detected pill + description + enable toggle */}
      <div
        className="alm-step-tools__header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--alm-sp-3)',
          padding: 'var(--alm-sp-2) var(--alm-sp-3)',
          minHeight: 'var(--alm-row-height)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-0)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}>
            <span
              style={{
                fontSize: 'var(--alm-text-sm)',
                fontWeight: 'var(--alm-weight-semibold)',
                color: 'var(--alm-text)',
              }}
            >
              {def.name}
            </span>
            {detected ? (
              <Pill variant="ok">Detected</Pill>
            ) : (
              <Pill variant="neutral">Not detected</Pill>
            )}
          </div>
          <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            {def.description}
          </span>
        </div>
        <Toggle
          checked={config.enabled}
          onChange={onToggle}
          aria-label={`Enable ${def.name}`}
        />
      </div>

      {/* Executable path picker, only when enabled */}
      {config.enabled && (
        <div
          className="alm-step-tools__path-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--alm-sp-2)',
            padding: 'var(--alm-sp-2) var(--alm-sp-3)',
            borderTop: '1px solid var(--alm-border-subtle)',
            background: 'var(--alm-surface-raised)',
          }}
        >
          <ToolPathPicker
            toolName={def.name}
            path={config.path}
            onPathChange={onPathChange}
          />
        </div>
      )}
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
    <>
      <span
        style={{
          fontSize: 'var(--alm-text-2xs)',
          fontWeight: 'var(--alm-weight-semibold)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--alm-text-muted)',
        }}
      >
        Executable
      </span>
      <span
        className="alm-mono"
        title={path ?? undefined}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 'var(--alm-text-sm)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: path ? 'var(--alm-text-secondary)' : 'var(--alm-text-faint)',
        }}
      >
        {path ?? 'No path set'}
      </span>
      {path && <Pill variant="ok">OK</Pill>}
      <Btn size="sm" onClick={handleChoose} disabled={loading}>
        {loading ? 'Choosing…' : `Choose ${toolName}…`}
      </Btn>
    </>
  );
}
