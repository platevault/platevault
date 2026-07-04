import type {
  AuditEntry,
  SearchResult,
  LibraryRoot,
  Equipment,
  SettingsData,
  AppPreferences,
  CalendarData,
  MasterDetail,
  MatchCandidate,
} from '@/bindings/types';
import type {
  CalibrationTolerances,
  InboxListResponse_Serialize,
  InboxScanFolderResponse_Serialize,
  InboxClassifyResponse_Serialize,
  InboxConfirmResponse,
  InboxReclassifyResponse_Serialize,
  TargetListItem,
  TargetDetailV3_Serialize,
  TargetSearchResponse_Serialize,
  TargetResolveSimbadResponse_Serialize,
  ProjectCreateResult_Serialize,
  ProjectUpdateResult,
  ProjectSourceAddResult_Serialize,
  ProjectSourceRemoveResult_Serialize,
  ProjectChannelsReinferResult_Serialize,
  ProjectChannelsDismissDriftResult,
  TransitionResponse_Serialize,
  LogRecentResponse_Serialize,
  LogExportResponse_Serialize,
  FirstRunRestartResponse,
  FirstRunStateResponse_Serialize,
  FirstRunCompleteResponse,
  RegisterSourceBatchResponse_Serialize,
  RemapVerification,
  IpcOperationHandle,
  OperationEvent,
  PlanApplyResponse,
  AuditListResponse_Serialize,
  Camera,
  CreateCamera,
  UpdateCamera,
  Telescope,
  CreateTelescope,
  UpdateTelescope,
  OpticalTrain,
  CreateOpticalTrain,
  UpdateOpticalTrain,
  Filter,
  CreateFilter,
  UpdateFilter,
  CalibrationMatchSuggestResponse,
  CalibrationMatchBatchResponse,
  CalibrationMatchDto_Serialize,
  IngestionSettings,
  UpdateIngestionSettings,
  AuditFilterDto,
  AuditPaginationDto,
  PathPatternPreviewResponse,
} from '@/bindings/index';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── pattern.path_preview token bridge (spec 041 P11) ──────────────────────────
//
// Maps a v1 registry `{token}` name (snake_case, as it appears in a per-type
// destination pattern string) to the camelCase `MetadataBundleDto` field name
// carried in `sampleMetadata`. Fallbacks mirror `crates/patterns/src/registry.rs`
// (data-model.md §Errors) so the mock preview matches the real resolver's
// "missing token" substitution.
const PATH_PREVIEW_TOKEN_FIELDS: Record<string, string> = {
  target: 'target',
  filter: 'filter',
  date: 'date',
  frame_type: 'frameType',
  camera: 'camera',
  exposure: 'exposure',
  gain: 'gain',
  binning: 'binning',
  set_temp: 'setTemp',
};

const PATH_PREVIEW_TOKEN_FALLBACKS: Record<string, string> = {
  target: 'unclassified',
  filter: 'nofilter',
  date: 'undated',
  frame_type: 'unknown',
  camera: 'unknown-camera',
  exposure: 'unknown-exposure',
  gain: 'unknown-gain',
  binning: '1x1',
  set_temp: 'untempered',
};

// --- Inline fixtures for modules not yet created by T015 ---
//
// Each fixture is pinned to its generated binding type (either via a typed
// `const` annotation or a `satisfies` clause).  This makes any drift between a
// mock fixture and the generated `@/bindings` contract a *compile* error rather
// than a silent mock-mode lie (spec 042 US7 T190/T192).

const mockAuditEntries: AuditEntry[] = [
  { id: 'audit-001', timestamp: '2026-05-20T22:15:00Z', eventType: 'session.confirmed', entityType: 'session', entityId: 'ses-001', fromState: 'needs_review', toState: 'confirmed', actor: 'user', outcome: 'applied', detail: 'User confirmed session' },
  { id: 'audit-002', timestamp: '2026-05-20T22:10:00Z', eventType: 'plan.approved', entityType: 'plan', entityId: 'plan-001', fromState: 'ready_for_review', toState: 'approved', actor: 'user', outcome: 'applied', detail: 'Plan approved' },
  { id: 'audit-003', timestamp: '2026-05-20T21:45:00Z', eventType: 'plan.applied', entityType: 'plan', entityId: 'plan-001', fromState: 'approved', toState: 'applied', actor: 'system', outcome: 'applied', detail: 'All 12 items applied' },
  { id: 'audit-004', timestamp: '2026-05-19T23:30:00Z', eventType: 'scan.completed', entityType: 'root', entityId: 'root-001', actor: 'system', outcome: 'ok', detail: 'Discovered 1,247 files in 4.2s' },
  { id: 'audit-005', timestamp: '2026-05-19T23:25:00Z', eventType: 'scan.started', entityType: 'root', entityId: 'root-001', actor: 'user', outcome: 'ok', detail: 'Manual scan triggered' },
];

/**
 * Mirrors the real `audit_list`/`audit_export` filter semantics
 * (`apps/desktop/src-tauri/src/commands/audit.rs`) over the mock fixture, so
 * mock mode exercises the same search/entity/outcome/date-range filtering the
 * real `audit_log_entry` query applies. `severity` has no equivalent on the
 * `AuditEntry` fixture (the real DTO doesn't carry it either — only the
 * filter does) and is ignored here, same as it plays no role in what the UI
 * renders.
 */
function filterMockAuditEntries(filters: AuditFilterDto | null | undefined): AuditEntry[] {
  let result = mockAuditEntries;
  if (filters?.entityType) {
    result = result.filter((e) => e.entityType === filters.entityType);
  }
  if (filters?.entityId) {
    result = result.filter((e) => e.entityId === filters.entityId);
  }
  if (filters?.outcome) {
    result = result.filter((e) => e.outcome === filters.outcome);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (e) =>
        e.eventType.toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q) ||
        e.entityId.toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q),
    );
  }
  if (filters?.from) {
    const from = new Date(filters.from).getTime();
    result = result.filter((e) => new Date(e.timestamp).getTime() >= from);
  }
  if (filters?.to) {
    const to = new Date(filters.to).getTime();
    result = result.filter((e) => new Date(e.timestamp).getTime() < to);
  }
  return [...result].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

