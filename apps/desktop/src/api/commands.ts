import type {
  AcquisitionSession,
  Project,
  FilesystemPlan,
  AuditEntry,
  SearchResult,
  ReviewItem,
  AppPreferences,
  OperationHandle,
  OperationEvent,
  SessionDetail,
  ProjectDetail,
  PlanDetail,
  CalendarData,
  LibraryRoot,
  Equipment,
  SettingsData,
  RemapVerification,
  MatchCandidate,
} from '@/bindings/types';
import type {
  InboxClassifyRequest,
  InboxConfirmResponse,
  InboxConfirmDestination,
  InboxItemSummary,
  InboxListItem,
  InboxListResponse,
  InboxReclassifyOverride,
  InboxReclassifyRequest,
  InboxFileMetadata_Serialize as InboxFileMetadata,
  InboxItemMetadataRequest,
  InboxScanFolderRequest,
  InboxScanFolderResponse,
  InboxApplyAllResponse,
  InboxApplySelectedRequest,
  InboxOpenPlan,
  InboxOpenPlansResponse,
  InboxPlanAction,
  InboxPlanApplyResult,
  InboxPlanCancelResponse,
  InboxPlanView,
  PlanApplyResponse,
  InboxStatsResponse,
  InboxStatsPerType,
  InboxStatsTotals,
} from '@/bindings/index';
import type {
  // T117: all _Serialize/_Deserialize → clean-name aliases live in one place
  InboxClassifyResponse,
  InboxConfirmRequest,
  InboxReclassifyResponse,
  CalibrationMaster,
  MasterDetail,
} from '@/bindings/aliases';
export type {
  InboxClassifyRequest,
  InboxClassifyResponse,
  InboxConfirmRequest,
  InboxConfirmResponse,
  InboxConfirmDestination,
  InboxItemSummary,
  InboxListItem,
  InboxListResponse,
  InboxReclassifyOverride,
  InboxReclassifyRequest,
  InboxReclassifyResponse,
  InboxFileMetadata,
  InboxScanFolderRequest,
  InboxScanFolderResponse,
  InboxApplyAllResponse,
  InboxApplySelectedRequest,
  InboxOpenPlan,
  InboxOpenPlansResponse,
  InboxPlanAction,
  InboxPlanApplyResult,
  InboxPlanCancelResponse,
  InboxPlanView,
  PlanApplyResponse,
  InboxStatsResponse,
  InboxStatsPerType,
  InboxStatsTotals,
};

import type {
  ProjectSummaryDto,
  ProjectDetailDto,
  ProjectCreateRequest,
  ProjectCreateResult,
  ProjectUpdateRequest,
  ProjectUpdateResult,
  ProjectSourceAddRequest,
  ProjectSourceAddResult,
  ProjectSourceRemoveRequest,
  ProjectSourceRemoveResult,
  ProjectChannelsReinferRequest,
  ProjectChannelsReinferResult,
  ProjectChannelsDismissDriftRequest,
  ProjectChannelsDismissDriftResult,
} from '@/bindings/index';
import type {
  // spec 036 gen-3 target management
  TargetGetRequest,
  TargetListItem,
  TargetAliasDto,
  AliasKind as TargetAliasKind,
  TargetAliasAddRequest,
  TargetAliasAddResult,
  TargetAliasRemoveRequest,
  TargetAliasRemoveResult,
  TargetDisplayAliasSetRequest,
  TargetDisplayAliasClearRequest,
  // spec 035: SIMBAD target resolution
  ResolverSettings,
  ResolverSettingsResponse,
  ManifestGetRequest,
  ProjectNoteUpdateRequest,
  ProjectNoteUpdateResult,
  ManifestRevealRequest,
  ProjectNoteGetRequest,
  ProjectNoteGetResult,
  // spec 041: per-source organization state (move vs catalogue).
  OrganizationState,
  SetSourceOrganizationStateResponse,
} from '@/bindings/index';
import type {
  // T117: all _Serialize/_Deserialize → clean-name aliases live in one place
  TargetDetailV3,
  TargetOpError,
  TargetSearchRequest,
  TargetSearchResponse,
  TargetSuggestion,
  TargetResolveSimbadRequest,
  TargetResolveSimbadResponse,
  ResolvedTarget,
  ManifestListRequest,
  ManifestListResponse,
  ManifestGetResponse,
  ManifestOpError,
} from '@/bindings/aliases';

// IPC dispatch + the dev-tools recording override live in the shared switcher
// (spec 037, api/ipc.ts) so these wrappers and the generated bindings use one
// dispatcher. Re-exported to keep the `@/api/commands` public surface stable.
import { invoke, unwrap, setInvokeOverride } from './ipc';
export { setInvokeOverride };

import { commands } from '@/bindings';
import { Channel } from '@tauri-apps/api/core';

// ---------- Query Commands ----------

export async function listSessions(args?: {
  filters?: Record<string, unknown>;
  sort?: string;
  group_by?: string;
}): Promise<AcquisitionSession[]> {
  void args; // generated fn takes no args; pass-through not needed
  return unwrap(await commands.sessionsList());
}

export async function getSession(args: { id: string }): Promise<SessionDetail> {
  return unwrap(await commands.sessionsGet(args.id));
}

export async function getSessionsCalendar(args: {
  start_month: string;
  end_month: string;
}): Promise<CalendarData> {
  return unwrap(await commands.sessionsCalendar(args.start_month, args.end_month));
}

export async function listCalibrationMasters(args?: {
  group_by?: string;
  filters?: Record<string, unknown>;
}): Promise<CalibrationMaster[]> {
  void args; // generated fn takes no args
  return unwrap(await commands.calibrationMastersList());
}

export async function getCalibrationMaster(args: { id: string }): Promise<MasterDetail> {
  return unwrap(await commands.calibrationMastersGet(args.id));
}

export async function getCalibrationMatches(args: {
  session_id: string;
}): Promise<MatchCandidate[]> {
  return unwrap(await commands.calibrationMatches(args.session_id));
}

export async function listProjects(args?: {
  filters?: Record<string, unknown>;
}): Promise<Project[]> {
  return unwrap(await commands.projectsList(args?.filters ?? null));
}

