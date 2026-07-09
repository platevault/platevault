/**
 * Spec 026 — Generated project source view helpers.
 * Spec 049 — source view generation (first-materialization) helper.
 *
 * Provides typed wrappers over `preparedview.list`, `preparedview.remove`,
 * `preparedview.regenerate`, and `sourceview.generate` Tauri commands.
 *
 * All write operations return a `planId` that must be routed through the
 * standard `plans.approve` → `plan.apply` pipeline (spec 017/025).
 * Destructive destination is always `archive` (R-026-Dest-Archive).
 */

import { m } from '@/lib/i18n';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';

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

// ── Spec 049: source view generation ───────────────────────────────────────────

/** Warning codes for `sourceview.generate` (spec 049). */
export type GenerationWarningCode =
  | 'no_calibration_applied'
  | 'unresolved_source'
  | 'capability_drift'
  | 'long_path';

/** A non-blocking review warning surfaced with a generation plan. */
export interface GenerationWarning {
  code: GenerationWarningCode;
  message: string;
  items?: string[];
}

/** Request for `sourceview.generate`. */
export interface SourceViewGenerateRequest {
  projectId: string;
  /** Workflow/processing profile id (spec 011). Omit for the project default. */
  profileId?: string;
  /** Optional per-generation destination override (FR-021b). */
  destinationOverride?: string;
  /** Explicit opt-in to copy when no link kind is achievable (FR-003). */
  copyOptIn?: boolean;
  /** When true, any unresolved source fails the whole plan (FR-019). */
  strict?: boolean;
}

/** Response from `sourceview.generate`. */
export interface SourceViewGenerateResponse {
  /** Id of the generation plan. Route through spec 017/025 pipeline. */
  planId: string;
  warnings?: GenerationWarning[];
  /** True when at least one item materialized via copy fallback (FR-003/FR-004b). */
  usedCopyFallback?: boolean;
}

// ── Command wrappers ──────────────────────────────────────────────────────────
// Migrated off the hand-rolled local `invoke` onto the generated bindings +
// unwrap (spec 037 SC-001). Runtime shapes match the local DTOs above, so the
// unwrapped generated Result is cast to the module's public interface.

/**
 * `preparedview.list` — list all prepared source views for a project.
 */
export async function listPreparedViews(
  projectId: string,
): Promise<PreparedViewListResponse> {
  return unwrap(await commands.preparedviewList(projectId)) as PreparedViewListResponse;
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
  return unwrap(await commands.preparedviewRemove(viewId)) as PreparedViewRemoveResponse;
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
  return unwrap(await commands.preparedviewRegenerate(viewId)) as PreparedViewRegenerateResponse;
}

/**
 * `sourceview.generate` (spec 049) — create a `prepared_view_generation` plan
 * first-materializing a project's selected lights + matched calibration.
 *
 * Returns a `planId` to route through the plan review pipeline. Never copies
 * by default — copy requires `copyOptIn: true`.
 */
export async function generateSourceView(
  req: SourceViewGenerateRequest,
): Promise<SourceViewGenerateResponse> {
  return unwrap(await commands.sourceviewGenerate(req)) as SourceViewGenerateResponse;
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Human-readable label for a view state. */
export function viewStateLabel(state: ViewState): string {
  switch (state) {
    case 'current':
      return m.projects_view_state_current();
    case 'stale':
      return m.projects_view_state_stale();
    case 'missing':
      return m.projects_view_state_missing();
    case 'removed':
      return m.projects_view_state_removed();
    case 'failed':
      return m.projects_view_state_failed();
    case 'kind_diverged':
      return m.projects_view_state_kind_diverged();
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