const mockSettingsData: SettingsData = {
  scope: 'general',
  values: {
    naming_pattern: '{target}/{date}/{filter}/{target}_{filter}_{sequence}.fits',
    default_source_view_strategy: 'symlink',
    calibration_age_warning_days: 90,
  },
};

// Mutable so `ingestion_settings_update` round-trips through `_get` in mock
// mode (spec 030, package P12) — mirrors real persistence closely enough for
// the Ingestion settings pane's load/save flow to be exercised without a
// backend.
let mockIngestionSettings: IngestionSettings = {
  watcherEnabled: true,
  scanOnStartup: true,
  followSymlinks: false,
  followJunctions: false,
  hashingMode: 'lazy',
  metadataExtraction: true,
  exposureGroupingToleranceS: 2,
  temperatureGroupingToleranceC: 5,
  defaultFilter: null,
};

// Spec 007 / spec 043 P8 — mirrors the persisted `calibration_tolerances`
// singleton row's real defaults (migration 0008 + 0051), including
// `requireSameOffset` (STUB-OFFSET-REQUIRED closed: this is now a real,
// persisted field, not a local-only stub).
const mockCalibrationTolerances: CalibrationTolerances = {
  temperatureToleranceC: 5.0,
  exposureToleranceS: 2.0,
  agingLimitDays: 365,
  requireSameCamera: true,
  requireSameGain: true,
  requireSameBinning: true,
  requireSameOffset: true,
};

let mockRoots: LibraryRoot[] = [
  { id: 'root-001', path: '/astro/raw', category: 'raw', online: true, fileCount: 1247, lastScanned: '2026-05-19T23:30:00Z', active: true },
  { id: 'root-002', path: '/astro/calibration', category: 'calibration', online: true, fileCount: 342, lastScanned: '2026-05-19T23:30:00Z', active: true },
  { id: 'root-003', path: '/astro/projects', category: 'project', online: true, fileCount: 856, lastScanned: '2026-05-18T20:00:00Z', active: true },
];

const mockEquipment: Equipment[] = [
  { id: 'eq-001', name: 'ASI2600MM Pro', kind: 'camera', aliases: ['ZWO ASI2600MM'] },
  { id: 'eq-002', name: 'Esprit 100ED', kind: 'telescope', aliases: ['SW Esprit 100ED'] },
  { id: 'eq-003', name: 'EQ6-R Pro', kind: 'mount', aliases: ['EQ6R'] },
];

// ── Equipment CRUD (spec 030) ────────────────────────────────────────────────
//
// Mutable in-memory stores so mock mode's add/edit/delete flows behave like
// the real backend across a session (previously `@/data/fixtures/settings`,
// which the Equipment pane held in local `useState` and never persisted
// through an IPC round-trip). Seed data replaces those retired fixtures.

let mockCameras: Camera[] = [
  { id: 'cam-001', name: 'ASI2600MM Pro', aliases: ['ZWO ASI2600MM'], autoDetected: false },
  { id: 'cam-002', name: 'ASI533MC Pro', aliases: ['ZWO ASI533MC'], autoDetected: false },
];

let mockTelescopes: Telescope[] = [
  { id: 'tel-001', name: 'Takahashi FSQ-106EDX4', aliases: [], focalLengthMm: 530, autoDetected: false },
  { id: 'tel-002', name: 'William Optics GT81', aliases: [], focalLengthMm: 478, autoDetected: false },
];

let mockOpticalTrains: OpticalTrain[] = [
  {
    id: 'train-001',
    name: 'FSQ-106 + ASI2600MM',
    telescopeId: 'tel-001',
    cameraId: 'cam-001',
    focalLengthMm: 530,
  },
];

let mockFilters: Filter[] = [
  { id: 'filt-001', name: 'Ha', category: 'narrowband', autoDetected: false },
  { id: 'filt-002', name: 'OIII', category: 'narrowband', autoDetected: false },
  { id: 'filt-003', name: 'SII', category: 'narrowband', autoDetected: false },
  { id: 'filt-004', name: 'L', category: 'broadband', autoDetected: false },
  { id: 'filt-005', name: 'R', category: 'broadband', autoDetected: false },
  { id: 'filt-006', name: 'G', category: 'broadband', autoDetected: false },
  { id: 'filt-007', name: 'B', category: 'broadband', autoDetected: false },
];

/** Mirrors the shape `unwrap()` expects on the error branch of a `Result`. */
function mockContractError(code: string, message: string): never {
  throw { code, message, severity: 'blocking', retryable: false };
}

const mockPreferences: AppPreferences = {
  sidebarCollapsed: false,
  density: 'comfortable',
  projectViewModes: {},
  defaultProjectView: 'combined',
  sessionsGroupBy: 'none',
  sessionsView: 'list',
  tourCompleted: { step1: false, step2: false, step3: false },
  setupCompleted: false,
};

// Review items are loaded from the wireframe-aligned fixture file (review.queue case below).

const mockSearchResults: SearchResult[] = [
  { id: 'ses-001', kind: 'session', label: 'M31 L 2026-05-18', sublabel: '120 frames', route: '/sessions/ses-001', score: 0.95 },
  { id: 'target-001', kind: 'target', label: 'M31 - Andromeda Galaxy', sublabel: '5 sessions', route: '/targets/target-001', score: 0.90 },
  { id: 'proj-001', kind: 'project', label: 'M31 LRGB', sublabel: 'Processing', route: '/projects/proj-001', score: 0.85 },
  { id: 'nav-sessions', kind: 'page', label: 'Sessions', sublabel: 'Browse all sessions', route: '/sessions', score: 0.50 },
];

const mockCalendarData: CalendarData = {
  months: [
    {
      year: 2026,
      month: 5,
      days: [
        { day: 18, sessions: [{ id: 'ses-001', target: 'M31', filter: 'L' }] },
        { day: 19, sessions: [{ id: 'ses-003', target: 'M31', filter: 'R' }, { id: 'ses-004', target: 'M31', filter: 'G' }] },
        { day: 20, sessions: [{ id: 'ses-005', target: 'NGC 7000', filter: 'Ha' }] },
      ],
    },
  ],
};

