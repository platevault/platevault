/**
 * ProcessingTools pane — spec 011 T016.
 *
 * Replaces the fixture-driven stub with real `tools.list` / `tools.update` /
 * `tools.validate_path` / `tools.discover` commands.
 *
 * Behaviour:
 * - On mount, loads profiles via `tools.list`.
 * - Path input updates local state; saved via `tools.update` on blur or Enter.
 * - "Auto-detect" button calls `tools.discover` and pre-fills empty path fields
 *   (user must save to activate).
 * - Inline existence validation badge after path is set.
 * - Enabled toggle fires `tools.update` immediately.
 */
import { useState, useEffect, useCallback } from 'react';
import { Toggle, Pill } from '@/ui';
import {
  toolProfileList,
  toolUpdate,
  toolValidatePath,
  toolDiscover,
  type ToolProfileSummary,
} from '@/api/commands';

export function ProcessingTools() {
  const [tools, setTools] = useState<ToolProfileSummary[]>([]);
  const [pathDraft, setPathDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<Record<string, boolean>>({});
  const [detecting, setDetecting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load profiles on mount.
  useEffect(() => {
    toolProfileList()
      .then((resp) => {
        setTools(resp.tools);
        const drafts: Record<string, string> = {};
        for (const t of resp.tools) {
          drafts[t.id] = t.executablePath ?? '';
        }
        setPathDraft(drafts);
      })
      .catch((e: unknown) => {
        setLoadError(String(e));
      });
  }, []);

  const saveToolPath = useCallback(
    async (toolId: string, path: string) => {
      setSaving((s) => ({ ...s, [toolId]: true }));
      try {
        const updated = await toolUpdate({ id: toolId, path: path || null, enabled: true });
        setTools((prev) => prev.map((t) => (t.id === toolId ? updated : t)));
        // Validate existence after save
        if (path) {
          setValidating((v) => ({ ...v, [toolId]: true }));
          try {
            const v = await toolValidatePath(path);
            setTools((prev) =>
              prev.map((t) =>
                t.id === toolId ? { ...t, available: v.valid, configured: !!path } : t,
              ),
            );
          } finally {
            setValidating((v) => ({ ...v, [toolId]: false }));
          }
        }
      } finally {
        setSaving((s) => ({ ...s, [toolId]: false }));
      }
    },
    [],
  );

  const handleToggle = useCallback(
    async (toolId: string, enabled: boolean) => {
      const current = tools.find((t) => t.id === toolId);
      if (!current) return;
      const updated = await toolUpdate({
        id: toolId,
        path: current.executablePath ?? null,
        enabled,
      });
      setTools((prev) => prev.map((t) => (t.id === toolId ? updated : t)));
    },
    [tools],
  );

  const handleAutoDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const resp = await toolDiscover({ toolId: null });
      if (resp.entries.length === 0) return;
      setPathDraft((prev) => {
        const next = { ...prev };
        for (const entry of resp.entries) {
          // Only pre-fill when path is currently empty.
          if (!next[entry.toolId]) {
            next[entry.toolId] = entry.path;
          }
        }
        return next;
      });
      // Mark tools with detected paths as auto_detected in local state.
      setTools((prev) =>
        prev.map((t) => {
          const hit = resp.entries.find((e) => e.toolId === t.id);
          if (hit && !t.configured) {
            return { ...t, autoDetected: true };
          }
          return t;
        }),
      );
    } finally {
      setDetecting(false);
    }
  }, []);

  if (loadError) {
    return (
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Tool Workflows</div>
        <p style={{ color: 'var(--alm-text-danger)' }}>Failed to load tools: {loadError}</p>
      </div>
    );
  }

  return (
    <div className="alm-settings__group">
      <div className="alm-settings__group-title">
        Tool Workflows
        <button
          type="button"
          className="alm-btn alm-btn--ghost"
          style={{ marginLeft: '1rem', fontSize: 'var(--alm-text-xs)' }}
          onClick={handleAutoDetect}
          disabled={detecting}
          aria-label="Re-run auto-detect for all tools"
        >
          {detecting ? 'Detecting…' : 'Auto-detect'}
        </button>
      </div>

      {tools.length === 0 && !loadError && (
        <p style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
          Loading…
        </p>
      )}

      {tools.map((tool) => (
        <div key={tool.id} className="alm-settings__row" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <strong>{tool.name}</strong>
            {tool.autoDetected && (
              <Pill variant="neutral" style={{ fontSize: 'var(--alm-text-2xs)' }}>
                Auto-detected
              </Pill>
            )}
            {tool.available && (
              <Pill variant="ok" style={{ fontSize: 'var(--alm-text-2xs)' }}>
                Available
              </Pill>
            )}
            {tool.configured && !tool.available && (
              <Pill variant="warn" style={{ fontSize: 'var(--alm-text-2xs)' }}>
                Missing
              </Pill>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="text"
              className="alm-input"
              style={{ flex: 1, fontSize: 'var(--alm-text-xs)', fontFamily: 'monospace' }}
              value={pathDraft[tool.id] ?? ''}
              placeholder="Executable path…"
              aria-label={`Executable path for ${tool.name}`}
              onChange={(e) =>
                setPathDraft((prev) => ({ ...prev, [tool.id]: e.target.value }))
              }
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val !== (tool.executablePath ?? '')) {
                  void saveToolPath(tool.id, val);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim();
                  void saveToolPath(tool.id, val);
                }
              }}
            />
            {(saving[tool.id] || validating[tool.id]) && (
              <span style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-xs)' }}>
                {saving[tool.id] ? 'Saving…' : 'Checking…'}
              </span>
            )}
            <Toggle
              checked={tool.enabled}
              onChange={(v) => {
                void handleToggle(tool.id, v);
              }}
              aria-label={`Enable ${tool.name}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
