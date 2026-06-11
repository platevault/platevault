import type {
  AcquisitionSession,
  CalibrationMaster,
  Target,
  Project,
  FilesystemPlan,
  AuditEntry,
  SearchResult,
  ReviewItem,
  AppPreferences,
  OperationHandle,
  SessionDetail,
  MasterDetail,
  TargetDetail,
  ProjectDetail,
  PlanDetail,
  CalendarData,
  LibraryRoot,
  Equipment,
  SettingsData,
  RemapVerification,
  MatchCandidate,
  // Catalog types (spec 014)
  CatalogListResponse,
  CatalogAttributionGetResponse,
  CatalogManifestFetchResponse,
  CatalogDownloadResponse,
  CatalogManifest,
} from '@/bindings/types';
import type {
  InboxClassifyRequest,
  InboxClassifyResponse_Serialize as InboxClassifyResponse,
  InboxConfirmRequest_Deserialize as InboxConfirmRequest,
  InboxConfirmResponse,
  InboxItemSummary,
  InboxReclassifyOverride,
  InboxReclassifyRequest,
  InboxReclassifyResponse_Serialize as InboxReclassifyResponse,
  InboxScanFolderRequest,
  InboxScanFolderResponse,
} from '@/bindings/index';
export type {
  InboxClassifyRequest,
  InboxClassifyResponse,
  InboxConfirmRequest,
  InboxConfirmResponse,
  InboxItemSummary,
  InboxReclassifyOverride,
  InboxReclassifyRequest,
  InboxReclassifyResponse,
  InboxScanFolderRequest,
  InboxScanFolderResponse,
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
  TargetGetResult_Serialize as TargetGetResult,
  TargetNoteUpdateRequest,
  TargetNoteUpdateResult,
  TargetAliasAddRequest,
  TargetAliasAddResult,
  TargetAliasRemoveRequest,
  TargetAliasRemoveResult,
  TargetPrimaryRenameRequest,
  TargetPrimaryRenameResult,
  TargetOpError_Serialize as TargetOpError,
  ManifestListRequest_Deserialize as ManifestListRequest,
  ManifestListResponse_Serialize as ManifestListResponse,
  ManifestGetRequest,
  ManifestGetResponse_Serialize as ManifestGetResponse,
  ProjectNoteUpdateRequest,
  ProjectNoteUpdateResult,
  ManifestOpError_Serialize as ManifestOpError,
  ManifestRevealRequest,
  ProjectNoteGetRequest,
  ProjectNoteGetResult,
} from '@/bindings/index';

// Conditionally import mocks or real Tauri invoke
const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (useMocks) {
    const { mockInvoke } = await import('./mocks');
    return mockInvoke<T>(cmd, args);
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

// ---------- Query Commands ----------

export async function listSessions(args?: {
  filters?: Record<string, unknown>;
  sort?: string;
  group_by?: string;
}): Promise<AcquisitionSession[]> {
  return invoke<AcquisitionSession[]>('sessions.list', args);
}

export async function getSession(args: { id: string }): Promise<SessionDetail> {
  return invoke<SessionDetail>('sessions.get', args);
}

export async function getSessionsCalendar(args: {
  start_month: string;
  end_month: string;
}): Promise<CalendarData> {
  return invoke<CalendarData>('sessions.calendar', args);
}

export async function listCalibrationMasters(args?: {
  group_by?: string;
  filters?: Record<string, unknown>;
}): Promise<CalibrationMaster[]> {
  return invoke<CalibrationMaster[]>('calibration.masters.list', args);
}

export async function getCalibrationMaster(args: { id: string }): Promise<MasterDetail> {
  return invoke<MasterDetail>('calibration.masters.get', args);
}

export async function getCalibrationMatches(args: {
  session_id: string;
}): Promise<MatchCandidate[]> {
  return invoke<MatchCandidate[]>('calibration.matches', args);
}

export async function listTargets(args?: { search?: string }): Promise<Target[]> {
  return invoke<Target[]>('targets.list', args);
}

export async function getTarget(args: { id: string }): Promise<TargetDetail> {
  return invoke<TargetDetail>('targets.get', args);
}

export async function listProjects(args?: {
  filters?: Record<string, unknown>;
}): Promise<Project[]> {
  return invoke<Project[]>('projects.list', args);
}

export async function getProject(args: { id: string }): Promise<ProjectDetail> {
  return invoke<ProjectDetail>('projects.get', args);
}

export async function listPlans(args?: {
  filters?: Record<string, unknown>;
}): Promise<FilesystemPlan[]> {
  return invoke<FilesystemPlan[]>('plans.list', args);
}

export async function getPlan(args: { id: string }): Promise<PlanDetail> {
  return invoke<PlanDetail>('plans.get', args);
}

export async function listAuditEntries(args?: {
  filters?: Record<string, unknown>;
  pagination?: { offset: number; limit: number };
}): Promise<{ entries: AuditEntry[]; total: number }> {
  return invoke<{ entries: AuditEntry[]; total: number }>('audit.list', args);
}

export async function exportAudit(args?: {
  filters?: Record<string, unknown>;
}): Promise<string> {
  return invoke<string>('audit.export', args);
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
  return invoke<LogRecentResponse>('log.recent', args ?? {});
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
  return invoke<LogExportResponse>('log.export', args);
}

export async function getSettings(args: { scope: string }): Promise<SettingsData> {
  return invoke<SettingsData>('settings.get', args);
}

export async function listRoots(): Promise<LibraryRoot[]> {
  return invoke<LibraryRoot[]>('roots.list');
}

export async function listEquipment(): Promise<Equipment[]> {
  return invoke<Equipment[]>('equipment.list');
}

export async function getReviewQueue(args?: {
  filter?: string;
}): Promise<ReviewItem[]> {
  return invoke<ReviewItem[]>('review.queue', args);
}

export async function getPreferences(): Promise<AppPreferences> {
  return invoke<AppPreferences>('preferences.get');
}

export async function searchGlobal(args: { query: string }): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search.global', args);
}

