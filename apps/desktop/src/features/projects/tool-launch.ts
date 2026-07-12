/**
 * Tool launch store and helpers — spec 011 T010/T011/T012/T017/T021.
 *
 * Provides:
 * - `useToolProfiles()` — reactive query over `tools.list`.
 * - `useToolLaunch(projectId, toolId)` — mutation hook wrapping `tools.launch`.
 * - `toolIdFromProjectTool()` — derives the stable `tool_id` from the project's
 *   `tool` string (data-model.md §WorkflowBinding resolution rule).
 * - `toolLaunchDisabledReason()` — derives tooltip copy keyed off configured/available.
 * - `hasSeenCwdAnchoredHint()` / `markCwdAnchoredHintSeen()` — localStorage-backed
 *   one-time-per-tool "cwd anchored" hint state (T021, US3 acceptance scenario 3).
 */
import { useState, useCallback, useEffect } from 'react';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type {
  ToolProfileSummary,
  ToolProfileListResponse,
  ToolLaunchRequest,
  ToolLaunchResponse,
} from '@/bindings/index';
import { addToast } from '@/shared/toast';
import { m } from '@/lib/i18n';

// Local IPC helpers — migrated off the hand-written @/api/commands wrappers
// (spec 037) onto the generated bindings.

async function toolProfileList(): Promise<ToolProfileListResponse> {
  return unwrap(await commands.toolsList());
}

async function toolLaunch(
  request: ToolLaunchRequest,
): Promise<ToolLaunchResponse> {
  return unwrap(await commands.toolsLaunch(request));
}

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

export function toolLaunchDisabledTooltip(
  reason: LaunchDisabledReason,
): string {
  switch (reason) {
    case 'not_configured':
      return m.projects_toollaunch_not_configured();
    case 'not_available':
      return m.projects_toollaunch_not_available();
    default:
      return '';
  }
}

// ── one-time "cwd anchored" hint (T021) ────────────────────────────────────────

/**
 * localStorage key prefix for the per-tool "cwd anchored" hint seen-state
 * (US3 acceptance scenario 3): tools whose profile declares
 * `supports_open_folder = false` don't get a folder argument, only a `cwd`.
 * The first time such a tool is launched, a one-time note explains this so
 * the user isn't left wondering why no folder chooser opened.
 */
const CWD_ANCHORED_HINT_STORAGE_PREFIX = 'alm.toolhint.cwdAnchored.';

function cwdAnchoredHintStorageKey(toolId: string): string {
  return `${CWD_ANCHORED_HINT_STORAGE_PREFIX}${toolId}`;
}

/** True when the one-time cwd-anchored hint has already been shown for `toolId`. */
export function hasSeenCwdAnchoredHint(toolId: string): boolean {
  try {
    return (
      window.localStorage.getItem(cwdAnchoredHintStorageKey(toolId)) === '1'
    );
  } catch {
    // localStorage unavailable — fail safe by treating the hint as already seen
    // so we never throw or spam the user in an environment without storage.
    return true;
  }
}

/** Mark the one-time cwd-anchored hint as shown for `toolId`. */
export function markCwdAnchoredHintSeen(toolId: string): void {
  try {
    window.localStorage.setItem(cwdAnchoredHintStorageKey(toolId), '1');
  } catch {
    // localStorage unavailable — the hint may reappear on the next launch;
    // non-critical, so we swallow the error.
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
 * Mutation hook for launching a tool for a project (T010/T011/T012/T021).
 *
 * On success: shows "Launched {tool}" toast. When `supportsOpenFolder` is
 * `false` and this is the first successful launch of `toolId` in this
 * browser profile, also shows a one-time "cwd anchored" hint toast (T021,
 * US3 acceptance scenario 3) explaining that the tool doesn't accept a
 * folder argument — only the working directory is set.
 * On error: shows failure toast with "Configure path" affordance on not_configured errors.
 * On prior_instance_alive: sets `priorInstanceAlive=true` (caller renders the modal).
 */
export function useToolLaunch(
  projectId: string,
  toolId: string,
  toolName: string,
  supportsOpenFolder?: boolean,
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
          addToast({
            message: m.projects_tool_launched({ tool: toolName }),
            variant: 'success',
          });
          if (
            supportsOpenFolder === false &&
            toolId &&
            !hasSeenCwdAnchoredHint(toolId)
          ) {
            markCwdAnchoredHintSeen(toolId);
            addToast({
              message: m.projects_tool_cwd_anchored_hint({ tool: toolName }),
              variant: 'info',
              duration: 0,
            });
          }
          setState((s) => ({ ...s, priorInstanceAlive: false }));
          return;
        }

        // status === 'error'
        const code = resp.error?.code ?? 'launch.failed';
        const isNotConfigured =
          code === 'tool.not_configured' ||
          code === 'tool.executable.not_found';
        addToast({
          message:
            resp.error?.message ??
            m.projects_tool_launch_failed({ tool: toolName, error: '' }),
          variant: 'error',
          action: isNotConfigured
            ? {
                label: m.projects_tool_configure_path(),
                onClick: () => {
                  // Navigate to settings/tools pane — best-effort via location
                  window.location.hash = '#/settings?pane=tools';
                },
              }
            : undefined,
        });
      } catch (e: unknown) {
        addToast({
          message: m.projects_tool_launch_failed({
            tool: toolName,
            error: String(e),
          }),
          variant: 'error',
        });
      } finally {
        setState((s) => ({ ...s, working: false }));
      }
    },
    [projectId, toolId, toolName, supportsOpenFolder],
  );

  const dismissPriorWarning = useCallback(() => {
    setState((s) => ({ ...s, priorInstanceAlive: false }));
  }, []);

  return { state, launch, dismissPriorWarning };
}
