/**
 * Spec 026 — Generated project source view helpers.
 *
 * Provides typed wrappers over `preparedview.list`, `preparedview.remove`,
 * and `preparedview.regenerate` Tauri commands.
 *
 * All write operations return a `planId` that must be routed through the
 * standard `plans.approve` → `plan.apply` pipeline (spec 017/025).
 * Destructive destination is always `archive` (R-026-Dest-Archive).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** View lifecycle state (spec 026 data-model). */
export type ViewState =
  | 'current'
  | 'stale'
  | 'missing'
  | 'removed'
  | 'failed'
  | 'kind_diverged';

/** View strategy (v1: symlink | junction | copy; hardlink reserved). */
export type ViewKind = 'symlink' | 'junction' | 'copy' | 'hardlink';

/** Per-item detail within a prepared source view (FR-033 / T078). */
export interface PreparedViewItemDetail {
  id: string;
  inventoryItemId: string;
  viewRelativePath: string;
  materialization: string;
  lastObservedState: string;
}

/** Summary of a prepared source view as returned by `preparedview.list`. */
export interface PreparedViewSummary {
  id: string;
  projectId: string;
  /** View strategy. */
  kind: ViewKind;
  /** View lifecycle state. */
  state: ViewState;
  createdAt: string;
  removedAt?: string;
  itemCount: number;
  /** Per-item inventory references (FR-033 / T078). */
  items: PreparedViewItemDetail[];
}

/** Response from `preparedview.list`. */
export interface PreparedViewListResponse {
  views: PreparedViewSummary[];
}

/** Response from `preparedview.remove`. */
export interface PreparedViewRemoveResponse {
  /** Id of the ViewRemovalPlan. Route through spec 017/025 pipeline. */
  planId: string;
}

/** Response from `preparedview.regenerate`. */
export interface PreparedViewRegenerateResponse {
  /** Id of the ViewRegenerationPlan. Route through spec 017/025 pipeline. */
  planId: string;
  /** Count of items whose inventory reference could not be resolved. */
  unresolvedItemCount: number;
}

// ── Command wrappers ──────────────────────────────────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';
  if (useMocks) {
    const { mockInvoke } = await import('@/api/mocks');
    return mockInvoke<T>(cmd, args);
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/**
 * `preparedview.list` — list all prepared source views for a project.
 */
export async function listPreparedViews(
  projectId: string,
): Promise<PreparedViewListResponse> {
  return invoke<PreparedViewListResponse>('preparedview.list', { projectId });
}

/**
 * `preparedview.remove` — create a ViewRemovalPlan for a source view.
 *
 * Returns a `planId` to route through the plan review pipeline.
 * Destructive destination is always `archive`.
 */
export async function removePreparedView(
  viewId: string,
): Promise<PreparedViewRemoveResponse> {
  return invoke<PreparedViewRemoveResponse>('preparedview.remove', { viewId });
}

/**
 * `preparedview.regenerate` — create a ViewRegenerationPlan for a removed or
 * stale source view.
 *
 * Returns a `planId` and the count of unresolvable inventory references.
 */
export async function regeneratePreparedView(
  viewId: string,
): Promise<PreparedViewRegenerateResponse> {
  return invoke<PreparedViewRegenerateResponse>('preparedview.regenerate', { viewId });
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Human-readable label for a view state. */
export function viewStateLabel(state: ViewState): string {
  switch (state) {
    case 'current':
      return 'Current';
    case 'stale':
      return 'Stale';
    case 'missing':
      return 'Missing';
    case 'removed':
      return 'Removed';
    case 'failed':
      return 'Failed';
    case 'kind_diverged':
      return 'Kind mismatch — resolve before operating';
    default:
      return state;
  }
}

/** Badge variant for a view state (matches the project `PillVariant`). */
export function viewStateVariant(
  state: ViewState,
): 'ok' | 'warn' | 'danger' | 'neutral' | 'ghost' {
  switch (state) {
    case 'current':
      return 'ok';
    case 'stale':
    case 'missing':
      return 'warn';
    case 'removed':
      return 'neutral';
    case 'failed':
    case 'kind_diverged':
      return 'danger';
    default:
      return 'ghost';
  }
}

/** True when the remove action is available for this view state. */
export function canRemoveView(state: ViewState): boolean {
  return state === 'current' || state === 'stale';
}

/** True when the regenerate action is available for this view state. */
export function canRegenerateView(state: ViewState): boolean {
  return state === 'removed' || state === 'stale';
}