// ---------- Mutation Commands ----------

export async function transitionSession(args: {
  id: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<AcquisitionSession> {
  return invoke<AcquisitionSession>('sessions.transition', args);
}

export async function splitSession(args: {
  id: string;
  split_at_index: number;
}): Promise<{ original: AcquisitionSession; new: AcquisitionSession }> {
  return invoke<{ original: AcquisitionSession; new: AcquisitionSession }>(
    'sessions.split',
    args,
  );
}

export async function mergeSessions(args: {
  ids: string[];
}): Promise<AcquisitionSession> {
  return invoke<AcquisitionSession>('sessions.merge', args);
}

export async function createProjectPlan(args: {
  wizard_state: Record<string, unknown>;
}): Promise<FilesystemPlan> {
  return invoke<FilesystemPlan>('projects.create_plan', args);
}

export async function approvePlan(args: {
  id: string;
  delete_acknowledged?: boolean;
}): Promise<FilesystemPlan> {
  return invoke<FilesystemPlan>('plans.approve', args);
}

export async function applyPlan(args: { id: string }): Promise<OperationHandle> {
  return invoke<OperationHandle>('plans.apply', args);
}

export async function discardPlan(args: { id: string }): Promise<void> {
  return invoke<void>('plans.discard', args);
}

export async function updateSettings(args: {
  scope: string;
  values: Record<string, unknown>;
}): Promise<void> {
  return invoke<void>('settings.update', args);
}

export async function registerRoot(args: {
  path: string;
  category: string;
  scanSettings: Record<string, unknown>;
}): Promise<LibraryRoot> {
  return invoke<LibraryRoot>('roots.register', args);
}

export async function remapRoot(args: {
  root_id: string;
  new_path: string;
}): Promise<RemapVerification> {
  return invoke<RemapVerification>('roots.remap', args);
}

export async function applyRootRemap(args: {
  root_id: string;
  verified: boolean;
}): Promise<void> {
  return invoke<void>('roots.remap.apply', args);
}

export async function startScan(args?: {
  root_ids?: string[];
}): Promise<OperationHandle> {
  return invoke<OperationHandle>('scan.start', args);
}

export async function setPreference(args: {
  key: string;
  value: unknown;
}): Promise<void> {
  return invoke<void>('preferences.set', args);
}

export async function completeTourStep(args: { step: string }): Promise<void> {
  return invoke<void>('tour.complete_step', args);
}

// ---------- First-Run / Batch Commands ----------

export interface BatchSourceEntry {
  kind: string;
  path: string;
  scan_depth?: string;
}

export interface BatchRegisterResult {
  results: Array<{
    kind: string;
    path: string;
    success: boolean;
    root?: LibraryRoot;
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
  return invoke<BatchRegisterResult>('roots.register.batch', args);
}

export async function completeFirstRun(): Promise<FirstRunCompleteResult> {
  return invoke<FirstRunCompleteResult>('firstrun.complete');
}

export async function restartFirstRun(): Promise<FirstRunRestartResult> {
  return invoke<FirstRunRestartResult>('firstrun.restart', { request: { confirm: true } });
}

export async function getFirstRunState(): Promise<FirstRunState> {
  return invoke<FirstRunState>('firstrun.state');
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
  return invoke<PatternValidateResponse>('pattern.validate', { request: { pattern } });
}

/**
 * Preview a pattern against sample metadata for the Settings UI live preview.
 * Applies the same validation and sanitization pipeline as pattern.resolve.
 */
export async function patternPreview(
  pattern: PatternPart[],
  sampleMetadata: MetadataBundle,
): Promise<PatternPreviewResponse> {
  return invoke<PatternPreviewResponse>('pattern.preview', {
    request: { pattern, sampleMetadata },
  });
}

// ── Project commands (spec 008) ───────────────────────────────────────────────

/** List all projects as summary rows (real DB, not fixtures). */
export async function listProjects008(args?: {
  filters?: unknown;
}): Promise<ProjectSummaryDto[]> {
  return invoke<ProjectSummaryDto[]>('projects.list', { filters: args?.filters ?? null });
}

/** Get a single project with sources and channels. */
export async function getProject008(args: { id: string }): Promise<ProjectDetailDto> {
  return invoke<ProjectDetailDto>('projects.get', { id: args.id });
}

/** Create a new project (validates, persists, generates folder plan). */
export async function createProject(args: ProjectCreateRequest): Promise<ProjectCreateResult> {
  return invoke<ProjectCreateResult>('projects.create', { req: args });
}

/** Update name, tool, or notes on an existing project. */
export async function updateProject(args: ProjectUpdateRequest): Promise<ProjectUpdateResult> {
  return invoke<ProjectUpdateResult>('projects.update', { req: args });
}

/** Link an Inventory session to a project as a source. */
export async function addProjectSource(
  args: ProjectSourceAddRequest,
): Promise<ProjectSourceAddResult> {
  return invoke<ProjectSourceAddResult>('projects.source.add', { req: args });
}

/** Unlink a source from a project. */
export async function removeProjectSource(
  args: ProjectSourceRemoveRequest,
): Promise<ProjectSourceRemoveResult> {
  return invoke<ProjectSourceRemoveResult>('projects.source.remove', { req: args });
}

/** Re-infer channels from all linked sources (discards manual overrides). */
export async function reinferProjectChannels(
  args: ProjectChannelsReinferRequest,
): Promise<ProjectChannelsReinferResult> {
  return invoke<ProjectChannelsReinferResult>('projects.channels.reinfer', { req: args });
}

/** Dismiss the channel-drift banner without re-inferring. */
export async function dismissProjectChannelDrift(
  args: ProjectChannelsDismissDriftRequest,
): Promise<ProjectChannelsDismissDriftResult> {
  return invoke<ProjectChannelsDismissDriftResult>('projects.channels.dismiss_drift', {
    req: args,
  });
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
  return invoke<LifecycleTransitionResponse>('lifecycle_transition_apply', {
    request: { project: req },
  });
}

// ── Catalog commands (spec 014) ───────────────────────────────────────────────

/**
 * List all installed catalogs.
 * Returns every catalog in the `catalog_downloaded` table ordered by name.
 */
export async function catalogList(): Promise<CatalogListResponse> {
  return invoke<CatalogListResponse>('catalog.list');
}

/**
 * Get license attribution rows for all installed catalogs.
 * Separated from catalogList so the (potentially large) notice text is not
 * fetched on every Settings page open.
 */
export async function catalogAttributionGet(): Promise<CatalogAttributionGetResponse> {
  return invoke<CatalogAttributionGetResponse>('catalog.attribution.get');
}

/**
 * Fetch the catalog manifest from the project-hosted URL.
 * Pass `etag` from a prior successful fetch to enable HTTP 304 conditional
 * requests. Returns `status = 'not_modified'` when the ETag matches.
 */
export async function catalogManifestFetch(args?: {
  etag?: string;
}): Promise<CatalogManifestFetchResponse> {
  return invoke<CatalogManifestFetchResponse>('catalog.manifest.fetch', {
    etag: args?.etag,
  });
}

/**
 * Download, verify (SHA-256), and install a single catalog.
 * The `manifest` must come from a prior successful `catalogManifestFetch`.
 * Returns `status = 'success'` with `auditId` on success, or `status = 'failure'`
 * with an error envelope. The previously installed catalog (if any) remains
 * active until the new one is verified (FR-008).
 */
export async function catalogDownload(args: {
  catalogId: string;
  manifest: CatalogManifest;
}): Promise<CatalogDownloadResponse> {
  return invoke<CatalogDownloadResponse>('catalog.download', {
    args: { catalog_id: args.catalogId, manifest: args.manifest },
  });
}

// ── Inbox commands (spec 005) ─────────────────────────────────────────────────

/** Scan a root folder and upsert inbox items for each FITS/video leaf directory. */
export async function inboxScanFolder(
  req: InboxScanFolderRequest,
): Promise<InboxScanFolderResponse> {
  return invoke<InboxScanFolderResponse>('inbox.scan.folder', { req });
}

/**
 * Classify an Inbox item using IMAGETYP-only evidence.
 * Idempotent unless `forceRescan` is true.
 */
export async function inboxClassify(req: InboxClassifyRequest): Promise<InboxClassifyResponse> {
  return invoke<InboxClassifyResponse>('inbox.classify', { req });
}

/**
 * Generate a reviewable plan from a classified Inbox item.
 * `action`: `"split"` for mixed items, `"confirm"` for `single_type`.
 */
export async function inboxConfirm(req: InboxConfirmRequest): Promise<InboxConfirmResponse> {
  return invoke<InboxConfirmResponse>('inbox.confirm', { req });
}

/** Write manual frame-type overrides and re-aggregate the classification. */
export async function inboxReclassify(
  req: InboxReclassifyRequest,
): Promise<InboxReclassifyResponse> {
  return invoke<InboxReclassifyResponse>('inbox.reclassify', { req });
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
  return invoke<CalibrationMatchSuggestResponse>('calibration.match.suggest', {
    req: {
      contractVersion: '2.0.0',
      requestId: args.requestId,
      sessionId: args.sessionId,
      calibrationTypes: args.calibrationTypes,
    },
  });
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
  return invoke<CalibrationMatchAssignResponse>('calibration.match.assign', {
    req: {
      contractVersion: '2.0.0',
      requestId: args.requestId,
      sessionId: args.sessionId,
      masterId: args.masterId,
      override: args.override,
    },
  });
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
  return invoke<CalibrationMatchBatchResponse>('calibration.match.suggest.batch', {
    req: {
      contractVersion: '1.0',
      requestId: args.requestId,
      sessionIds: args.sessionIds,
      calibrationTypes: args.calibrationTypes,
    },
  });
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
  return invoke<InventoryListResponse>('inventory.list', { req });
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
  return invoke<InventorySessionReviewResponse>('inventory.session.review', { req });
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
  return invoke<ToolProfileListResponse>('tools.list');
}

/** Launch a processing tool for a project. */
export async function toolLaunch(request: ToolLaunchRequest): Promise<ToolLaunchResponse> {
  return invoke<ToolLaunchResponse>('tools.launch', { request });
}

/** Save `executable_path` / enabled for a tool. */
export async function toolUpdate(request: UpdateProcessingTool): Promise<ToolProfileSummary> {
  return invoke<ToolProfileSummary>('tools.update', { request });
}

/** Validate an executable path. */
export async function toolValidatePath(path: string): Promise<ToolPathValidation> {
  return invoke<ToolPathValidation>('tools.validate_path', { path });
}

/** Auto-detect installed tool paths. */
export async function toolDiscover(request: ToolDiscoverRequest): Promise<ToolDiscoverResponse> {
  return invoke<ToolDiscoverResponse>('tools.discover', { request });
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
  return invoke<ArtifactListResponse>('artifact.list', { request });
}

/**
 * `artifact.classify` — apply or clear a manual classification override.
 *
 * Pass `kind: null` to clear the override and re-apply workflow-profile rules.
 */
export async function artifactClassify(
  request: ArtifactClassifyRequest,
): Promise<ArtifactClassifyResponse> {
  return invoke<ArtifactClassifyResponse>('artifact.classify', { request });
}

/**
 * `artifact.mark_resolved` — mark a `missing` artifact as user-resolved.
 */
export async function artifactMarkResolved(request: ArtifactMarkResolvedRequest): Promise<void> {
  return invoke<void>('artifact.mark_resolved', { request });
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
  return invoke<SourceProtectionGetResponse>('source.protection.get', { sourceId });
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
  return invoke<SourceProtectionSetResponse>('source.protection.set', { request });
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
  return invoke<PlanProtectionCheckResponse>('plan.protection.check', { planId });
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
  return invoke<string>('protection.plan.acknowledged', {
    planId,
    itemId,
    sourceId,
    resolvedLevel,
    reason,
  });
}


// ── Spec 023: Target Identity, History, and Notes ─────────────────────────────

/**
 * `target.get` — load the full target aggregate (spec 023).
 *
 * Returns identity, aliases, catalog refs, sessions, projects, and notes for
 * a target by id. Uses the spec-023 backend (`target.get` command) rather
 * than the legacy `targets.get` stub.
 */
export async function getTargetIdentity(args: {
  targetId: string;
}): Promise<TargetGetResult> {
  return invoke<TargetGetResult>('target.get', args);
}

/**
 * `target.note.update` — replace the per-target free-text note (spec 023).
 */
export async function updateTargetNote(
  req: TargetNoteUpdateRequest,
): Promise<TargetNoteUpdateResult> {
  return invoke<TargetNoteUpdateResult>('target.note.update', { req });
}

/**
 * `target.alias.add` — append an alias to a target (spec 023).
 *
 * Idempotent: re-adding an alias already on this target returns `added=false`.
 * Returns `alias.duplicate` error when the normalized alias belongs to another target.
 */
export async function addTargetAlias(
  req: TargetAliasAddRequest,
): Promise<TargetAliasAddResult> {
  return invoke<TargetAliasAddResult>('target.alias.add', { req });
}

/**
 * `target.alias.remove` — remove an alias from a target (spec 023).
 *
 * Rejects with `alias.is_primary` if the alias is the current primary.
 */
export async function removeTargetAlias(
  req: TargetAliasRemoveRequest,
): Promise<TargetAliasRemoveResult> {
  return invoke<TargetAliasRemoveResult>('target.alias.remove', { req });
}

/**
 * `target.primary.rename` — promote an existing alias to primary_designation (spec 023).
 *
 * The alias MUST already be in the target's alias list. On success the old
 * primary becomes an alias.
 */
export async function renameTargetPrimary(
  req: TargetPrimaryRenameRequest,
): Promise<TargetPrimaryRenameResult> {
  return invoke<TargetPrimaryRenameResult>('target.primary.rename', { req });
}

// Re-export TargetOpError type for callers that need to type-narrow errors.
export type { TargetOpError };

// ── spec 024: Project Manifests & Notes ───────────────────────────────────────

/**
 * `project.manifest.list` — list manifest snapshots for a project (spec 024).
 *
 * Returns summaries ordered newest first, paginated (default 50, max 200).
 */
export async function listManifests(
  request: ManifestListRequest,
): Promise<ManifestListResponse> {
  return invoke<ManifestListResponse>('project.manifest.list', { request });
}

/**
 * `project.manifest.get` — fetch one manifest with its full structured body (spec 024).
 */
export async function getManifest(request: ManifestGetRequest): Promise<ManifestGetResponse> {
  return invoke<ManifestGetResponse>('project.manifest.get', { request });
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
  return invoke<ProjectNoteUpdateResult>('project.note.update', { req });
}

/**
 * `project.note.get` — fetch current notes body for a project (spec 024).
 *
 * Returns `content: null` when no note has been saved yet.
 */
export async function getProjectNote(req: ProjectNoteGetRequest): Promise<ProjectNoteGetResult> {
  return invoke<ProjectNoteGetResult>('project.note.get', { req });
}

/**
 * `project.manifest.reveal_in_os` — open the manifest file in the OS file manager (spec 024).
 */
export async function revealManifestInOs(request: ManifestRevealRequest): Promise<void> {
  return invoke<void>('project.manifest.reveal_in_os', { request });
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
  return invoke<DevContractsListResponse>('dev.contracts.list', { request: args ?? {} });
}

/**
 * `dev.calls.list` — return most-recent recorded calls (spec 021 US2).
 * Only available in dev-tools builds when devMode is on.
 */
export async function devCallsList(args?: {
  requestId?: string;
  limit?: number;
}): Promise<DevCallsListResponse> {
  return invoke<DevCallsListResponse>('dev.calls.list', { request: args ?? {} });
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
  return invoke<DevExportResponse>('dev.export', { request: args });
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
  return invoke<DevSchemaGetResponse>('dev.schema.get', {
    request: { schemaPath },
  });
}