export async function getProject(args: { id: string }): Promise<ProjectDetail> {
  return unwrap(await commands.projectsGet(args.id));
}

export async function listPlans(args?: {
  filters?: Record<string, unknown>;
}): Promise<FilesystemPlan[]> {
  // Generated plansList has 4 positional filter args (stateFilter, originFilter,
  // createdAfter, limit); the old wrapper only forwarded a generic `filters` bag.
  // No callers exist in the app; we forward nulls for all filters to keep the
  // signature stable while using the generated binding (T115).
  void args;
  const response = unwrap(await commands.plansList(null, null, null, null));
  return (response).plans;
}

export async function getPlan(args: { id: string }): Promise<PlanDetail> {
  return unwrap(await commands.plansGet(args.id));
}

export async function listAuditEntries(args?: {
  filters?: Record<string, unknown>;
  pagination?: { offset: number; limit: number };
}): Promise<{ entries: AuditEntry[]; total: number }> {
  const result = unwrap(
    await commands.auditList(args?.filters ?? null, args?.pagination ?? null),
  );
  return result;
}

export async function exportAudit(args?: {
  filters?: Record<string, unknown>;
}): Promise<string> {
  return unwrap(await commands.auditExport(args?.filters ?? null));
}

// ── Log stream (spec 019) ────────────────────────────────────────────────────

export interface LogRecentResponse {
  contractVersion: string;
  entries: import('@/data/logStore').LogEntry[];
  truncated?: boolean;
  truncatedCount?: number;
}

export interface LogExportResponse {
  contractVersion: string;
  requestId: string;
  filePath: string;
  count: number;
  bytes?: number;
}

/** `log.recent` — fetch the most-recent log entries (initial hydration window). */
export async function logRecent(args?: {
  cursor?: string;
  levelMin?: string;
  includeDiagnostics?: boolean;
  sourceFilter?: string[];
  windowSize?: number;
}): Promise<LogRecentResponse> {
  // Generated fn takes 5 positional args; cast levelMin and sourceFilter to the
  // generated union/array types — values are identical at runtime.
  return unwrap(
    await commands.logRecent(
      args?.cursor ?? null,
      (args?.levelMin ?? null) as 'debug' | 'info' | 'warn' | 'error' | null,
      args?.includeDiagnostics ?? null,
      (args?.sourceFilter ?? null) as Parameters<typeof commands.logRecent>[3],
      args?.windowSize ?? null,
    ),
  ) as LogRecentResponse;
}

/** `log.export` — export filtered log entries to a JSON file. */
export async function logExport(args: {
  requestId: string;
  filePath: string;
  format?: string;
  levelMin?: string;
  since?: string;
  until?: string;
  includeDiagnostics?: boolean;
}): Promise<LogExportResponse> {
  return unwrap(
    await commands.logExport(
      args.requestId,
      args.filePath,
      args.format ?? null,
      (args.levelMin ?? null) as 'debug' | 'info' | 'warn' | 'error' | null,
      args.since ?? null,
      args.until ?? null,
      args.includeDiagnostics ?? null,
    ),
  ) as LogExportResponse;
}

export async function getSettings(args: { scope: string }): Promise<SettingsData> {
  return unwrap(await commands.settingsGet(args.scope));
}

export async function listRoots(): Promise<LibraryRoot[]> {
  return unwrap(await commands.rootsList());
}

/**
 * `sources.set_organization_state` — change a source's organization state
 * (spec 041 US4). Affects only future confirms. Inbox sources may not be set
 * to `organized` (the backend returns `source.invalid_organization_state`).
 *
 * Field names mirror the generated binding exactly (camelCase `sourceId` /
 * `organizationState`); the binding wraps them into the invoke payload.
 */
export async function setSourceOrganizationState(args: {
  sourceId: string;
  organizationState: OrganizationState;
}): Promise<SetSourceOrganizationStateResponse> {
  return unwrap(
    await commands.sourcesSetOrganizationState(args.sourceId, args.organizationState),
  );
}

export async function listEquipment(): Promise<Equipment[]> {
  return unwrap(await commands.equipmentList());
}

export async function getReviewQueue(args?: {
  filter?: string;
}): Promise<ReviewItem[]> {
  return unwrap(await commands.reviewQueue(args?.filter ?? null));
}

export async function getPreferences(): Promise<AppPreferences> {
  return unwrap(await commands.preferencesGet());
}

export async function searchGlobal(args: { query: string }): Promise<SearchResult[]> {
  return unwrap(await commands.searchGlobal(args.query)) as SearchResult[];
}

// ---------- Mutation Commands ----------

