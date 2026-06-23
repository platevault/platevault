import { useEffect, useState } from 'react';
import { Btn } from '@/ui/Btn';
import { Pill } from '@/ui/Pill';
import { Toggle } from '@/ui/Toggle';
import { m } from '@/lib/i18n';
import { useFilePicker } from '@/shared/native/picker';

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
  /** Render-time thunks so the strings re-read the active locale (spec 046 #8). */
  name: () => string;
  description: () => string;
}

const TOOL_DEFS: ToolDef[] = [
  {
    key: 'pixinsight',
    name: () => m.setup_tools_pixinsight_name(),
    description: () => m.setup_tools_pixinsight_desc(),
  },
  {
    key: 'siril',
    name: () => m.setup_tools_siril_name(),
    description: () => m.setup_tools_siril_desc(),
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
    // Only flip `enabled`; keep the (detected or manually-set) path so disabling →
    // re-enabling doesn't lose detection and flip the tool back to "Not detected".
    onToolsChange({
      ...tools,
      [key]: { ...tools[key], enabled: checked },
    });
  };

  const handlePathChange = (key: keyof ToolsState, path: string | null) => {
    onToolsChange({
      ...tools,
      [key]: { ...tools[key], path },
    });
  };

  // Re-run auto-detection for a single tool (the "Redetect" button). Returns
  // true if a binary was found (and the path was filled in), false otherwise.
  const handleRedetect = async (key: keyof ToolsState): Promise<boolean> => {
    try {
      const { commands } = await import('@/bindings/index');
      const res = await commands.toolsDiscover({ toolId: key });
      if (res.status !== 'ok') return false;
      const entry = res.data.entries.find((e) => e.toolId === key && e.available);
      if (entry?.path) {
        onToolsChange({ ...tools, [key]: { enabled: true, path: entry.path } });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return (
    <div className="alm-step-tools">
      <p className="alm-step-tools__intro">
        {m.setup_tools_intro()}
      </p>

      <div className="alm-step-tools__list">
        {TOOL_DEFS.map((def) => {
          const config = tools[def.key];
          return (
            <ToolCard
              key={def.key}
              def={def}
              config={config}
              onToggle={(checked) => handleToggle(def.key, checked)}
              onPathChange={(path) => handlePathChange(def.key, path)}
              onRedetect={() => handleRedetect(def.key)}
            />
          );
        })}
      </div>

      <p className="alm-step-tools__note">
        {m.setup_tools_skip_note()}
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
  onRedetect,
}: {
  def: ToolDef;
  config: ToolConfig;
  onToggle: (checked: boolean) => void;
  onPathChange: (path: string | null) => void;
  onRedetect: () => Promise<boolean>;
}) {
  const detected = Boolean(config.path);
  const [redetecting, setRedetecting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const handleRedetect = async () => {
    setRedetecting(true);
    setNotFound(false);
    const found = await onRedetect();
    setRedetecting(false);
    if (!found) setNotFound(true);
  };

  return (
    <div
      className="alm-step-tools__card"
      data-testid={`tool-card-${def.key}`}
    >
      {/* Header row: name + detected pill + description + enable toggle */}
      <div className="alm-step-tools__header">
        <div className="alm-step-tools__tool-info">
          <div className="alm-step-tools__name-row">
            <span className="alm-step-tools__tool-name">
              {def.name()}
            </span>
            {detected ? (
              <Pill variant="ok">{m.setup_tools_detected()}</Pill>
            ) : (
              <Pill variant="neutral">{m.setup_tools_not_detected()}</Pill>
            )}
          </div>
          <span className="alm-step-tools__tool-desc">
            {def.description()}
          </span>
        </div>
        <div className="alm-step-tools__controls">
          <div className="alm-step-tools__actions">
            <Btn
              variant="ghost"
              onClick={handleRedetect}
              disabled={redetecting}
              aria-label={m.setup_tools_redetect_binary_aria({ name: def.name() })}
            >
              {redetecting ? m.common_detecting() : m.setup_tools_redetect()}
            </Btn>
            <Toggle
              checked={config.enabled}
              onChange={onToggle}
              aria-label={m.setup_tools_enable_aria({ name: def.name() })}
            />
          </div>
          {notFound && (
            <span className="alm-step-tools__not-found">
              {m.setup_tools_no_installation()}
            </span>
          )}
        </div>
      </div>

      {/* Executable path picker, only when enabled */}
      {config.enabled && (
        <div className="alm-step-tools__path-row">
          <ToolPathPicker
            toolName={def.name()}
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
  const { pick, loading } = useFilePicker();

  const handleChoose = async () => {
    // The processing tool's executable is a file (e.g. PixInsight.exe /
    // pixinsight / Siril), not a directory — pick the binary, not a folder.
    const result = await pick([
      { name: m.setup_tools_executable_label(), extensions: ['exe', 'app', 'bin'] },
      { name: m.setup_tools_filter_all_files(), extensions: ['*'] },
    ]);
    if (result.path) {
      onPathChange(result.path);
    }
  };

  return (
    <>
      <span className="alm-step-tools__path-label">
        {m.setup_tools_executable_label()}
      </span>
      <span
        className="alm-mono alm-step-tools__path-value"
        title={path ?? undefined}
        // eslint-disable-next-line no-restricted-syntax -- dynamic: conditional token color for path set vs unset
        style={{ color: path ? 'var(--alm-text-secondary)' : 'var(--alm-text-faint)' }}
      >
        {path ?? m.setup_tools_no_path()}
      </span>
      {path && <Pill variant="ok">{m.setup_tools_ok()}</Pill>}
      <Btn
        size="sm"
        onClick={handleChoose}
        disabled={loading}
        aria-label={m.setup_tools_select_binary_aria({ name: toolName })}
      >
        {loading ? m.setup_choosing() : m.setup_tools_select_binary()}
      </Btn>
    </>
  );
}
