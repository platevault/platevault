/**
 * Tool launch store and helpers — spec 011 T010/T011/T012/T017.
 *
 * Provides:
 * - `useToolProfiles()` — reactive query over `tools.list`.
 * - `useToolLaunch(projectId, toolId)` — mutation hook wrapping `tools.launch`.
 * - `toolIdFromProjectTool()` — derives the stable `tool_id` from the project's
 *   `tool` string (data-model.md §WorkflowBinding resolution rule).
 * - `toolLaunchDisabledReason()` — derives tooltip copy keyed off configured/available.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  toolProfileList,
  toolLaunch,
  type ToolProfileSummary,
  type ToolLaunchRequest,
  type ToolLaunchResponse,
} from '@/api/commands';
import { addToast } from '@/shared/toast';
import { m } from '@/lib/i18n';

// ── tool_id derivation ────────────────────────────────────────────────────────

/**
 * Derive the stable `tool_id` from the project's `tool` string.
 *
 * Rule from data-model.md §WorkflowBinding: lowercase source name, replace spaces
 * with `_`. `"PixInsight"` → `"pixinsight"`, `"Siril"` → `"siril"`.
 */
export function toolIdFromProjectTool(projectTool: string): string {
  return projectTool.toLowerCase().replace(/\s+/g, '_');
}

// ── disabled-state copy ───────────────────────────────────────────────────────

export type LaunchDisabledReason = 'not_configured' | 'not_available' | null;

/**
 * Return the tooltip copy for the "Open in {tool}" CTA (T017).
 *
 * Returns `null` when the tool is launchable (button enabled).
 */
export function toolLaunchDisabledReason(
  profile: ToolProfileSummary | undefined,
): LaunchDisabledReason {
  if (!profile) return 'not_configured';
  if (!profile.enabled) return 'not_configured';
  if (!profile.configured) return 'not_configured';
  if (!profile.available) return 'not_available';
  return null;
}

export function toolLaunchDisabledTooltip(reason: LaunchDisabledReason): string {
  switch (reason) {
    case 'not_configured':
      return 'Tool path not configured';
    case 'not_available':
      return 'Tool executable missing';
    default:
      return '';
  }
}

// ── useToolProfiles ───────────────────────────────────────────────────────────

/** Reactive query hook for the tool profile list. */
export function useToolProfiles() {
  const [profiles, setProfiles] = useState<ToolProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    toolProfileList()
      .then((resp) => setProfiles(resp.tools))
      .catch(() => {
        /* silently degrade — CTA will disable */
      })
      .finally(() => setLoading(false));
  }, []);

  return { profiles, loading };
}

// ── useToolLaunch ─────────────────────────────────────────────────────────────

export interface LaunchState {
  working: boolean;
  priorInstanceAlive: boolean;
}

export interface UseToolLaunchResult {
  state: LaunchState;
  launch: (force?: boolean) => Promise<void>;
  dismissPriorWarning: () => void;
}

/**
 * Mutation hook for launching a tool for a project (T010/T011/T012).
 *
 * On success: shows "Launched {tool}" toast.
 * On error: shows failure toast with "Configure path" affordance on not_configured errors.
 * On prior_instance_alive: sets `priorInstanceAlive=true` (caller renders the modal).
 */
export function useToolLaunch(
  projectId: string,
  toolId: string,
  toolName: string,
): UseToolLaunchResult {
  const [state, setState] = useState<LaunchState>({
    working: false,
    priorInstanceAlive: false,
  });

  const launch = useCallback(
    async (force = false) => {
      setState((s) => ({ ...s, working: true }));
      try {
        const req: ToolLaunchRequest = { projectId, toolId, force };
        const resp: ToolLaunchResponse = await toolLaunch(req);

        if (resp.status === 'prior_instance_alive') {
          setState((s) => ({ ...s, priorInstanceAlive: true }));
          return;
        }

        if (resp.status === 'success') {
          addToast({ message: m.projects_tool_launched({ tool: toolName }), variant: 'success' });
          setState((s) => ({ ...s, priorInstanceAlive: false }));
          return;
        }

        // status === 'error'
        const code = resp.error?.code ?? 'launch.failed';
        const isNotConfigured =
          code === 'tool.not_configured' || code === 'tool.executable.not_found';
        addToast({
          message: resp.error?.message ?? m.projects_tool_launch_failed({ tool: toolName, error: '' }),
          variant: 'error',
          action: isNotConfigured
            ? {
                label: 'Configure path',
                onClick: () => {
                  // Navigate to settings/tools pane — best-effort via location
                  window.location.hash = '#/settings?pane=tools';
                },
              }
            : undefined,
        });
      } catch (e: unknown) {
        addToast({
          message: m.projects_tool_launch_failed({ tool: toolName, error: String(e) }),
          variant: 'error',
        });
      } finally {
        setState((s) => ({ ...s, working: false }));
      }
    },
    [projectId, toolId, toolName],
  );

  const dismissPriorWarning = useCallback(() => {
    setState((s) => ({ ...s, priorInstanceAlive: false }));
  }, []);

  return { state, launch, dismissPriorWarning };
}
