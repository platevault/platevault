// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
} from './settingsIpc';
import { m } from '@/lib/i18n';
import { SettingsSection, SettingsRow } from './SettingsKit';

export function ProcessingTools() {
  const [tools, setTools] = useState<ToolProfileSummary[]>([]);
  const [pathDraft, setPathDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<Record<string, boolean>>({});
  const [detecting, setDetecting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<Record<string, string>>({});

  // Load profiles on mount.
  useEffect(() => {
    let cancelled = false;
    toolProfileList()
      .then((resp) => {
        if (cancelled) return;
        setTools(resp.tools);
        const drafts: Record<string, string> = {};
        for (const t of resp.tools) {
          drafts[t.id] = t.executablePath ?? '';
        }
        setPathDraft(drafts);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveToolPath = useCallback(
    async (toolId: string, path: string) => {
      setSaving((s) => ({ ...s, [toolId]: true }));
      setSaveError((e) => {
        if (!(toolId in e)) return e;
        const next = { ...e };
        delete next[toolId];
        return next;
      });
      try {
        // #656: preserve the tool's current enabled/disabled state — a path
        // edit must never silently re-enable a disabled tool.
        const current = tools.find((t) => t.id === toolId);
        const updated = await toolUpdate({
          id: toolId,
          path: path || null,
          enabled: current?.enabled ?? true,
        });
        setTools((prev) => prev.map((t) => (t.id === toolId ? updated : t)));
        // Validate existence after save
        if (path) {
          setValidating((v) => ({ ...v, [toolId]: true }));
          try {
            const v = await toolValidatePath(path);
            setTools((prev) =>
              prev.map((t) =>
                t.id === toolId
                  ? { ...t, available: v.valid, configured: !!path }
                  : t,
              ),
            );
          } finally {
            setValidating((v) => ({ ...v, [toolId]: false }));
          }
        }
      } catch (err) {
        // #825: a rejected path save (e.g. non-absolute path) must be surfaced
        // inline, not lost as an unhandled rejection — and the stale
        // Available/Missing pill must not be left implying the save succeeded.
        setSaveError((e) => ({
          ...e,
          [toolId]: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setSaving((s) => ({ ...s, [toolId]: false }));
      }
    },
    [tools],
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
      <SettingsSection title={m.settings_tools_title()}>
        <p className="pv-proc-tools__error">
          {m.settings_tools_load_error({ error: loadError })}
        </p>
      </SettingsSection>
    );
  }

  const reDetectBtn = (
    <button
      type="button"
      className="pv-btn pv-btn--ghost pv-proc-tools__auto-detect-btn"
      onClick={handleAutoDetect}
      disabled={detecting}
      aria-label={m.settings_tools_redetect_aria()}
    >
      {detecting ? m.common_detecting() : m.settings_tools_redetect()}
    </button>
  );

  return (
    <SettingsSection title={m.settings_tools_title()} action={reDetectBtn}>
      {tools.length === 0 && !loadError && (
        <p className="pv-proc-tools__loading">{m.common_loading()}</p>
      )}

      {tools.map((tool) => {
        const label = (
          <span className="pv-proc-tools__tool-header">
            <strong>{tool.name}</strong>
            {tool.autoDetected && (
              <Pill variant="neutral" className="pv-proc-tools__pill">
                {m.settings_tools_auto_detected()}
              </Pill>
            )}
            {tool.available && (
              <Pill variant="ok" className="pv-proc-tools__pill">
                {m.settings_tools_available()}
              </Pill>
            )}
            {tool.configured && !tool.available && (
              <Pill variant="warn" className="pv-proc-tools__pill">
                {m.settings_tools_missing()}
              </Pill>
            )}
          </span>
        );

        return (
          <SettingsRow key={tool.id} label={label}>
            <div className="pv-proc-tools__tool-controls">
              <input
                type="text"
                className="pv-input pv-proc-tools__path-input"
                value={pathDraft[tool.id] ?? ''}
                placeholder={m.settings_tools_path_placeholder()}
                aria-label={m.settings_tools_path_aria({ name: tool.name })}
                onChange={(e) =>
                  setPathDraft((prev) => ({
                    ...prev,
                    [tool.id]: e.target.value,
                  }))
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
                <span className="pv-proc-tools__status">
                  {saving[tool.id]
                    ? m.common_saving()
                    : m.settings_tools_checking()}
                </span>
              )}
              <Toggle
                checked={tool.enabled}
                onChange={(v) => {
                  void handleToggle(tool.id, v);
                }}
                aria-label={m.settings_tools_enable_aria({ name: tool.name })}
              />
            </div>
            {saveError[tool.id] && (
              <div className="pv-settings__error" role="alert">
                {m.settings_tools_save_error({
                  name: tool.name,
                  error: saveError[tool.id],
                })}
              </div>
            )}
          </SettingsRow>
        );
      })}
    </SettingsSection>
  );
}