const mockMasterDetail: MasterDetail = {
  id: 'master-001',
  kind: 'dark',
  fingerprint: { camera: 'ASI2600MM', sensorMode: 'normal', exposureS: 300, tempC: -10, gain: 100, binning: '1x1' },
  sourceSessionId: 'cal-ses-001',
  createdAt: '2026-05-15T20:00:00Z',
  ageDays: 9,
  sizeBytes: 52_428_800,
  usedBySessionIds: ['ses-001', 'ses-003'],
  usedByProjectIds: ['proj-001'],
  compatibleSessions: [{ sessionId: 'ses-001', score: 0.97, softMismatches: [] }],
  usageStats: { sessionCount: 2, projectCount: 1 },
};

const mockMatchCandidates: MatchCandidate[] = [
  { masterId: 'master-001', kind: 'dark', score: 0.97, softMismatches: [] },
  { masterId: 'master-002', kind: 'flat', score: 0.92, filter: 'L', softMismatches: ['age > 60 days'] },
  { masterId: 'master-003', kind: 'bias', score: 0.99, softMismatches: [] },
];

/**
 * `calibration.match.suggest` / `.suggest.batch` fixtures (spec P9).
 *
 * The second candidate deliberately omits every session-context field to
 * exercise the real-app "—" fallback (no canonical target link / no
 * fingerprint row) alongside the first candidate's fully-resolved context.
 */
function mockCalibrationMatches(sessionId: string): CalibrationMatchDto_Serialize[] {
  return [
    {
      sessionId,
      masterId: 'master-001',
      calibrationType: 'dark',
      confidence: 0.97,
      dimensionsMatched: [
        { dimension: 'gain', observed: { value: 100 }, reference: { value: 100 } },
        { dimension: 'offset', observed: { value: 10 }, reference: { value: 10 } },
      ],
      dimensionsMismatched: [],
      selectionReason: 'same_night',
      targetName: 'M 31',
      filter: 'Ha',
      acquisitionNight: '2026-05-18',
      frameCount: 42,
    },
    {
      sessionId,
      masterId: 'master-002',
      calibrationType: 'dark',
      confidence: 0.81,
      dimensionsMatched: [{ dimension: 'gain', observed: { value: 100 }, reference: { value: 100 } }],
      dimensionsMismatched: [
        { dimension: 'temperature', reason: 'out_of_tolerance', delta: 3.5 },
      ],
      selectionReason: 'compatible_fallback',
      // Unresolved session context — every P9 field stays absent.
    },
  ];
}

/**
 * Dispatch a mock IPC response for `cmd`.
 *
 * Returns `Promise<unknown>`: the caller (`invoke<T>` in `ipc.ts` /
 * `source-views.ts`) supplies the concrete `T` from the generated bindings and
 * narrows at its own boundary.  Internally there are no blind `as T` casts —
 * every returned fixture is checked against its generated binding type, so a
 * contract change that the mock fails to mirror is a compile error.
 */