export async function transitionSession(args: {
  id: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<AcquisitionSession> {
  return unwrap(
    await commands.sessionsTransition(args.id, args.action, args.metadata ?? null),
  );
}

export async function splitSession(args: {
  id: string;
  split_at_index: number;
}): Promise<{ original: AcquisitionSession; new: AcquisitionSession }> {
  return unwrap(await commands.sessionsSplit(args.id, args.split_at_index));
}

export async function mergeSessions(args: {
  ids: string[];
}): Promise<AcquisitionSession> {
  return unwrap(await commands.sessionsMerge(args.ids));
}

export async function createProjectPlan(args: {
  wizard_state: Record<string, unknown>;
}): Promise<FilesystemPlan> {
  return unwrap(await commands.projectsCreatePlan(args.wizard_state));
}

export async function approvePlan(args: {
  id: string;
  delete_acknowledged?: boolean;
}): Promise<FilesystemPlan> {
  // Generated plansApprove(id) returns PlanApproveResponse (not FilesystemPlan).
  // delete_acknowledged was silently ignored by the old invoke path; no callers
  // exist. We use the generated binding (T115); the caller type is kept for
  // back-compat. Cast via unknown because the return shape differs (approvePlan
  // callers never existed and the Phase 4 plan workflow will replace this wrapper).
  void args.delete_acknowledged;
  const response = unwrap(await commands.plansApprove(args.id));
  return response as unknown as FilesystemPlan;
}

export async function applyPlan(args: {
  id: string;
  approvalToken?: string;
  /**
   * Optional live long-operation subscriber (spec 042 US16, T240). When
   * supplied, the backend streams `OperationEvent`s over a
   * `tauri::ipc::Channel<OperationEvent>`: a `Started` event carrying the
   * running handle, per-item `progress`/`item_applied`/`item_failed` events,
   * then a terminal `completed`/`failed` event carrying a terminal handle.
   * The durable DB audit trail is unaffected — the channel is the live UI
   * projection only.
   */
  onEvent?: (event: OperationEvent) => void;
}): Promise<OperationHandle> {
  // Bridge the optional callback onto a Tauri channel. When no subscriber is
  // supplied we still pass a (no-op) channel because the generated command
  // signature requires the parameter.
  const channel = new Channel<OperationEvent>();
  if (args.onEvent) {
    const handler = args.onEvent;
    channel.onmessage = (event) => handler(event);
  }
  // Generated plansApplyReal(planId, approvalToken, onEvent) requires a token.
  // We thread the token through the signature (T115); when absent we default to
  // '' which the backend will reject — the real plan-apply flow must supply the
  // token from plansApprove.approvalToken.
  const response = unwrap(
    await commands.plansApplyReal(args.id, args.approvalToken ?? '', channel),
  );
  return response as unknown as OperationHandle;
}

export async function discardPlan(args: { id: string }): Promise<void> {
  unwrap(await commands.plansDiscard(args.id));
}

export async function updateSettings(args: {
  scope: string;
  values: Record<string, unknown>;
}): Promise<void> {
  unwrap(await commands.settingsUpdate(args.scope, args.values));
}

export async function registerRoot(args: {
  path: string;
  category: string;
  scanSettings: Record<string, unknown>;
}): Promise<void> {
  unwrap(
    await commands.rootsRegister(args.path, args.category, args.scanSettings),
  );
}

export async function remapRoot(args: {
  root_id: string;
  new_path: string;
}): Promise<RemapVerification> {
  return unwrap(await commands.rootsRemap(args.root_id, args.new_path));
}

export async function applyRootRemap(args: {
  root_id: string;
  verified: boolean;
}): Promise<void> {
  unwrap(await commands.rootsRemapApply(args.root_id, args.verified));
}

export async function startScan(args?: {
  root_ids?: string[];
}): Promise<OperationHandle> {
  // Backend expects camelCase `rootIds`; sending `root_ids` is silently ignored
  // and scans ALL roots instead of the requested subset.
  return unwrap(await commands.scanStart(args?.root_ids ?? null));
}

export async function setPreference(args: {
  key: string;
  value: unknown;
}): Promise<void> {
  unwrap(await commands.preferencesSet(args.key, args.value));
}

export async function completeTourStep(args: { step: string }): Promise<void> {
  unwrap(await commands.tourCompleteStep(args.step));
}

// ---------- First-Run / Batch Commands ----------

export interface BatchSourceEntry {
  kind: string;
  path: string;
  // Backend RegisterSourceRequest is camelCase — must be `scanDepth`.
  scanDepth: string;
  /** Required by the backend contract (spec 041 R-7). 'organized' | 'unorganized'. */
  organizationState: string;
}

export interface BatchRegisterResult {
  results: Array<{
    kind: string;
    path: string;
    success: boolean;
    /** Assigned registered-source id (UUID) on success — used as the scan rootId
     *  so inbox items JOIN back to `registered_sources`. */
    rootId?: string;
    error?: string;
  }>;
}

export interface FirstRunState {
  completed: boolean;
  completed_at?: string;
}

export interface FirstRunCompleteResult {
  success: boolean;
  missing?: string[];
}

export interface FirstRunRestartResult {
  success: boolean;
  prefilled_sources?: Array<{ kind: string; path: string }>;
}

export async function registerRootBatch(args: {
  sources: BatchSourceEntry[];
}): Promise<BatchRegisterResult> {
  // The generated rootsRegisterBatch(request) wraps in `{ request }` automatically;
  // pass `{ sources: args.sources }` as the RegisterSourceBatchRequest payload.
  const resp = unwrap(
    await commands.rootsRegisterBatch({ sources: args.sources } as Parameters<
      typeof commands.rootsRegisterBatch
    >[0]),
  ) as {
    status: string;
    items: Array<{ index: number; status: string; sourceId?: string | null; error?: string | null }>;
  };

  // The real backend response carries per-item results in `items`, correlated to
  // the request by `index`; the assigned source id is `sourceId`.  Map back to the
  // wizard's row shape (kind/path come from the request by index) so the scan step
  // receives the registered-source UUID — not the folder path — as rootId.  Passing
  // the path made inbox items fail the `registered_sources` JOIN and vanish.
  const results = (resp.items ?? []).map((item) => {
    const src = args.sources[item.index];
    const success = item.status === 'success';
    return {
      kind: src?.kind ?? '',
      path: src?.path ?? '',
      success,
      rootId: success ? (item.sourceId ?? undefined) : undefined,
      error: item.error ?? undefined,
    };
  });
  return { results };
}

export async function completeFirstRun(): Promise<void> {
  unwrap(await commands.firstrunComplete());
}

export async function restartFirstRun(): Promise<void> {
  unwrap(
    await commands.firstrunRestart({ confirm: true }),
  );
}

export async function getFirstRunState(): Promise<void> {
  unwrap(await commands.firstrunState());
}

// ---------- Pattern Commands (spec 015) ----------

/** One element of an ordered token pattern. */
export interface PatternPart {
  id: string;
  /** `"token"` or `"separator"` */
  kind: string;
  /** Token name (e.g. `"target"`) or literal separator character. */
  value: string;
}

/** Metadata bundle for pattern resolution (all fields optional). */
export interface MetadataBundle {
  target?: string;
  filter?: string;
  /** Local date YYYY-MM-DD (Ref: R-Date-1) */
  date?: string;
  /** Per-file frame type: light | dark | flat | bias | dark_flat */
  frame_type?: string;
  camera?: string;
  exposure?: string;
  gain?: string;
  binning?: string;
  set_temp?: string;
}

/** Response from pattern.validate. */
export interface PatternValidateResponse {
  valid: boolean;
  warnings: string[];
  errorCode?: string;
  errorMessage?: string;
  errorToken?: string;
}

/** Response from pattern.resolve and pattern.preview. */
export interface PatternPreviewResponse {
  resolvedPath: string;
  missingTokens: string[];
  warnings: string[];
}

/**
 * Validate a pattern structurally (no metadata required).
 * Never rejects — all error states are in the response body.
 */
export async function patternValidate(pattern: PatternPart[]): Promise<PatternValidateResponse> {
  return unwrap(
    await commands.patternValidate({ pattern }),
  ) as PatternValidateResponse;
}

/**
 * Preview a pattern against sample metadata for the Settings UI live preview.
 * Applies the same validation and sanitization pipeline as pattern.resolve.
 */
export async function patternPreview(
  pattern: PatternPart[],
  sampleMetadata: MetadataBundle,
): Promise<PatternPreviewResponse> {
  return unwrap(
    await commands.patternPreview(
      { pattern, sampleMetadata } as Parameters<typeof commands.patternPreview>[0],
    ),
  );
}

// ── Project commands (spec 008) ───────────────────────────────────────────────

/** List all projects as summary rows (real DB, not fixtures). */
export async function listProjects008(args?: {
  filters?: unknown;
}): Promise<ProjectSummaryDto[]> {
  return unwrap(await commands.projectsList(args?.filters ?? null));
}

/** Get a single project with sources and channels. */
export async function getProject008(args: { id: string }): Promise<ProjectDetailDto> {
  return unwrap(await commands.projectsGet(args.id));
}

/** Create a new project (validates, persists, generates folder plan). */
export async function createProject(args: ProjectCreateRequest): Promise<ProjectCreateResult> {
  return unwrap(
    await commands.projectsCreate(args as Parameters<typeof commands.projectsCreate>[0]),
  );
}

/** Update name, tool, or notes on an existing project. */
export async function updateProject(args: ProjectUpdateRequest): Promise<ProjectUpdateResult> {
  return unwrap(
    await commands.projectsUpdate(args as Parameters<typeof commands.projectsUpdate>[0]),
  );
}

/** Link an Inventory session to a project as a source. */
export async function addProjectSource(
  args: ProjectSourceAddRequest,
): Promise<ProjectSourceAddResult> {
  return unwrap(await commands.projectsSourceAdd(args));
}

/** Unlink a source from a project. */
export async function removeProjectSource(
  args: ProjectSourceRemoveRequest,
): Promise<ProjectSourceRemoveResult> {
  return unwrap(await commands.projectsSourceRemove(args));
}

/** Re-infer channels from all linked sources (discards manual overrides). */
export async function reinferProjectChannels(
  args: ProjectChannelsReinferRequest,
): Promise<ProjectChannelsReinferResult> {
  return unwrap(await commands.projectsChannelsReinfer(args));
}

/** Dismiss the channel-drift banner without re-inferring. */
export async function dismissProjectChannelDrift(
  args: ProjectChannelsDismissDriftRequest,
): Promise<ProjectChannelsDismissDriftResult> {
  return unwrap(await commands.projectsChannelsDismissDrift(args));
}

// ── Lifecycle transition commands (spec 009) ──────────────────────────────────

/**
 * Lifecycle state for a project (mirrors domain_core::lifecycle::project::ProjectState).
 * Must stay in sync with the Rust enum and contracts/project.lifecycle.transition.json.
 */
export type ProjectLifecycleState =
  | 'setup_incomplete'
  | 'ready'
  | 'prepared'
  | 'processing'
  | 'completed'
  | 'archived'
  | 'blocked';

export type TransitionActor = 'user' | 'system';

export interface ProjectLifecycleTransitionRequest {
  contractVersion: string;
  requestId: string;
  entityType: 'project';
  entityId: string;
  currentState: ProjectLifecycleState;
  nextState: ProjectLifecycleState;
  actionLabel?: string;
  actor: TransitionActor;
}

export type TransitionErrorCode =
  | 'transition.refused'
  | 'entity.not_found'
  | 'actor.not_authorised'
  | 'plan.required'
  | 'plan.not_approved'
  | 'provenance.unreviewed';

export interface TransitionError {
  code: TransitionErrorCode;
  message: string;
  details?: unknown;
}

export type TransitionStatus = 'success' | 'noop' | 'error';

export interface LifecycleTransitionResponse {
  status: TransitionStatus;
  contractVersion: string;
  requestId: string;
  appliedAt?: string;
  priorState?: string;
  newState?: string;
  auditId?: string;
  planId?: string;
  error?: TransitionError;
}

/**
 * Apply a project lifecycle transition.
 * Returns the transition response (check response.status for success/error).
 * Plan-required edges return status='error' with error.code='plan.required'.
 */
export async function applyProjectLifecycleTransition(
  req: ProjectLifecycleTransitionRequest,
): Promise<LifecycleTransitionResponse> {
  return unwrap(
    await commands.lifecycleTransitionApply(
      { project: req } as Parameters<typeof commands.lifecycleTransitionApply>[0],
    ),
  ) as LifecycleTransitionResponse;
}

// ── Inbox commands (spec 005) ─────────────────────────────────────────────────

/** Scan a root folder and upsert inbox items for each FITS/video leaf directory. */
export async function inboxScanFolder(
  req: InboxScanFolderRequest,
): Promise<InboxScanFolderResponse> {
  return unwrap(await commands.inboxScanFolder(req));
}

/**
 * Classify an Inbox item using IMAGETYP-only evidence.
 * Idempotent unless `forceRescan` is true.
 */
export async function inboxClassify(req: InboxClassifyRequest): Promise<InboxClassifyResponse> {
  return unwrap(await commands.inboxClassify(req));
}

/**
 * Generate a reviewable plan from a classified Inbox item.
 * `action`: `"split"` for mixed items, `"confirm"` for `single_type`.
 */
export async function inboxConfirm(req: InboxConfirmRequest): Promise<InboxConfirmResponse> {
  return unwrap(
    await commands.inboxConfirm(req),
  );
}

/** Write manual frame-type overrides and re-aggregate the classification. */
export async function inboxReclassify(
  req: InboxReclassifyRequest,
): Promise<InboxReclassifyResponse> {
  return unwrap(
    await commands.inboxReclassify(req as Parameters<typeof commands.inboxReclassify>[0]),
  ) as InboxReclassifyResponse;
}

/**
 * List all unacknowledged inbox items across all registered roots (spec 039).
 * Items in `pending_classification`, `classified`, or `plan_open` state are
 * returned. Resolved items are excluded.
 * Results are capped at 500 (check `capped` flag for truncation).
 */
export async function inboxList(): Promise<InboxListResponse> {
  return unwrap(await commands.inboxList());
}

/**
 * Fetch per-file extracted metadata for one inbox item (spec 041 US2/FR-010).
 * Returns one entry per classified file. The invoke arg mirrors the generated
 * binding exactly (`{ req: { inboxItemId } }`).
 */
export async function inboxItemMetadata(
  inboxItemId: InboxItemMetadataRequest['inboxItemId'],
): Promise<InboxFileMetadata[]> {
  const resp = unwrap(await commands.inboxItemMetadata({ inboxItemId }));
  return resp.files;
}

// ── Inbox plan surface (spec 041) ─────────────────────────────────────────────

/**
 * Fetch the open plan for an inbox item.
 * Throws with code `inbox.item.no_plan` when the item has no linked plan.
 */
export async function inboxPlan(inboxItemId: string): Promise<InboxPlanView> {
  return unwrap(await commands.inboxPlan(inboxItemId));
}

/**
 * Approve + apply the plan for a single inbox item.
 * The plan listener transitions the item to `resolved` on completion.
 * Throws with code `plan.stale` when a source file changed since plan creation.
 */
export async function inboxPlanApply(inboxItemId: string): Promise<PlanApplyResponse> {
  return unwrap(await commands.inboxPlanApply(inboxItemId));
}

/**
 * Apply all plans currently in `plan_open` state across all roots.
 * Per-item errors are captured inside the returned `results` array.
 */
export async function inboxPlanApplyAll(): Promise<InboxApplyAllResponse> {
  return unwrap(await commands.inboxPlanApplyAll());
}

/**
 * List every open plan across all roots in one call (spec 041, US2).
 * Each plan carries its actions; `totalActions` sums them for the surface header.
 */
export async function listOpenInboxPlans(): Promise<InboxOpenPlansResponse> {
  return unwrap(await commands.inboxPlanListOpen());
}

/**
 * Apply a caller-chosen subset of inbox plans (spec 041, US2).
 * Selection is plan-level (per inbox item / ingestion group), not per action.
 * Per-item errors are captured inside the returned `results` array.
 */
export async function applySelectedInboxPlans(
  inboxItemIds: InboxApplySelectedRequest['inboxItemIds'],
): Promise<InboxApplyAllResponse> {
  return unwrap(await commands.inboxPlanApplySelected({ inboxItemIds }));
}

/**
 * Discard the open plan and reset the item to `classified`.
 * The item is immediately available for re-confirmation.
 */
export async function inboxPlanCancel(inboxItemId: string): Promise<InboxPlanCancelResponse> {
  return unwrap(await commands.inboxPlanCancel(inboxItemId));
}

/** inbox.stats — aggregate per-type frame counts across all active inbox items (spec 041, US6). */
export async function inboxStats(): Promise<InboxStatsResponse> {
  return unwrap(await commands.inboxStats());
}

// ── Calibration matching commands (spec 007) ──────────────────────────────────

/** Calibration type for matching (dark_flat excluded per FR-001). */
export type CalibrationMatchType = 'dark' | 'flat' | 'bias';

/** Result status for a single suggest call. */
export type SuggestStatus = 'match' | 'ambiguous' | 'no_match' | 'observer_location_missing';

/** Why a dimension was not satisfied. */
export type MismatchReason = 'out_of_tolerance' | 'metadata_missing' | 'hard_rule_violation';

/** Selection reason (observing-night provenance). */
export type SelectionReason = 'same_session' | 'same_night' | 'compatible_fallback';

/** A matched dimension with optional delta. */
export interface MatchedDim {
  dimension: string;
  observed?: unknown;
  reference?: unknown;
  delta?: number;
}

/** A dimension that failed to match. */
export interface MismatchedDim {
  dimension: string;
  reason: MismatchReason;
  delta?: number;
}

/** A ranked calibration master suggestion. */
export interface CalibrationMatchDto {
  sessionId: string;
  masterId: string;
  calibrationType: CalibrationMatchType;
  confidence: number;
  dimensionsMatched: MatchedDim[];
  dimensionsMismatched: MismatchedDim[];
  selectionReason: SelectionReason;
}

/** Response from calibration.match.suggest. */
export interface CalibrationMatchSuggestResponse {
  status: 'success' | 'error';
  contractVersion: string;
  requestId: string;
  suggestStatus?: SuggestStatus;
  matches?: CalibrationMatchDto[];
  error?: { code: string; message: string };
}

/** Successful assign payload. */
export interface AssignedDto {
  assignmentId: string;
  sessionId: string;
  masterId: string;
  calibrationType: CalibrationMatchType;
  wasOverride: boolean;
  mismatchedDimensions?: string[];
  assignedAt: string;
}

/** Response from calibration.match.assign. */
export interface CalibrationMatchAssignResponse {
  status: 'success' | 'error';
  contractVersion: string;
  requestId: string;
  assigned?: AssignedDto;
  confidence?: number;
  error?: { code: string; message: string; details?: { dimensions: string[] } };
}

/** Per-(session, calibrationType) result in a batch response. */
export interface BatchSessionResultDto {
  sessionId: string;
  calibrationType: CalibrationMatchType;
  status: string;
  candidates?: CalibrationMatchDto[];
}

/** Response from calibration.match.suggest.batch. */
export interface CalibrationMatchBatchResponse {
  status: 'success' | 'partial' | 'error';
  contractVersion: string;
  requestId: string;
  results?: BatchSessionResultDto[];
  errors?: Array<{ code: string; message: string; sessionId?: string }>;
}

/**
 * `calibration.match.suggest` — suggest ranked calibration masters for a session.
 * Read-only; never persists state.
 */
export async function calibrationMatchSuggest(args: {
  requestId: string;
  sessionId: string;
  calibrationTypes?: CalibrationMatchType[];
}): Promise<CalibrationMatchSuggestResponse> {
  return unwrap(
    await commands.calibrationMatchSuggest({
      contractVersion: '2.0.0',
      requestId: args.requestId,
      sessionId: args.sessionId,
      calibrationTypes: (args.calibrationTypes ?? null),
    }),
  ) as CalibrationMatchSuggestResponse;
}

/**
 * `calibration.match.assign` — persist a calibration master assignment.
 * Hard-rule mismatches require `override: true`.
 */
export async function calibrationMatchAssign(args: {
  requestId: string;
  sessionId: string;
  masterId: string;
  override: boolean;
}): Promise<CalibrationMatchAssignResponse> {
  return unwrap(
    await commands.calibrationMatchAssign({
      contractVersion: '2.0.0',
      requestId: args.requestId,
      sessionId: args.sessionId,
      masterId: args.masterId,
      override: args.override,
    }),
  ) as CalibrationMatchAssignResponse;
}

/**
 * `calibration.match.suggest.batch` — suggest for multiple sessions in one call.
 * Supports partial success.
 */
export async function calibrationMatchSuggestBatch(args: {
  requestId: string;
  sessionIds: string[];
  calibrationTypes?: CalibrationMatchType[];
}): Promise<CalibrationMatchBatchResponse> {
  return unwrap(
    await commands.calibrationMatchSuggestBatch({
      contractVersion: '1.0',
      requestId: args.requestId,
      sessionIds: args.sessionIds,
      calibrationTypes: (args.calibrationTypes ?? null),
    }),
  ) as CalibrationMatchBatchResponse;
}

// ── Inventory commands (spec 006) ─────────────────────────────────────────────

import type {
  InventoryListRequest,
  InventoryListResponse,
  InventorySessionReviewRequest,
  InventorySessionReviewResponse,
} from '@/data/fixtures/inventory';

export type {
  InventoryListRequest,
  InventoryListResponse,
  InventorySessionReviewRequest,
  InventorySessionReviewResponse,
  InventorySource,
  InventorySession,
  SessionState as InventorySessionState,
  FrameType as InventoryFrameType,
  SourceState as InventorySourceState,
} from '@/data/fixtures/inventory';

/**
 * `inventory.list` — return the grouped inventory ledger with optional filters.
 * Filters are applied server-side (source, frame type, review state).
 */
export async function inventoryList(req: InventoryListRequest): Promise<InventoryListResponse> {
  return unwrap(
    await commands.inventoryList(req as Parameters<typeof commands.inventoryList>[0]),
  ) as InventoryListResponse;
}

/**
 * `inventory.session.review` — apply a session review-state transition
 * (Confirm / Re-open review / Reject session).
 *
 * Returns `status: "success"` | `"noop"` (same-state re-application) |
 * `"error"` with a typed error envelope.
 */
export async function inventorySessionReview(
  req: InventorySessionReviewRequest,
): Promise<InventorySessionReviewResponse> {
  return unwrap(
    await commands.inventorySessionReview(
      req as Parameters<typeof commands.inventorySessionReview>[0],
    ),
  ) as InventorySessionReviewResponse;
}

// ── Spec 011: Processing Tool Launch ─────────────────────────────────────────

import type {
  ToolProfileListResponse,
  ToolProfileSummary,
  ToolLaunchRequest,
  ToolLaunchResponse,
  ToolDiscoverRequest,
  ToolDiscoverResponse,
  UpdateProcessingTool,
  ToolPathValidation,
} from '@/bindings/index';

export type {
  ToolProfileListResponse,
  ToolProfileSummary,
  ToolLaunchRequest,
  ToolLaunchResponse,
  ToolDiscoverRequest,
  ToolDiscoverResponse,
  UpdateProcessingTool,
  ToolPathValidation,
};

/** List all seeded tool profiles joined with settings state. */
export async function toolProfileList(): Promise<ToolProfileListResponse> {
  return unwrap(await commands.toolsList());
}

/** Launch a processing tool for a project. */
export async function toolLaunch(request: ToolLaunchRequest): Promise<ToolLaunchResponse> {
  return unwrap(await commands.toolsLaunch(request));
}

/** Save `executable_path` / enabled for a tool. */
export async function toolUpdate(request: UpdateProcessingTool): Promise<ToolProfileSummary> {
  return unwrap(await commands.toolsUpdate(request));
}

/** Validate an executable path. */
export async function toolValidatePath(path: string): Promise<ToolPathValidation> {
  return unwrap(await commands.toolsValidatePath(path));
}

/** Auto-detect installed tool paths. */
export async function toolDiscover(request: ToolDiscoverRequest): Promise<ToolDiscoverResponse> {
  return unwrap(await commands.toolsDiscover(request));
}

// ── Spec 012: Processing Artifact Observation ─────────────────────────────────

import type {
  ArtifactListRequest,
  ArtifactListResponse,
  ArtifactClassifyRequest,
  ArtifactClassifyResponse,
  ArtifactMarkResolvedRequest,
  ArtifactSummary,
} from '@/bindings/index';

export type {
  ArtifactListRequest,
  ArtifactListResponse,
  ArtifactClassifyRequest,
  ArtifactClassifyResponse,
  ArtifactMarkResolvedRequest,
  ArtifactSummary,
};

/**
 * `artifact.list` — list processing artifacts for a project.
 *
 * Defaults to `["present","missing"]` states when `includeStates` is empty.
 */
export async function artifactList(request: ArtifactListRequest): Promise<ArtifactListResponse> {
  return unwrap(await commands.artifactList(request));
}

/**
 * `artifact.classify` — apply or clear a manual classification override.
 *
 * Pass `kind: null` to clear the override and re-apply workflow-profile rules.
 */
export async function artifactClassify(
  request: ArtifactClassifyRequest,
): Promise<ArtifactClassifyResponse> {
  return unwrap(await commands.artifactClassify(request));
}

/**
 * `artifact.mark_resolved` — mark a `missing` artifact as user-resolved.
 */
export async function artifactMarkResolved(request: ArtifactMarkResolvedRequest): Promise<void> {
  unwrap(await commands.artifactMarkResolved(request));
}

// ── Spec 016: Source Protection (US2–US4) ─────────────────────────────────────

import type {
  SourceProtectionGetResponse,
  SourceProtectionSetRequest,
  SourceProtectionSetResponse,
  PlanProtectionCheckResponse,
  ProtectedPlanItem,
  NonBlockingSummary,
  ProtectionLevel,
} from '@/bindings/index';

export type {
  SourceProtectionGetResponse,
  SourceProtectionSetRequest,
  SourceProtectionSetResponse,
  PlanProtectionCheckResponse,
  ProtectedPlanItem,
  NonBlockingSummary,
  ProtectionLevel,
};

/**
 * `source.protection.get` — resolve effective protection for a source.
 *
 * Pass `sourceId: null` to retrieve global defaults.
 */
export async function sourceProtectionGet(
  sourceId: string | null,
): Promise<SourceProtectionGetResponse> {
  return unwrap(await commands.sourceProtectionGet(sourceId));
}

/**
 * `source.protection.set` — set or replace the protection override for a source
 * (spec 016 US2, T013).
 *
 * Emits a `protection.source.set` audit event.
 */
export async function sourceProtectionSet(
  request: SourceProtectionSetRequest,
): Promise<SourceProtectionSetResponse> {
  return unwrap(
    await commands.sourceProtectionSet(
      request as Parameters<typeof commands.sourceProtectionSet>[0],
    ),
  );
}

/**
 * `plan.protection.check` — return protection-affected plan items (spec 016 US3,
 * T023).
 *
 * Returns only items requiring explicit acknowledgement; normal and unprotected
 * items appear as counts in `nonBlockingSummary`.
 */
export async function planProtectionCheck(
  planId: string,
): Promise<PlanProtectionCheckResponse> {
  return unwrap(await commands.planProtectionCheckCmd(planId));
}

/**
 * `protection.plan.acknowledged` — record user acknowledgement of a protected
 * plan item (spec 016 US3, T025).
 *
 * Returns the audit event id.
 */
export async function protectionPlanAcknowledged(
  planId: string,
  itemId: string,
  sourceId: string | null,
  resolvedLevel: string,
  reason: string,
): Promise<string> {
  return unwrap(
    await commands.protectionPlanAcknowledged(planId, itemId, sourceId, resolvedLevel, reason),
  );
}


// ── Spec 036: Gen-3 target management ────────────────────────────────────────────

/**
 * `target.get` — load full detail for a canonical target (spec 036 gen-3).
 *
 * Returns primaryDesignation, displayAlias, effectiveLabel, objectType,
 * coordinates, source, simbadOid, and all aliases.
 */
export async function getTargetDetail(req: TargetGetRequest): Promise<TargetDetailV3> {
  return unwrap(await commands.targetGet(req)) as TargetDetailV3;
}

/**
 * `target.list` — list all canonical targets ordered by primaryDesignation (spec 036 gen-3).
 */
export async function listTargets(): Promise<TargetListItem[]> {
  return unwrap(await commands.targetList());
}

/**
 * `target.alias.add` — add a user alias to a target (spec 036 gen-3).
 *
 * Only kind='user' aliases can be added via this command; SIMBAD designations
 * and common names are managed by the resolver.
 */
export async function addTargetAlias(
  req: TargetAliasAddRequest,
): Promise<TargetAliasAddResult> {
  return unwrap(await commands.targetAliasAdd(req));
}

/**
 * `target.alias.remove` — remove a user alias from a target by id (spec 036 gen-3).
 *
 * Only kind='user' aliases are removable; returns `alias.not_removable` for
 * SIMBAD designations/common names.
 */
export async function removeTargetAlias(
  req: TargetAliasRemoveRequest,
): Promise<TargetAliasRemoveResult> {
  return unwrap(await commands.targetAliasRemove(req));
}

/**
 * `target.display_alias.set` — set the user presentation label (spec 036, FR-012).
 *
 * Blank input is treated as a clear. Returns the updated full detail.
 */
export async function setDisplayAlias(
  req: TargetDisplayAliasSetRequest,
): Promise<TargetDetailV3> {
  return unwrap(await commands.targetDisplayAliasSet(req)) as TargetDetailV3;
}

/**
 * `target.display_alias.clear` — clear the user presentation label (spec 036, FR-012).
 *
 * Sets displayAlias to null; effectiveLabel reverts to primaryDesignation.
 * Returns the updated full detail.
 */
export async function clearDisplayAlias(
  req: TargetDisplayAliasClearRequest,
): Promise<TargetDetailV3> {
  return unwrap(await commands.targetDisplayAliasClear(req)) as TargetDetailV3;
}

// Re-export gen-3 target types for callers.
export type {
  TargetGetRequest,
  TargetDetailV3,
  TargetListItem,
  TargetAliasDto,
  TargetAliasKind,
  TargetAliasAddRequest,
  TargetAliasAddResult,
  TargetAliasRemoveRequest,
  TargetAliasRemoveResult,
  TargetDisplayAliasSetRequest,
  TargetDisplayAliasClearRequest,
  TargetOpError,
};
// ── spec 035: SIMBAD target resolution ────────────────────────────────────────

// Re-export search/resolve DTOs so UI components import from one place.
export type {
  TargetSearchRequest,
  TargetSearchResponse,
  TargetSuggestion,
  TargetResolveSimbadRequest,
  TargetResolveSimbadResponse,
  ResolvedTarget,
};

/** Contract version for the spec-035 `target.*` resolution commands. */
export const TARGET_SEARCH_CONTRACT_VERSION = '1.0';

/**
 * `target.search` — as-you-type target suggestions from the local seed + cache
 * (spec 035, FR-003). Served purely from local data (no network); long-tail
 * SIMBAD enrichment is a separate `target.resolve` call.
 */
export async function searchTargets(req: TargetSearchRequest): Promise<TargetSearchResponse> {
  return unwrap(
    await commands.targetSearch(req as Parameters<typeof commands.targetSearch>[0]),
  ) as TargetSearchResponse;
}

/**
 * `target.resolve` — the SIMBAD long-tail resolver (spec 035, FR-004/FR-005).
 *
 * Resolves a complete designation / common name not present in the local
 * seed + cache by consulting SIMBAD, then caches the result. Returns
 * `status = "resolved"` with a `ResolvedTarget`, or `status = "unresolved"`
 * with an `unresolvedReason` (e.g. `"unknown"`, `"offline"`, `"ambiguous"`).
 * When online resolution is disabled (FR-015) the backend returns unresolved
 * rather than an error, so callers should treat unresolved as a normal,
 * non-fatal outcome.
 */
export async function resolveTarget(
  req: TargetResolveSimbadRequest,
): Promise<TargetResolveSimbadResponse> {
  return unwrap(
    await commands.targetResolve(req as Parameters<typeof commands.targetResolve>[0]),
  ) as TargetResolveSimbadResponse;
}

// Re-export resolver-settings DTO so the settings UI imports from one place.
export type { ResolverSettings };

/**
 * `target.resolution.settings` — read the SIMBAD resolver settings
 * (online toggle, endpoint, debounce, request timeout) (spec 035, FR-015).
 */
export async function getResolverSettings(): Promise<ResolverSettingsResponse> {
  return unwrap(
    await commands.targetResolutionSettings({
      contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
      requestId: crypto.randomUUID(),
      op: 'get',
    }),
  );
}

/**
 * `target.resolution.settings.update` — persist new resolver settings
 * (spec 035, FR-015). Returns the saved settings.
 */
export async function updateResolverSettings(
  settings: ResolverSettings,
): Promise<ResolverSettingsResponse> {
  return unwrap(
    await commands.targetResolutionSettingsUpdate({
      contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
      requestId: crypto.randomUUID(),
      op: 'update',
      settings,
    }),
  );
}

// ── spec 024: Project Manifests & Notes ───────────────────────────────────────

/**
 * `project.manifest.list` — list manifest snapshots for a project (spec 024).
 *
 * Returns summaries ordered newest first, paginated (default 50, max 200).
 */
export async function listManifests(
  request: ManifestListRequest,
): Promise<ManifestListResponse> {
  return unwrap(
    await commands.manifestList(request),
  );
}

/**
 * `project.manifest.get` — fetch one manifest with its full structured body (spec 024).
 */
export async function getManifest(request: ManifestGetRequest): Promise<ManifestGetResponse> {
  return unwrap(await commands.manifestGet(request));
}

/**
 * `project.note.update` — replace the project's free-text notes (spec 024).
 *
 * Max 16 384 UTF-8 bytes. Rejects with `"project.read_only"` when lifecycle is
 * `"archived"`.
 */
export async function updateProjectNote(
  req: ProjectNoteUpdateRequest,
): Promise<ProjectNoteUpdateResult> {
  return unwrap(await commands.noteUpdate(req));
}

/**
 * `project.note.get` — fetch current notes body for a project (spec 024).
 *
 * Returns `content: null` when no note has been saved yet.
 */
export async function getProjectNote(req: ProjectNoteGetRequest): Promise<ProjectNoteGetResult> {
  return unwrap(await commands.noteGet(req));
}

/**
 * `project.manifest.reveal_in_os` — open the manifest file in the OS file manager (spec 024).
 */
export async function revealManifestInOs(request: ManifestRevealRequest): Promise<void> {
  unwrap(await commands.manifestRevealInOs(request));
}

// Re-export manifest types for callers.
export type {
  ManifestListRequest,
  ManifestListResponse,
  ManifestGetRequest,
  ManifestGetResponse,
  ProjectNoteGetRequest,
  ProjectNoteGetResult,
  ProjectNoteUpdateRequest,
  ProjectNoteUpdateResult,
  ManifestOpError,
  ManifestRevealRequest,
};

// ── Developer Contract Diagnostics (spec 021) ─────────────────────────────────
// These commands are only available in dev-tools builds. Calling them in
// production builds will return an error from Tauri (command not found).

export interface ContractMeta {
  name: string;
  version: string;
  schemaPath: string;
  direction: 'ui-to-core' | 'core-to-ui';
  replaySafe: boolean;
  sensitiveFields?: string[];
  tsHash?: string;
  rustHash?: string;
  mismatch?: boolean;
}

export interface ContractCallError {
  code: string;
  message: string;
}

export interface ContractCall {
  id: string;
  contract: string;
  contractVersion: string;
  request: unknown;
  response?: unknown;
  error?: ContractCallError;
  startedAt: string;
  durationMs: number;
  payloadTruncated: boolean;
}

export interface DevContractsListResponse {
  contracts: ContractMeta[];
}

export interface DevCallsListResponse {
  calls: ContractCall[];
}

export interface DevExportResponse {
  writtenPath: string;
  callCount: number;
  contractCount: number;
}

/**
 * `dev.contracts.list` — enumerate all registered contracts (spec 021 US1).
 * Only available in dev-tools builds when devMode is on.
 */
export async function devContractsList(args?: {
  requestId?: string;
}): Promise<DevContractsListResponse> {
  return invoke<DevContractsListResponse>('dev_contracts_list', { request: args ?? {} });
}

/**
 * `dev.calls.list` — return most-recent recorded calls (spec 021 US2).
 * Only available in dev-tools builds when devMode is on.
 */
export async function devCallsList(args?: {
  requestId?: string;
  limit?: number;
}): Promise<DevCallsListResponse> {
  return invoke<DevCallsListResponse>('dev_calls_list', { request: args ?? {} });
}

/**
 * `dev.export` — export contract registry + calls to a JSON file (spec 021 US4).
 * Only available in dev-tools builds when devMode is on.
 */
export async function devExport(args: {
  outputPath: string;
  includeVerbatimPaths?: boolean;
  includeContracts?: boolean;
  includeCalls?: boolean;
  requestId?: string;
}): Promise<DevExportResponse> {
  return invoke<DevExportResponse>('dev_export', { request: args });
}

export interface DevSchemaGetResponse {
  found: boolean;
  content?: string;
}

/**
 * `dev.schema.get` — read a JSON Schema file server-side (spec 021 US3).
 * Returns `{ found: true, content }` on success, `{ found: false }` when absent.
 * Only available in dev-tools builds when devMode is on.
 */
export async function devSchemaGet(schemaPath: string): Promise<DevSchemaGetResponse> {
  return invoke<DevSchemaGetResponse>('dev_schema_get', {
    request: { schemaPath },
  });
}