export async function mockInvoke(
  cmd: string,
  _args?: Record<string, unknown>,
): Promise<unknown> {
  // Simulate realistic network/IPC latency
  await delay(50 + Math.random() * 100);

  switch (cmd) {
    // ---------- Query Commands ----------

    case 'sessions_list': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return sessions;
    }
    case 'sessions_get': {
      const { sessionDetail } = await import('@/data/fixtures/sessions');
      return sessionDetail;
    }
    case 'sessions_calendar': {
      return mockCalendarData;
    }
    case 'calibration_masters_list': {
      const { masters } = await import('@/data/fixtures/calibration');
      return masters;
    }
    case 'calibration_masters_get': {
      return mockMasterDetail;
    }
    case 'calibration_matches': {
      return mockMatchCandidates;
    }
    case 'calibration_match_suggest': {
      const req = (_args as { req?: { requestId?: string; sessionId?: string } } | undefined)?.req;
      const sessionId = req?.sessionId ?? 'ses-001';
      return {
        status: 'success',
        contractVersion: '2.0.0',
        requestId: req?.requestId ?? crypto.randomUUID(),
        suggestStatus: 'match',
        matches: mockCalibrationMatches(sessionId),
      } satisfies CalibrationMatchSuggestResponse;
    }
    case 'calibration_match_suggest_batch': {
      const req = (_args as { req?: { requestId?: string; sessionIds?: string[] } } | undefined)?.req;
      const sessionIds = req?.sessionIds ?? ['ses-001'];
      return {
        status: 'success',
        contractVersion: '1.0',
        requestId: req?.requestId ?? crypto.randomUUID(),
        results: sessionIds.map((sessionId) => ({
          sessionId,
          calibrationType: 'dark' as const,
          status: 'match',
          candidates: mockCalibrationMatches(sessionId),
        })),
      } satisfies CalibrationMatchBatchResponse;
    }
    case 'calibration_tolerances_get': {
      return mockCalibrationTolerances;
    }
    case 'targets_list': {
      const { targets } = await import('@/data/fixtures/targets');
      return targets;
    }
    case 'targets_get': {
      const { targetDetail } = await import('@/data/fixtures/targets');
      return targetDetail;
    }

    // ── gen-3 target commands (spec 036) ──────────────────────────────────────
    case 'target_list': {
      return [
        { id: 'tgt-m31', effectiveLabel: 'M 31', primaryDesignation: 'M 31', objectType: 'galaxy', raDeg: 10.6847, decDeg: 41.269, constellation: 'Andromeda', magnitude: 3.44, aliases: ['M 31', 'NGC 224', 'Andromeda Galaxy'] },
        { id: 'tgt-ngc7000', effectiveLabel: 'NGC 7000', primaryDesignation: 'NGC 7000', objectType: 'emission_nebula', raDeg: 314.75, decDeg: 44.52, constellation: 'Cygnus', magnitude: 4.0, aliases: ['NGC 7000', 'North America Nebula'] },
      ] satisfies TargetListItem[];
    }
    case 'target_get': {
      const req = (_args as { req?: { targetId?: string } } | undefined)?.req;
      return {
        id: req?.targetId ?? 'tgt-m31',
        primaryDesignation: 'M 31',
        effectiveLabel: 'M 31',
        displayAlias: null,
        objectType: 'galaxy',
        raDeg: 10.68,
        decDeg: 41.27,
        simbadOid: 1_234_567,
        source: 'resolved',
        aliases: [],
      } satisfies TargetDetailV3_Serialize;
    }
    case 'target_search': {
      const req = (_args as { req?: { query?: string } } | undefined)?.req;
      const q = (req?.query ?? '').toLowerCase();
      const allSuggestions = [
        { targetId: 'tgt-m31', primaryDesignation: 'M 31', commonName: 'Andromeda Galaxy', objectType: 'galaxy', matchedAlias: 'Andromeda', source: 'seed' },
        { targetId: 'tgt-ngc7000', primaryDesignation: 'NGC 7000', commonName: null, objectType: 'emission_nebula', matchedAlias: 'North America Nebula', source: 'seed' },
      ] satisfies TargetSearchResponse_Serialize['suggestions'];
      const suggestions = q
        ? allSuggestions.filter(
            (s) =>
              s.primaryDesignation.toLowerCase().includes(q) ||
              (s.commonName?.toLowerCase().includes(q) ?? false) ||
              (s.matchedAlias?.toLowerCase().includes(q) ?? false),
          )
        : allSuggestions;
      return { contractVersion: '1.0', requestId: crypto.randomUUID(), suggestions } satisfies TargetSearchResponse_Serialize;
    }
    case 'target_resolve': {
      const req = (_args as { req?: { query?: string } } | undefined)?.req;
      const query = req?.query ?? 'M 31';
      return {
        contractVersion: '1.0',
        requestId: crypto.randomUUID(),
        status: 'resolved',
        target: {
          targetId: `tgt-resolved-${Date.now()}`,
          primaryDesignation: query,
          commonName: null,
          objectType: 'other',
          source: 'resolved',
          raDeg: 0,
          decDeg: 0,
          simbadOid: null,
          aliases: [],
        },
        unresolvedReason: null,
        error: null,
      } satisfies TargetResolveSimbadResponse_Serialize;
    }

    case 'projects_list': {
      // spec 008 real shape: ProjectSummaryDto[]
      const { mockProjectSummaries } = await import('@/data/fixtures/projects');
      return mockProjectSummaries;
    }
    case 'projects_get': {
      // spec 008 real shape: ProjectDetailDto
      const { mockProjectDetail008 } = await import('@/data/fixtures/projects');
      return mockProjectDetail008;
    }
    case 'projects_create': {
      // Return a minimal success result; tests override this via vi.mock.
      return {
        projectId: 'mock-project-id',
        lifecycle: 'setup_incomplete',
        planId: 'mock-plan-id',
        channels: [],
        auditId: 'mock-audit-id',
        createdAt: new Date().toISOString(),
        // mkdir-only scaffolding auto-applies (user decision 2026-07-04).
        scaffoldApplied: true,
      } satisfies ProjectCreateResult_Serialize;
    }
    case 'projects_update': {
      const req = (_args as { req?: { projectId?: string } } | undefined)?.req;
      return {
        projectId: req?.projectId ?? 'mock-id',
        fieldsUpdated: [],
        auditId: 'mock-audit-id',
        updatedAt: new Date().toISOString(),
      } satisfies ProjectUpdateResult;
    }
    case 'projects_source_add': {
      const req = (_args as { req?: { projectId?: string } } | undefined)?.req;
      return {
        projectId: req?.projectId ?? 'mock-id',
        sourceAdded: { inventoryId: 'mock-inv', name: '', frames: 0, filter: '', exposure: '', linkedAt: new Date().toISOString() },
        channels: [],
        auditId: 'mock-audit-id',
        linkedAt: new Date().toISOString(),
      } satisfies ProjectSourceAddResult_Serialize;
    }
    case 'projects_source_remove': {
      const req = (_args as { req?: { projectId?: string; projectSourceId?: string } } | undefined)?.req;
      return {
        projectId: req?.projectId ?? 'mock-id',
        removedSourceId: req?.projectSourceId ?? 'mock-src',
        auditId: 'mock-audit-id',
      } satisfies ProjectSourceRemoveResult_Serialize;
    }
    case 'projects_channels_reinfer': {
      const req = (_args as { req?: { projectId?: string } } | undefined)?.req;
      return {
        projectId: req?.projectId ?? 'mock-id',
        channels: [],
        auditId: 'mock-audit-id',
        updatedAt: new Date().toISOString(),
      } satisfies ProjectChannelsReinferResult_Serialize;
    }
    case 'projects_channels_dismiss_drift': {
      const req = (_args as { req?: { projectId?: string } } | undefined)?.req;
      return {
        projectId: req?.projectId ?? 'mock-id',
        auditId: 'mock-audit-id',
        dismissedAt: new Date().toISOString(),
      } satisfies ProjectChannelsDismissDriftResult;
    }
    case 'plans_list': {
      const { plans } = await import('@/data/fixtures/plans');
      return plans;
    }
    case 'plans_get': {
      const { planDetail } = await import('@/data/fixtures/plans');
      return planDetail;
    }
    case 'audit_list': {
      const args = _args as
        | { filters?: AuditFilterDto | null; pagination?: AuditPaginationDto | null }
        | undefined;
      const filtered = filterMockAuditEntries(args?.filters);
      const offset = args?.pagination?.offset ?? 0;
      const limit = args?.pagination?.limit ?? filtered.length;
      const page = filtered.slice(offset, offset + limit);
      return { entries: page, total: filtered.length } satisfies AuditListResponse_Serialize;
    }
    case 'audit_export': {
      const args = _args as { filters?: AuditFilterDto | null } | undefined;
      const filtered = filterMockAuditEntries(args?.filters);
      return filtered.map((e) => JSON.stringify(e)).join('\n');
    }
    case 'log_recent': {
      const { MOCK_LOG_ENTRIES } = await import('@/data/mockLogEntries');
      return {
        contractVersion: '1',
        entries: MOCK_LOG_ENTRIES,
        truncated: false,
      } satisfies LogRecentResponse_Serialize;
    }
    case 'log_export': {
      const args = _args as { requestId?: string; filePath?: string } | undefined;
      return {
        contractVersion: '1',
        requestId: args?.requestId ?? 'mock-req',
        status: 'success',
        filePath: args?.filePath ?? '/tmp/log-export.json',
        count: 8,
        bytes: 1024,
      } satisfies LogExportResponse_Serialize;
    }
    case 'settings_get': {
      return mockSettingsData;
    }
    case 'ingestion_settings_get': {
      return mockIngestionSettings;
    }
    case 'roots_list': {
      return mockRoots;
    }
    case 'equipment_list': {
      return mockEquipment;
    }
    case 'equipment_cameras_list': {
      return mockCameras;
    }
    case 'equipment_telescopes_list': {
      return mockTelescopes;
    }
    case 'equipment_trains_list': {
      return mockOpticalTrains;
    }
    case 'equipment_filters_list': {
      return mockFilters;
    }
    case 'review_queue': {
      const { reviewItems } = await import('@/data/fixtures/review');
      return reviewItems;
    }
    case 'preferences_get': {
      return mockPreferences;
    }
    case 'search_global': {
      return mockSearchResults;
    }

    // ---------- Mutation Commands ----------

    case 'lifecycle_transition_apply': {
      // Mock: always succeeds. The request carries the desired nextState inside
      // `args.request.project.nextState` — echo it back so the UI can update.
      const req = (_args as { request?: { project?: { nextState?: string; currentState?: string; entityId?: string } } } | undefined)
        ?.request?.project;
      return {
        status: 'success',
        contractVersion: '2.0.0',
        requestId: crypto.randomUUID(),
        appliedAt: new Date().toISOString(),
        priorState: req?.currentState ?? 'processing',
        newState: req?.nextState ?? 'completed',
        auditId: 'mock-audit-transition',
      } satisfies TransitionResponse_Serialize;
    }

    case 'sessions_split': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return { original: sessions[0], new: sessions[1] };
    }
    case 'sessions_merge': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return sessions[0];
    }
    case 'projects_create_plan': {
      const { plans } = await import('@/data/fixtures/plans');
      return plans[0];
    }
    case 'plans_approve': {
      const { plans } = await import('@/data/fixtures/plans');
      return plans[0];
    }
    case 'plans_apply_real': {
      // Spec 042 US16 (T240): drive the live long-op channel if a subscriber
      // passed one. `onEvent` is a real `Channel<OperationEvent>` in mock mode;
      // pushing through `onmessage` mirrors the backend's Started → per-item →
      // Completed lifecycle so UI/tests can exercise streaming without a backend.
      const channel = (_args as { onEvent?: { onmessage?: (e: OperationEvent) => void } })
        ?.onEvent;
      if (channel?.onmessage) {
        const opId = 'op-mock-001';
        const push = channel.onmessage;
        const mk = (
          sequence: number,
          eventType: OperationEvent['eventType'],
          payload: unknown,
        ): OperationEvent => ({
          contractVersion: '1.0.0',
          operationId: opId,
          eventType,
          sequence,
          payload,
        });
        // Emit asynchronously so callers can attach listeners first.
        void Promise.resolve().then(() => {
          push(mk(0, 'item_started', { runId: opId, itemsTotal: 1, at: '1970-01-01T00:00:00Z' }));
          push(mk(1, 'item_applied', { runId: opId, itemId: 'item-0', newState: 'succeeded' }));
          push(
            mk(2, 'completed', {
              runId: opId,
              terminalState: 'completed',
              itemsApplied: 1,
              itemsFailed: 0,
            }),
          );
        });
      }
      // Resolve with the real `PlanApplyResponse` contract ({ planId, runId,
      // newState }) — the live per-item progress is the channel stream above
      // (spec 042 T270).
      const applyPlanId = (_args as { planId?: string } | undefined)?.planId ?? 'mock-plan';
      return { planId: applyPlanId, runId: 'op-mock-001', newState: 'applied' } satisfies PlanApplyResponse;
    }
    case 'plans_discard': {
      return null;
    }
    case 'settings_update': {
      return null;
    }
    case 'ingestion_settings_update': {
      const req = (_args as { request?: UpdateIngestionSettings } | undefined)?.request;
      if (req) {
        mockIngestionSettings = { ...req };
      }
      return mockIngestionSettings;
    }
    case 'calibration_tolerances_update': {
      // Echo the request back, mirroring the real `calibration.tolerances.update`
      // command's upsert-then-return behaviour (persistence_db::repositories::
      // calibration_tolerances::update).
      const req = (_args as { request?: CalibrationTolerances } | undefined)?.request;
      return { ...mockCalibrationTolerances, ...req } satisfies CalibrationTolerances;
    }
    case 'roots_register': {
      return mockRoots[0];
    }
    case 'roots_remap': {
      // Generated `RemapVerification` is camelCase; mirror the real contract so
      // the verification UI (which reads `samples`/`allVerified`) works in mock
      // mode exactly as it does against the backend. The generated `rootsRemap`
      // binding invokes with `{ rootId, newPath }` (camelCase) — NOT
      // `root_id`/`new_path` — so read those keys here.
      const rootId = (_args?.rootId as string) ?? 'root-001';
      const newPath = (_args?.newPath as string) ?? '/new/path';
      const originalPath = mockRoots.find((r) => r.id === rootId)?.path ?? '/old/path';
      return {
        rootId,
        originalPath,
        newPath,
        samples: [
          { relativePath: 'M31/light_001.fits', found: true },
          { relativePath: 'M31/light_002.fits', found: true },
        ],
        allVerified: true,
      } satisfies RemapVerification;
    }
    case 'roots_remap_apply': {
      return null;
    }
    case 'sources_set_active': {
      // Generated `sourcesSetActive` binding invokes with `{ rootId, active }`
      // (camelCase) — mirror the real backend's `registered_sources.active`
      // toggle so mock mode's Disable/Enable buttons behave persistently.
      const rootId = (_args?.rootId as string) ?? '';
      const active = (_args?.active as boolean) ?? true;
      mockRoots = mockRoots.map((r) => (r.id === rootId ? { ...r, active } : r));
      return null;
    }
    case 'roots_delete': {
      // Mirrors the real backend's decision D8 block: `root-001` carries mock
      // "dependents" (it has file_count/lastScanned in the demo fixture) so
      // mock mode can also exercise the has_dependents error path — every
      // other seed root deletes cleanly.
      const rootId = (_args?.rootId as string) ?? '';
      if (rootId === 'root-001') {
        return mockContractError(
          'root.has_dependents',
          `root ${rootId} has dependent records and cannot be deleted`,
        );
      }
      mockRoots = mockRoots.filter((r) => r.id !== rootId);
      return null;
    }
    case 'scan_start': {
      return { operationId: 'op-scan-001', kind: 'scan' } satisfies IpcOperationHandle;
    }
    case 'preferences_set': {
      return null;
    }
    case 'tour_complete_step': {
      return null;
    }

    // ---------- First-Run / Batch Commands ----------

    case 'roots_register_batch': {
      // Generated `RegisterSourceBatchResponse` shape is `{ status, items: [{
      // index, status, sourceId, error }] }`.  An earlier mock invented a
      // `{ results: [{ root }] }` shape that `registerRootBatch` could not read,
      // so mock mode produced zero registered roots.  Mirror the real contract.
      const req = (_args?.request as { sources?: Array<{ kind: string; path: string }> }) ?? _args;
      const sources = (req?.sources as Array<{ kind: string; path: string }>) ?? [];
      return {
        status: 'success',
        items: sources.map((_s, i) => ({
          index: i,
          status: 'success',
          sourceId: `src-${i}`,
          error: null,
        })),
      } satisfies RegisterSourceBatchResponse_Serialize;
    }
    case 'firstrun_complete': {
      return { completedAt: new Date().toISOString(), registeredSourceCount: 0 } satisfies FirstRunCompleteResponse;
    }
    case 'firstrun_restart': {
      // Generated `FirstRunRestartResponse` is `{ restartedAt, prefilledSources:
      // RegisterSourceResponse[] }` — mirror it instead of the legacy
      // `{ success, prefilled_sources }` shape.
      return {
        restartedAt: new Date().toISOString(),
        prefilledSources: mockRoots.map((r, i) => ({
          sourceId: `src-${i}`,
          kind: 'light_frames',
          path: r.path,
          createdAt: new Date().toISOString(),
          organizationState: 'unorganized',
        })),
      } satisfies FirstRunRestartResponse;
    }
    case 'firstrun_state': {
      // Generated `FirstRunStateResponse` is `{ completedAt?, lastStep }`.
      return { completedAt: null, lastStep: 'welcome' } satisfies FirstRunStateResponse_Serialize;
    }

    // ── Inbox commands (spec 005 + 039) ───────────────────────────────────────
    case 'inbox_list': {
      // Mock: two roots each with unacknowledged items (SC-001 cross-root).
      // Spec 040 P2a: includes individual master items + real format field.
      return {
        items: [
          {
            inboxItemId: 'item-001',
            groupId: 'item-001',
            groupKey: '',
            rootId: 'root-lights-001',
            rootAbsolutePath: '/astro/raw',
            relativePath: '2025-10-10/NGC7000',
            fileCount: 18,
            lane: 'fits',
            format: 'fits',
            state: 'classified',
            contentSignature: 'sig-abc',
            organizationState: 'unorganized',
            isMaster: false,
          },
          {
            inboxItemId: 'item-002',
            groupId: 'item-002',
            groupKey: '',
            rootId: 'root-lights-001',
            rootAbsolutePath: '/astro/raw',
            relativePath: '2025-10-10/darks',
            fileCount: 46,
            lane: 'fits',
            format: 'fits',
            state: 'pending_classification',
            contentSignature: 'sig-def',
            organizationState: 'unorganized',
            isMaster: false,
          },
          {
            // Individual master item — spec 040 FR-005
            inboxItemId: 'item-master-dark',
            groupId: 'item-master-dark',
            groupKey: '',
            rootId: 'root-lights-001',
            rootAbsolutePath: '/astro/raw',
            relativePath: '2025-10-10/darks/masterDark_Ha_300s.xisf',
            fileCount: 1,
            lane: 'fits',
            format: 'xisf',
            state: 'pending_classification',
            contentSignature: '',
            organizationState: 'unorganized',
            isMaster: true,
            masterFrameType: 'dark',
            masterFilter: 'Ha',
            masterExposureS: 300,
          },
          {
            inboxItemId: 'item-003',
            groupId: 'item-003',
            groupKey: '',
            rootId: 'root-inbox-001',
            rootAbsolutePath: '/astro/inbox',
            relativePath: '2025-11-01/Jupiter',
            fileCount: 3,
            lane: 'video',
            format: 'video',
            state: 'pending_classification',
            contentSignature: 'sig-ghi',
            organizationState: 'unorganized',
            isMaster: false,
          },
        ],
        capped: false,
        limit: 500,
      } satisfies InboxListResponse_Serialize;
    }
    case 'inbox_scan_folder': {
      return {
        rootId: 'root-inbox-001',
        items: [
          {
            inboxItemId: 'item-001',
            relativePath: '2025-10-10/NGC7000',
            fileCount: 18,
            lane: 'fits',
            format: 'fits',
            state: 'classified',
            contentSignature: 'sig-abc',
            isMaster: false,
          },
          {
            inboxItemId: 'item-002',
            relativePath: '2025-10-10/darks',
            fileCount: 46,
            lane: 'fits',
            format: 'fits',
            state: 'pending_classification',
            contentSignature: 'sig-def',
            isMaster: false,
          },
          {
            // Individual master item detected during scan — spec 040 FR-005
            inboxItemId: 'item-master-dark',
            relativePath: '2025-10-10/darks/masterDark_Ha_300s.xisf',
            fileCount: 1,
            lane: 'fits',
            format: 'xisf',
            state: 'pending_classification',
            contentSignature: '',
            isMaster: true,
            masterFrameType: 'dark',
            masterFilter: 'Ha',
            masterExposureS: 300,
          },
        ],
      } satisfies InboxScanFolderResponse_Serialize;
    }
    case 'inbox_classify': {
      const args = _args as { req: { inboxItemId: string } } | undefined;
      const id = args?.req?.inboxItemId ?? 'item-001';
      const isMixed = id === 'item-001';
      return {
        inboxItemId: id,
        type: isMixed ? 'mixed' : 'single_type',
        frameType: isMixed ? undefined : 'dark',
        contentSignature: `sig-${id}`,
        breakdown: isMixed
          ? [
              { kind: 'light', count: 16, destinationPreview: 'NGC7000/Ha/2025-10-10/light/', sampleFiles: ['NGC7000_Ha_001.fits', 'NGC7000_Ha_002.fits'] },
              { kind: 'dark', count: 2, destinationPreview: 'unclassified/2025-10-10/dark/', sampleFiles: ['dark_001.fits'] },
            ]
          : [{ kind: 'dark', count: 50, destinationPreview: 'darks/2025-10-10/dark/', sampleFiles: ['dark_001.fits'] }],
        unclassifiedFiles: isMixed ? ['NGC7000_Ha_mixed.fits'] : [],
        sampleFiles: ['NGC7000_Ha_001.fits'],
        computedAt: new Date().toISOString(),
      } satisfies InboxClassifyResponse_Serialize;
    }
    case 'inbox_confirm': {
      return {
        planId: `plan-${Date.now()}`,
        planState: 'ready_for_review',
        itemsTotal: 18,
        registeredAsMaster: false,
      } satisfies InboxConfirmResponse;
    }
    case 'inbox_reclassify': {
      const args = _args as { req: { inboxItemId: string } } | undefined;
      return {
        inboxItemId: args?.req?.inboxItemId ?? 'item-001',
        updatedType: 'single_type',
        frameType: 'light',
        remainingUnclassified: 0,
        appliedCount: 1,
        breakdown: [],
      } satisfies InboxReclassifyResponse_Serialize;
    }

    // ── Inventory commands (spec 006) ─────────────────────────────────────────
    //
    // Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
    // inventory. `inventory_session_review` (the mock for the removed
    // `inventory.session.review` command) and the `reviewFilter`/`ignored`
    // session filtering were removed along with the review-state machine.

    case 'inventory_list': {
      const { INVENTORY_LIST_RESPONSE } = await import('@/data/fixtures/inventory');
      const req = (_args as { req?: { filters?: unknown } } | undefined)?.req;
      return {
        ...INVENTORY_LIST_RESPONSE,
        requestId: req?.filters ? INVENTORY_LIST_RESPONSE.requestId : INVENTORY_LIST_RESPONSE.requestId,
      };
    }

    // ── Developer diagnostics (spec 021) ─────────────────────────────────────
    //
    // The `dev_*` commands are compile-time gated behind the Rust `dev-tools`
    // feature, so they are absent from the generated `@/bindings` surface in
    // release builds.  These fixtures therefore have no generated type to pin
    // against; the dev UI defines its own local response interfaces.

    case 'dev_contracts_list': {
      return {
        contracts: [
          {
            name: 'sessions_list',
            version: '1.0.0',
            schemaPath: '',
            direction: 'ui-to-core',
            replaySafe: true,
            sensitiveFields: [],
          },
          {
            name: 'settings_update',
            version: '1.0.0',
            schemaPath: '',
            direction: 'ui-to-core',
            replaySafe: false,
            sensitiveFields: [],
          },
        ],
      };
    }

    case 'dev_calls_list': {
      return { calls: [] };
    }

    case 'dev_export': {
      return {
        writtenPath: '/tmp/dev-export.json',
        callCount: 0,
        contractCount: 2,
      };
    }

    case 'dev_schema_get': {
      const req = (_args as { request?: { schemaPath?: string } } | undefined)?.request;
      const path = req?.schemaPath ?? '';
      if (!path) {
        return { found: false };
      }
      // Return a minimal stub schema for any non-empty path.
      return {
        found: true,
        content: JSON.stringify({ '$schema': 'https://json-schema.org/draft/2020-12/schema', title: 'mock-schema', description: `Mock schema for ${path}` }, null, 2),
      };
    }

    case 'preparedview_list': {
      return { views: [] };
    }

    case 'preparedview_remove': {
      return { planId: 'mock-plan-remove-001' };
    }

    case 'preparedview_regenerate': {
      return { planId: 'mock-plan-regen-001', unresolvedItemCount: 0 };
    }

    // spec 012 T008: watcher attach/detach — no real filesystem watching in
    // mock mode; the project drawer's mount/unmount effect still calls these,
    // so they must resolve rather than throw "unknown mock command".
    case 'artifact_watcher_attach':
    case 'artifact_watcher_detach': {
      return null;
    }

    // ── Equipment CRUD (spec 030) ───────────────────────────────────────────

    case 'equipment_cameras_create': {
      const req = (_args as { request?: CreateCamera } | undefined)?.request;
      const camera: Camera = {
        id: `cam-${crypto.randomUUID()}`,
        name: req?.name ?? '',
        aliases: req?.aliases ?? [],
        autoDetected: false,
      };
      mockCameras = [...mockCameras, camera];
      return camera;
    }
    case 'equipment_cameras_update': {
      const req = (_args as { request?: UpdateCamera } | undefined)?.request;
      if (!req) return mockContractError('equipment.not_found', 'camera not found');
      const existing = mockCameras.find((c) => c.id === req.id);
      if (!existing) return mockContractError('equipment.not_found', `camera ${req.id} not found`);
      const updated: Camera = { ...existing, name: req.name, aliases: req.aliases };
      mockCameras = mockCameras.map((c) => (c.id === req.id ? updated : c));
      return updated;
    }
    case 'equipment_cameras_delete': {
      const id = (_args as { id?: string } | undefined)?.id;
      if (!id || !mockCameras.some((c) => c.id === id)) {
        return mockContractError('equipment.not_found', `camera ${id ?? ''} not found`);
      }
      if (mockOpticalTrains.some((t) => t.cameraId === id)) {
        return mockContractError('internal.database', 'FOREIGN KEY constraint failed');
      }
      mockCameras = mockCameras.filter((c) => c.id !== id);
      return null;
    }

    case 'equipment_telescopes_create': {
      const req = (_args as { request?: CreateTelescope } | undefined)?.request;
      const telescope: Telescope = {
        id: `tel-${crypto.randomUUID()}`,
        name: req?.name ?? '',
        aliases: req?.aliases ?? [],
        focalLengthMm: req?.focalLengthMm ?? null,
        autoDetected: false,
      };
      mockTelescopes = [...mockTelescopes, telescope];
      return telescope;
    }
    case 'equipment_telescopes_update': {
      const req = (_args as { request?: UpdateTelescope } | undefined)?.request;
      if (!req) return mockContractError('equipment.not_found', 'telescope not found');
      const existing = mockTelescopes.find((t) => t.id === req.id);
      if (!existing) return mockContractError('equipment.not_found', `telescope ${req.id} not found`);
      const updated: Telescope = {
        ...existing,
        name: req.name,
        aliases: req.aliases,
        focalLengthMm: req.focalLengthMm,
      };
      mockTelescopes = mockTelescopes.map((t) => (t.id === req.id ? updated : t));
      return updated;
    }
    case 'equipment_telescopes_delete': {
      const id = (_args as { id?: string } | undefined)?.id;
      if (!id || !mockTelescopes.some((t) => t.id === id)) {
        return mockContractError('equipment.not_found', `telescope ${id ?? ''} not found`);
      }
      if (mockOpticalTrains.some((t) => t.telescopeId === id)) {
        return mockContractError('internal.database', 'FOREIGN KEY constraint failed');
      }
      mockTelescopes = mockTelescopes.filter((t) => t.id !== id);
      return null;
    }

    case 'equipment_trains_create': {
      const req = (_args as { request?: CreateOpticalTrain } | undefined)?.request;
      const train: OpticalTrain = {
        id: `train-${crypto.randomUUID()}`,
        name: req?.name ?? '',
        telescopeId: req?.telescopeId ?? null,
        cameraId: req?.cameraId ?? null,
        focalLengthMm: req?.focalLengthMm ?? 0,
      };
      mockOpticalTrains = [...mockOpticalTrains, train];
      return train;
    }
    case 'equipment_trains_update': {
      const req = (_args as { request?: UpdateOpticalTrain } | undefined)?.request;
      if (!req) return mockContractError('equipment.not_found', 'optical train not found');
      const existing = mockOpticalTrains.find((t) => t.id === req.id);
      if (!existing) {
        return mockContractError('equipment.not_found', `optical train ${req.id} not found`);
      }
      const updated: OpticalTrain = {
        ...existing,
        name: req.name,
        telescopeId: req.telescopeId,
        cameraId: req.cameraId,
        focalLengthMm: req.focalLengthMm,
      };
      mockOpticalTrains = mockOpticalTrains.map((t) => (t.id === req.id ? updated : t));
      return updated;
    }
    case 'equipment_trains_delete': {
      const id = (_args as { id?: string } | undefined)?.id;
      if (!id || !mockOpticalTrains.some((t) => t.id === id)) {
        return mockContractError('equipment.not_found', `optical train ${id ?? ''} not found`);
      }
      mockOpticalTrains = mockOpticalTrains.filter((t) => t.id !== id);
      return null;
    }

    case 'equipment_filters_create': {
      const req = (_args as { request?: CreateFilter } | undefined)?.request;
      const filter: Filter = {
        id: `filt-${crypto.randomUUID()}`,
        name: req?.name ?? '',
        category: req?.category ?? 'custom',
        autoDetected: false,
      };
      mockFilters = [...mockFilters, filter];
      return filter;
    }
    case 'equipment_filters_update': {
      const req = (_args as { request?: UpdateFilter } | undefined)?.request;
      if (!req) return mockContractError('equipment.not_found', 'filter not found');
      const existing = mockFilters.find((f) => f.id === req.id);
      if (!existing) return mockContractError('equipment.not_found', `filter ${req.id} not found`);
      const updated: Filter = { ...existing, name: req.name, category: req.category };
      mockFilters = mockFilters.map((f) => (f.id === req.id ? updated : f));
      return updated;
    }
    case 'equipment_filters_delete': {
      const id = (_args as { id?: string } | undefined)?.id;
      if (!id || !mockFilters.some((f) => f.id === id)) {
        return mockContractError('equipment.not_found', `filter ${id ?? ''} not found`);
      }
      mockFilters = mockFilters.filter((f) => f.id !== id);
      return null;
    }

    // ── pattern.path_preview (spec 041 per-type destination patterns, P11) ──
    //
    // Mirrors the real resolver's token-substitution + missing-token report
    // for the mock/dev environment. `{token}` names are the v1 registry
    // token names (snake_case); `sampleMetadata` carries the camelCase DTO
    // field names, so PATH_PREVIEW_TOKEN_FIELDS bridges the two. Errors are
    // thrown as full ContractError envelopes (code + message + severity +
    // retryable), matching the real backend, so mock mode exercises the same
    // `errMessage()` catalog-resolution path as production.
    case 'pattern_path_preview': {
      const req = (_args as { request?: { pattern?: string; sampleMetadata?: Record<string, string | null | undefined> } } | undefined)?.request;
      const pattern = req?.pattern ?? '';
      const sample = req?.sampleMetadata ?? {};
      if (pattern.trim() === '') {
        throw {
          code: 'pattern.empty',
          message: 'Pattern is empty.',
          severity: 'blocking',
          retryable: false,
          details: null,
        };
      }
      const missingTokens: string[] = [];
      const segments = pattern
        .split('/')
        .filter((seg) => seg !== '')
        .map((seg) =>
          seg.replace(/\{([^}]*)\}/g, (_match, token: string) => {
            const field = PATH_PREVIEW_TOKEN_FIELDS[token];
            if (!field) {
              // The real resolver rejects unregistered tokens outright.
              throw {
                code: 'token.unknown',
                message: `Unknown token: ${token}`,
                severity: 'blocking',
                retryable: false,
                details: { token },
              };
            }
            const value = sample[field];
            if (value == null || value === '') {
              missingTokens.push(token);
              return PATH_PREVIEW_TOKEN_FALLBACKS[token] ?? token;
            }
            return value;
          }),
        );
      return {
        resolvedPath: segments.join('/'),
        missingTokens,
        warnings: [],
      } satisfies PathPatternPreviewResponse;
    }

    default:
      throw new Error(`Unknown mock command: ${cmd}`);
  }
}
