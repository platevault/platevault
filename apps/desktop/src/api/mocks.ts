// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
  InboxConfirmResponse_Serialize,
  InboxConfirmActionsSummary,
  InboxConfirmDestination,
  InboxOpenPlansResponse,
  InboxOpenPlan,
  InboxPlanAction,
  InboxPlanView,
  InboxApplyAllResponse,
  InboxPlanCancelResponse,
  InboxStatsResponse,
  InboxItemMetadataResponse_Serialize,
  InboxFileMetadata_Serialize,
  PropertyRegistryEntry_Serialize,
  GenerateArchivePlanResult,
  TransitionError_Serialize,
  InboxReclassifyResponse_Serialize,
  InboxReclassifyV2Response_Serialize,
  TargetListItem,
  TargetDetailV3_Serialize,
  TargetSearchResponse_Serialize,
  TargetResolveSimbadResponse_Serialize,
  TargetMoonOppositionBatchRequest,
  TargetMoonOppositionBatchResponse,
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
  ToolPathValidation,
  IpcOperationHandle,
  OperationEvent,
  PlanApplyResponse,
  AuditListResponse_Serialize,
  ArchiveListResponse,
  ArchiveSendToTrashResponse,
  ArchivePermanentlyDeleteResponse,
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
  ProjectNoteGetResult,
  ProjectNoteUpdateResult,
  ManifestListResponse_Serialize,
  PlanSummary_Serialize,
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
  {
    id: 'audit-001',
    timestamp: '2026-05-20T22:15:00Z',
    eventType: 'session.confirmed',
    entityType: 'session',
    entityId: 'ses-001',
    fromState: 'needs_review',
    toState: 'confirmed',
    actor: 'user',
    outcome: 'applied',
    detail: 'User confirmed session',
  },
  {
    id: 'audit-002',
    timestamp: '2026-05-20T22:10:00Z',
    eventType: 'plan.approved',
    entityType: 'plan',
    entityId: 'plan-001',
    fromState: 'ready_for_review',
    toState: 'approved',
    actor: 'user',
    outcome: 'applied',
    detail: 'Plan approved',
  },
  {
    id: 'audit-003',
    timestamp: '2026-05-20T21:45:00Z',
    eventType: 'plan.applied',
    entityType: 'plan',
    entityId: 'plan-001',
    fromState: 'approved',
    toState: 'applied',
    actor: 'system',
    outcome: 'applied',
    detail: 'All 12 items applied',
  },
  {
    id: 'audit-004',
    timestamp: '2026-05-19T23:30:00Z',
    eventType: 'scan.completed',
    entityType: 'root',
    entityId: 'root-001',
    actor: 'system',
    outcome: 'ok',
    detail: 'Discovered 1,247 files in 4.2s',
  },
  {
    id: 'audit-005',
    timestamp: '2026-05-19T23:25:00Z',
    eventType: 'scan.started',
    entityType: 'root',
    entityId: 'root-001',
    actor: 'user',
    outcome: 'ok',
    detail: 'Manual scan triggered',
  },
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
function filterMockAuditEntries(
  filters: AuditFilterDto | null | undefined,
): AuditEntry[] {
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
  return [...result].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

const mockSettingsData: SettingsData = {
  scope: 'general',
  values: {
    naming_pattern:
      '{target}/{date}/{filter}/{target}_{filter}_{sequence}.fits',
    default_source_view_strategy: 'symlink',
    calibration_age_warning_days: 90,
  },
};

// ── `observing`-scope settings (spec 044 Track B + spec 047) — scope-aware ─────
//
// The planner's observing-site gate (`features/targets/site-gate.ts` →
// `activeSite() !== null`) hydrates the site store from
// `settings_get('observing')` (`observing-sites/site-store.ts`), and the usable
// altitude threshold (`altitude-settings.ts`) reads the same scope. To let
// mock-mode exercise BOTH planner states — the no-site "set up your observing
// site" prompt (spec 047 D7 / edge case) AND the with-site astronomy render —
// this scope reflects a per-session values bag seeded from the
// `pv-e2e-observing` localStorage key (set by a test before navigation):
//
//   - key ABSENT  → empty observing values → no active site → planner GATED.
//   - key PRESENT → seeded sites + active pointer → `activeSite() !== null` →
//                   planner renders real 044 (altitude/imaging-time) + 047
//                   (moon phase / lunar separation / filter guidance /
//                   opposition) values against that site.
//
// `settings_update('observing', …)` merges into the same bag so a UI-driven
// site creation (Settings → Observing Sites) round-trips like the real backend.
// Non-observing scopes are untouched and still resolve to `mockSettingsData`.
const E2E_OBSERVING_SEED_STORE_ID = 'pv-e2e-observing';
let mockObservingValues: Record<string, unknown> | null = null;

function observingValues(): Record<string, unknown> {
  if (mockObservingValues === null) {
    let seeded: Record<string, unknown> = {};
    try {
      const raw =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(E2E_OBSERVING_SEED_STORE_ID)
          : null;
      if (raw) seeded = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      seeded = {};
    }
    mockObservingValues = seeded;
  }
  return mockObservingValues;
}

// Mutable so `settings_update('cleanup', { cleanupTypeOverrides })` round-trips
// through `settings_get('cleanup')` in mock mode (spec 051 US3) — the
// per-type cleanup action table now persists via this database-backed
// setting instead of `localStorage`, so its mock-mode round-trip must mirror
// real persistence the same way `mockIngestionSettings` does below.
let mockCleanupTypeOverrides: Record<string, string> = {};

// Mutable so `settings_update('framing', …)` round-trips through
// `settings_get('framing')` in mock mode (spec 008 Q27 F-Framing-11) —
// the Settings → Framing pane's four tunables need a real persisted bag to
// prove auto-save actually sticks. Seeded at the R11a shipped defaults
// (mirrors `domain_core::settings::SettingsState::default()`).
let mockFramingSettings: Record<string, unknown> = {
  framingPointingFractionOfFov: 0.1,
  framingPointingFallbackDeg: 0.2,
  framingRotationToleranceDeg: 3.0,
  framingMosaicEnvelopeFractionOfFov: 1.0,
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
//
// Mutable so `calibration_tolerances_update` round-trips through `_get` in mock
// mode (mirrors `persistence_db::repositories::calibration_tolerances`'s
// upsert-then-return): the Calibration-matching settings pane's edited
// tolerance survives a component remount, exactly like the real singleton row.
// (Module state resets per page context, so tests stay isolated.)
let mockCalibrationTolerances: CalibrationTolerances = {
  temperatureToleranceC: 5.0,
  exposureToleranceS: 2.0,
  agingLimitDays: 365,
  requireSameCamera: true,
  requireSameGain: true,
  requireSameBinning: true,
  requireSameOffset: true,
};

let mockRoots: LibraryRoot[] = [
  {
    id: 'root-001',
    path: '/astro/raw',
    category: 'raw',
    online: true,
    fileCount: 1247,
    lastScanned: '2026-05-19T23:30:00Z',
    active: true,
  },
  {
    id: 'root-002',
    path: '/astro/calibration',
    category: 'calibration',
    online: true,
    fileCount: 342,
    lastScanned: '2026-05-19T23:30:00Z',
    active: true,
  },
  {
    id: 'root-003',
    path: '/astro/projects',
    category: 'project',
    online: true,
    fileCount: 856,
    lastScanned: '2026-05-18T20:00:00Z',
    active: true,
  },
];

const mockEquipment: Equipment[] = [
  {
    id: 'eq-001',
    name: 'ASI2600MM Pro',
    kind: 'camera',
    aliases: ['ZWO ASI2600MM'],
  },
  {
    id: 'eq-002',
    name: 'Esprit 100ED',
    kind: 'telescope',
    aliases: ['SW Esprit 100ED'],
  },
  { id: 'eq-003', name: 'EQ6-R Pro', kind: 'mount', aliases: ['EQ6R'] },
];

// ── Equipment CRUD (spec 030) ────────────────────────────────────────────────
//
// Mutable in-memory stores so mock mode's add/edit/delete flows behave like
// the real backend across a session (previously `@/data/fixtures/settings`,
// which the Equipment pane held in local `useState` and never persisted
// through an IPC round-trip). Seed data replaces those retired fixtures.

let mockCameras: Camera[] = [
  {
    id: 'cam-001',
    name: 'ASI2600MM Pro',
    aliases: ['ZWO ASI2600MM'],
    autoDetected: false,
    sensorType: 'mono',
    passband: null,
  },
  {
    id: 'cam-002',
    name: 'ASI533MC Pro',
    aliases: ['ZWO ASI533MC'],
    autoDetected: false,
    sensorType: 'osc',
    passband: null,
  },
];

// Target favourites (spec 051 US2): id → favourited-at timestamp, mirroring
// the real `target_favourite` table's shape (row presence = favourited).
const mockFavourites = new Map<string, string>();

let mockTelescopes: Telescope[] = [
  {
    id: 'tel-001',
    name: 'Takahashi FSQ-106EDX4',
    aliases: [],
    focalLengthMm: 530,
    autoDetected: false,
  },
  {
    id: 'tel-002',
    name: 'William Optics GT81',
    aliases: [],
    focalLengthMm: 478,
    autoDetected: false,
  },
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
  detailDock: {},
};

// Review items are loaded from the wireframe-aligned fixture file (review.queue case below).

const mockSearchResults: SearchResult[] = [
  {
    id: 'ses-001',
    kind: 'session',
    label: 'M31 L 2026-05-18',
    sublabel: '120 frames',
    route: '/sessions/ses-001',
    score: 0.95,
  },
  {
    id: 'target-001',
    kind: 'target',
    label: 'M31 - Andromeda Galaxy',
    sublabel: '5 sessions',
    route: '/targets/target-001',
    score: 0.9,
  },
  {
    id: 'proj-001',
    kind: 'project',
    label: 'M31 LRGB',
    sublabel: 'Processing',
    route: '/projects/proj-001',
    score: 0.85,
  },
  {
    id: 'nav-sessions',
    kind: 'page',
    label: 'Sessions',
    sublabel: 'Browse all sessions',
    route: '/sessions',
    score: 0.5,
  },
];

const mockCalendarData: CalendarData = {
  months: [
    {
      year: 2026,
      month: 5,
      days: [
        { day: 18, sessions: [{ id: 'ses-001', target: 'M31', filter: 'L' }] },
        {
          day: 19,
          sessions: [
            { id: 'ses-003', target: 'M31', filter: 'R' },
            { id: 'ses-004', target: 'M31', filter: 'G' },
          ],
        },
        {
          day: 20,
          sessions: [{ id: 'ses-005', target: 'NGC 7000', filter: 'Ha' }],
        },
      ],
    },
  ],
};

const mockMasterDetail: MasterDetail = {
  id: 'master-001',
  kind: 'dark',
  fingerprint: {
    camera: 'ASI2600MM',
    sensorMode: 'normal',
    exposureS: 300,
    tempC: -10,
    gain: 100,
    binning: '1x1',
  },
  sourceSessionId: 'cal-ses-001',
  createdAt: '2026-05-15T20:00:00Z',
  ageDays: 9,
  sizeBytes: 52_428_800,
  usedBySessionIds: ['ses-001', 'ses-003'],
  usedByProjectIds: ['proj-001'],
  compatibleSessions: [
    { sessionId: 'ses-001', score: 0.97, softMismatches: [] },
  ],
  usageStats: { sessionCount: 2, projectCount: 1 },
};

const mockMatchCandidates: MatchCandidate[] = [
  { masterId: 'master-001', kind: 'dark', score: 0.97, softMismatches: [] },
  {
    masterId: 'master-002',
    kind: 'flat',
    score: 0.92,
    filter: 'L',
    softMismatches: ['age > 60 days'],
  },
  { masterId: 'master-003', kind: 'bias', score: 0.99, softMismatches: [] },
];

/**
 * `calibration.match.suggest` / `.suggest.batch` fixtures (spec P9).
 *
 * The second candidate deliberately omits every session-context field to
 * exercise the real-app "—" fallback (no canonical target link / no
 * fingerprint row) alongside the first candidate's fully-resolved context.
 */
function mockCalibrationMatches(
  sessionId: string,
): CalibrationMatchDto_Serialize[] {
  return [
    {
      sessionId,
      masterId: 'master-001',
      calibrationType: 'dark',
      confidence: 0.97,
      dimensionsMatched: [
        {
          dimension: 'gain',
          observed: { value: 100 },
          reference: { value: 100 },
        },
        {
          dimension: 'offset',
          observed: { value: 10 },
          reference: { value: 10 },
        },
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
      dimensionsMatched: [
        {
          dimension: 'gain',
          observed: { value: 100 },
          reference: { value: 100 },
        },
      ],
      dimensionsMismatched: [
        { dimension: 'temperature', reason: 'out_of_tolerance', delta: 3.5 },
      ],
      selectionReason: 'compatible_fallback',
      // Unresolved session context — every P9 field stays absent.
    },
  ];
}

// ── Inbox plan surface (spec 041) — stateful mock ─────────────────────────────
//
// `inbox_plan_list_open` previously had no case, so `useOpenInboxPlans` always
// resolved to `[]` and the top-bar "Review plans" overlay was unreachable in
// mock mode. These seed plans make the overlay reachable AND make the
// move-vs-catalogue-in-place distinction observable at the plan-review layer
// (spec 041 FR-017/FR-018/SC-007):
//   plan-move-002     → every action is a `move` (unorganized source relocates
//                       into the library) → PlanPanel renders "→ <dest>".
//   plan-inplace-org  → every action is a `catalogue` (toPath == fromPath;
//                       already-organized source, no file moves) → PlanPanel
//                       renders the "In place · <folder>" label.
// Apply/cancel MUTATE this array (removing the applied/cancelled plan) so the
// aggregate surface refresh + auto-close behaviour round-trips like the backend.
//
// Shapes are pinned to the generated bindings (`InboxOpenPlan`/`InboxPlanAction`)
// so a contract change the mock fails to mirror is a compile error.

/** A `move` action: source relocates to a distinct destination path. */
function mockMoveAction(index: number, file: string): InboxPlanAction {
  return {
    index,
    action: 'move',
    fromPath: `/astro/raw/2025-10-10/darks/${file}`,
    toPath: `/astro/library/darks/2025-10-10/${file}`,
    destinationPreview: 'library/darks/2025-10-10/',
    requiresDestructiveConfirm: false,
  };
}

/** A `catalogue` action: file stays put (toPath == fromPath), no move. */
function mockCatalogueAction(index: number, file: string): InboxPlanAction {
  const path = `/astro/library/NGC7000/${file}`;
  return {
    index,
    action: 'catalogue',
    fromPath: path,
    toPath: path,
    destinationPreview: 'library/NGC7000/',
    requiresDestructiveConfirm: false,
  };
}

function seedInboxOpenPlans(): InboxOpenPlan[] {
  return [
    {
      inboxItemId: 'item-002',
      itemName: '2025-10-10/darks',
      planId: 'plan-move-002',
      state: 'plan_open',
      stale: false,
      actions: [
        mockMoveAction(1, 'dark_001.fits'),
        mockMoveAction(2, 'dark_002.fits'),
      ],
    },
    {
      inboxItemId: 'item-organized-inplace',
      itemName: 'Library/NGC7000',
      planId: 'plan-inplace-org',
      state: 'plan_open',
      stale: false,
      actions: [
        mockCatalogueAction(1, 'NGC7000_Ha_001.fits'),
        mockCatalogueAction(2, 'NGC7000_Ha_002.fits'),
      ],
    },
  ];
}

let mockInboxOpenPlans: InboxOpenPlan[] = seedInboxOpenPlans();

/**
 * Inbox item ids whose source is already ORGANIZED — `inbox_confirm` produces a
 * catalogue-in-place result (zero moves) for these, and a move plan otherwise
 * (spec 041 US4 FR-017/FR-018). Mirrors the backend's per-source
 * `organization_state` branch. `item-organized-inplace` is the seed plan's item;
 * confirming it (or any id here) yields the catalogue-in-place shape.
 */
const MOCK_ORGANIZED_ITEM_IDS = new Set<string>(['item-organized-inplace']);

/** Plan-required lifecycle edges (mirrors `lifecycle-actions.ts` `requiresPlan`). */
const MOCK_PLAN_REQUIRED_EDGES = new Set<string>([
  'ready→prepared',
  'prepared→ready',
  'completed→archived',
  'blocked→archived',
  'archived→ready',
  'archived→processing',
]);

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
      // The real `sessions.list` returns the camelCase SessionSummaryDto shape.
      // The legacy fixture is snake_case (read by SessionsTable); the shared
      // SessionSourcePicker reads the camelCase fields. Carry BOTH so either
      // consumer renders in mock mode (previously the picker crashed on
      // `session.sessionKey.target` when the Edit/wizard source step rendered).
      return sessions.map((s) => ({
        ...s,
        sessionKey: {
          target: s.session_key.target,
          filter: s.session_key.filter,
          night: s.session_key.night,
        },
        frameCount: s.frame_count,
        totalIntegrationSeconds: s.total_integration_seconds,
        opticalTrainId: s.optical_train_id,
      }));
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
      const req = (
        _args as
          | { req?: { requestId?: string; sessionId?: string } }
          | undefined
      )?.req;
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
      const req = (
        _args as
          | { req?: { requestId?: string; sessionIds?: string[] } }
          | undefined
      )?.req;
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
        {
          id: 'tgt-m31',
          effectiveLabel: 'M 31',
          primaryDesignation: 'M 31',
          objectType: 'galaxy',
          raDeg: 10.6847,
          decDeg: 41.269,
          constellation: 'Andromeda',
          magnitude: 3.44,
          aliases: ['M 31', 'NGC 224', 'Andromeda Galaxy'],
        },
        {
          id: 'tgt-ngc7000',
          effectiveLabel: 'NGC 7000',
          primaryDesignation: 'NGC 7000',
          objectType: 'emission_nebula',
          raDeg: 314.75,
          decDeg: 44.52,
          constellation: 'Cygnus',
          magnitude: 4.0,
          aliases: ['NGC 7000', 'North America Nebula'],
        },
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
    case 'target_favourites_list': {
      return { targetIds: [...mockFavourites.keys()] };
    }
    case 'target_favourites_add': {
      const req = (_args as { req?: { targetId?: string } } | undefined)?.req;
      const targetId = req?.targetId ?? '';
      const favouritedAt =
        mockFavourites.get(targetId) ?? new Date().toISOString();
      mockFavourites.set(targetId, favouritedAt);
      return { targetId, favouritedAt };
    }
    case 'target_favourites_remove': {
      const req = (_args as { req?: { targetId?: string } } | undefined)?.req;
      const targetId = req?.targetId ?? '';
      mockFavourites.delete(targetId);
      return { targetId };
    }
    case 'target_moon_opposition_batch': {
      // #634: mock mode reuses the SAME TS ephemeris (`astro/moon-state.ts` +
      // `astro/lunar-separation.ts` + `astro/opposition.ts`) the detail panel
      // (`TargetDetailV2`'s Best-date tooltip, still TS per ADR-0001's
      // interactive-ephemeris boundary) computes independently — a
      // hand-rolled placeholder here would diverge from the detail panel's
      // value and break the "list Opposition == detail Best date" mock-mode
      // regression guard (e2e 9.5c). This mirrors what the real Rust command
      // approximates (both derive the same physical quantity); it is NOT the
      // real backend, only its mock-mode stand-in.
      const [{ moonStateAt }, { lunarSeparationDeg }, { nextOpposition }] =
        await Promise.all([
          import('@/features/targets/astro/moon-state'),
          import('@/features/targets/astro/lunar-separation'),
          import('@/features/targets/astro/opposition'),
        ]);
      const req = (
        _args as { req?: TargetMoonOppositionBatchRequest } | undefined
      )?.req;
      const at = req?.at ? new Date(req.at) : new Date();
      const targets = req?.targets ?? [];
      const { moonVec } = moonStateAt(at);
      return {
        results: targets.map((t) => {
          if (
            t.raDeg == null ||
            t.decDeg == null ||
            !Number.isFinite(t.raDeg) ||
            !Number.isFinite(t.decDeg)
          ) {
            return { id: t.id, moonSeparationDeg: null, opposition: null };
          }
          const moonSeparationDeg = lunarSeparationDeg(
            t.raDeg,
            t.decDeg,
            moonVec,
          );
          const opposition = nextOpposition(t.raDeg, at);
          return {
            id: t.id,
            moonSeparationDeg,
            opposition: opposition
              ? {
                  date: opposition.date.toISOString(),
                  daysUntil: opposition.daysUntil,
                }
              : null,
          };
        }),
      } satisfies TargetMoonOppositionBatchResponse;
    }
    case 'target_search': {
      const req = (_args as { req?: { query?: string } } | undefined)?.req;
      const q = (req?.query ?? '').toLowerCase();
      const allSuggestions = [
        {
          targetId: 'tgt-m31',
          primaryDesignation: 'M 31',
          commonName: 'Andromeda Galaxy',
          objectType: 'galaxy',
          matchedAlias: 'Andromeda',
          source: 'seed',
        },
        {
          targetId: 'tgt-ngc7000',
          primaryDesignation: 'NGC 7000',
          commonName: null,
          objectType: 'emission_nebula',
          matchedAlias: 'North America Nebula',
          source: 'seed',
        },
      ] satisfies TargetSearchResponse_Serialize['suggestions'];
      const suggestions = q
        ? allSuggestions.filter(
            (s) =>
              s.primaryDesignation.toLowerCase().includes(q) ||
              (s.commonName?.toLowerCase().includes(q) ?? false) ||
              (s.matchedAlias?.toLowerCase().includes(q) ?? false),
          )
        : allSuggestions;
      return {
        contractVersion: '1.0',
        requestId: crypto.randomUUID(),
        suggestions,
        // Mock mode never warms a real resolve cache — always settled.
        cacheWarming: false,
      } satisfies TargetSearchResponse_Serialize;
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
      // spec 008 real shape: ProjectDetailDto. Arg-sensitive so the detail's
      // lifecycle matches the requested project (mirrors the real backend,
      // which returns each project's actual lifecycle) — this is what lets the
      // full lifecycle state machine (ready/prepared/completed/archived/blocked)
      // be exercised through the UI, not just proj-001's `processing`.
      const { mockProjectDetailFor } = await import('@/data/fixtures/projects');
      const id = (_args as { id?: string } | undefined)?.id ?? 'proj-001';
      return mockProjectDetailFor(id);
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
        sourceAdded: {
          inventoryId: 'mock-inv',
          name: '',
          frames: 0,
          filter: '',
          exposure: '',
          linkedAt: new Date().toISOString(),
        },
        channels: [],
        auditId: 'mock-audit-id',
        linkedAt: new Date().toISOString(),
      } satisfies ProjectSourceAddResult_Serialize;
    }
    case 'projects_source_remove': {
      const req = (
        _args as
          | {
              req?: {
                projectId?: string;
                projectSourceId?: string;
                confirmLastSource?: boolean;
              };
            }
          | undefined
      )?.req;
      // FR-011 last-confirmed-source guard: the backend refuses removing the
      // final confirmed source unless the caller re-confirms
      // (`confirm_last_source`). The mock surfaces the exact error contract by
      // requiring the flag on every removal, so the inline confirm guard flow
      // in EditProjectPane is exercisable in mock mode. Real per-source-count
      // discrimination is a Layer-2 concern (needs stateful backend fixtures).
      if (!req?.confirmLastSource) {
        return mockContractError(
          'lifecycle.last_confirmed_source',
          'Cannot remove the last confirmed source without confirmation.',
        );
      }
      return {
        projectId: req?.projectId ?? 'mock-id',
        removedSourceId: req?.projectSourceId ?? 'mock-src',
        auditId: 'mock-audit-id',
      } satisfies ProjectSourceRemoveResult_Serialize;
    }
    case 'note_get': {
      // spec 024 `project.note.get` — persisted free-text notes body.
      const projectId =
        (_args as { req?: { projectId?: string } } | undefined)?.req
          ?.projectId ?? 'proj-001';
      return {
        projectId,
        content:
          'SHO palette — Ha dominant. Review OIII stretch before integration.',
      } satisfies ProjectNoteGetResult;
    }
    case 'note_update': {
      // spec 024 `project.note.update` — echoes an updated timestamp on success.
      const projectId =
        (_args as { req?: { projectId?: string } } | undefined)?.req
          ?.projectId ?? 'proj-001';
      return {
        projectId,
        updatedAt: new Date().toISOString(),
      } satisfies ProjectNoteUpdateResult;
    }
    case 'manifest_list': {
      // spec 024 `project.manifest.list` — snapshot history. hasBody:false so
      // the accordion renders rows without an expandable body fetch.
      return {
        manifests: [
          {
            id: 'man-001',
            reason: 'created',
            timestamp: '2026-05-01T10:00:00Z',
            path: 'notes/manifest-2026-05-01.md',
            hasBody: false,
          },
          {
            id: 'man-002',
            reason: 'lifecycle_transition',
            timestamp: '2026-05-20T22:15:00Z',
            path: 'notes/manifest-2026-05-20.md',
            hasBody: false,
          },
        ],
        nextCursor: null,
      } satisfies ManifestListResponse_Serialize;
    }
    case 'manifest_reveal_in_os': {
      return null;
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
      // Spec 026 T019 mock coverage: `ViewAuditHistory` is `plans.list`'s
      // first real mock-mode consumer, and it always requests these two
      // origins — synthesize the view-scoped removal/regeneration history
      // for the T014/T016 mock stale view rather than growing the shared
      // static fixture below (which several other Playwright specs already
      // depend on for its exact plan count/rows).
      const listArgs = _args as { originFilter?: string[] | null } | undefined;
      if (
        listArgs?.originFilter?.includes('prepared_view_removal') ||
        listArgs?.originFilter?.includes('prepared_view_regeneration')
      ) {
        const historyPlans: PlanSummary_Serialize[] = [
          {
            id: 'mock-sv-plan-removal-1',
            number: 901,
            title: 'Remove source view mock-sv-view-stale',
            origin: 'prepared_view_removal',
            originPath: 'mock-sv-view-stale',
            state: 'applied',
            planType: 'source_view_removal',
            destructiveDestination: 'archive',
            itemsTotal: 1,
            itemsApplied: 1,
            itemsFailed: 0,
            itemsSkipped: 0,
            itemsCancelled: 0,
            itemsPending: 0,
            totalBytesRequired: 0,
            createdAt: '2026-05-20T09:00:00Z',
          },
          {
            id: 'mock-sv-plan-regen-1',
            number: 902,
            title: 'Regenerate source view mock-sv-view-stale',
            origin: 'prepared_view_regeneration',
            originPath: 'mock-sv-view-stale',
            state: 'partially_applied',
            planType: 'source_view_regeneration',
            destructiveDestination: 'archive',
            itemsTotal: 2,
            itemsApplied: 1,
            itemsFailed: 1,
            itemsSkipped: 0,
            itemsCancelled: 0,
            itemsPending: 0,
            totalBytesRequired: 0,
            createdAt: '2026-05-20T10:00:00Z',
          },
        ];
        return { plans: historyPlans };
      }
      // Pre-existing static fixture. NOTE: this branch returns the bare
      // `FilesystemPlan[]` array, not `{ plans: [...] }` (the real
      // `PlanListResponse_Serialize` shape) — a latent mismatch that
      // predates T019 and has gone unnoticed because nothing previously
      // consumed `plans.list` in mock mode. Left as-is (out of this lane's
      // scope to fix retroactively for the fixture's other, untested
      // fields) since the new origin-filtered branch above is what T019
      // actually exercises.
      const { plans } = await import('@/data/fixtures/plans');
      return plans;
    }
    case 'plans_get': {
      const { planDetail } = await import('@/data/fixtures/plans');
      return planDetail;
    }
    case 'plans_free_space_estimate': {
      // Issue #876: advisory destination free-space estimate. Mock mode has
      // no real filesystem to probe — report comfortably more free space
      // than the fixture plan requires so the mock UI shows the healthy
      // (non-warning) state by default.
      const { planDetail } = await import('@/data/fixtures/plans');
      return {
        requiredBytes: planDetail.totalBytesRequired,
        availableBytes: planDetail.totalBytesRequired + 10_000_000_000,
      };
    }
    case 'audit_list': {
      const args = _args as
        | {
            filters?: AuditFilterDto | null;
            pagination?: AuditPaginationDto | null;
          }
        | undefined;
      const filtered = filterMockAuditEntries(args?.filters);
      const offset = args?.pagination?.offset ?? 0;
      const limit = args?.pagination?.limit ?? filtered.length;
      const page = filtered.slice(offset, offset + limit);
      return {
        entries: page,
        total: filtered.length,
      } satisfies AuditListResponse_Serialize;
    }
    case 'audit_export': {
      const args = _args as { filters?: AuditFilterDto | null } | undefined;
      const filtered = filterMockAuditEntries(args?.filters);
      return filtered.map((e) => JSON.stringify(e)).join('\n');
    }

    // ── Archive commands (spec 017 WP-B) ──────────────────────────────────────
    case 'archive_list': {
      return {
        entries: [
          {
            id: 'arch-proj-001',
            name: 'NGC 7000 · HOO (v1)',
            entityType: 'project',
            archivedAt: '2026-05-12T21:40:00Z',
            reason: 'Superseded by reprocess',
            originalPath: 'Projects/NGC7000_HOO_v1',
            sizeBytes: 12_400_000_000,
            archivedViaPlanId: 'plan-archive-001',
          },
          {
            id: 'arch-proj-002',
            name: 'M31 · LRGB (2025)',
            entityType: 'project',
            archivedAt: '2026-03-02T19:05:00Z',
            reason: 'Completed and delivered',
            originalPath: 'Projects/M31_LRGB_2025',
            sizeBytes: 8_100_000_000,
            archivedViaPlanId: 'plan-archive-002',
          },
        ],
      } satisfies ArchiveListResponse;
    }
    case 'archive_send_to_trash': {
      const args = _args as { planId?: string } | undefined;
      return {
        planId: args?.planId ?? 'plan-archive-001',
        itemsMoved: 3,
        auditId: 'audit-archive-trash-001',
      } satisfies ArchiveSendToTrashResponse;
    }
    case 'archive_permanently_delete': {
      const args = _args as { planId?: string } | undefined;
      return {
        planId: args?.planId ?? 'plan-archive-001',
        itemsDeleted: 3,
        auditId: 'audit-archive-delete-001',
      } satisfies ArchivePermanentlyDeleteResponse;
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
      const args = _args as
        | { requestId?: string; filePath?: string }
        | undefined;
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
      // Scope-aware: the `observing` scope reflects the seedable per-session
      // values bag (planner site gate + usable-altitude threshold). Every other
      // scope keeps the legacy general fixture (unchanged behaviour).
      const scope = (_args as { scope?: string } | undefined)?.scope;
      if (scope === 'observing') {
        return {
          scope: 'observing',
          values: observingValues(),
        } satisfies SettingsData;
      }
      if (scope === 'cleanup') {
        return {
          scope: 'cleanup',
          values: { cleanupTypeOverrides: mockCleanupTypeOverrides },
        } satisfies SettingsData;
      }
      if (scope === 'framing') {
        return {
          scope: 'framing',
          values: mockFramingSettings,
        } satisfies SettingsData;
      }
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
      // Arg-sensitive: a plan-required edge (e.g. completed → archived) returns
      // `status: 'error'` with `error.code: 'plan.required'`, mirroring the
      // backend — the UI then routes to the plan-create flow (and, for
      // → archived, calls `archive_plan_generate`). Non-plan edges (e.g.
      // processing → completed) succeed immediately. The request is the
      // canonical FLAT discriminated envelope (issue #423): `nextState` sits
      // beside the `entityType` tag — no `{ project: {...} }` wrapper.
      const req = (
        _args as
          | {
              request?: {
                nextState?: string;
                currentState?: string;
                entityId?: string;
              };
            }
          | undefined
      )?.request;
      const prior = req?.currentState ?? 'processing';
      const next = req?.nextState ?? 'completed';
      if (MOCK_PLAN_REQUIRED_EDGES.has(`${prior}→${next}`)) {
        return {
          status: 'error',
          contractVersion: '2.0.0',
          requestId: crypto.randomUUID(),
          error: {
            code: 'plan.required',
            message: `Transition ${prior} → ${next} requires an approved plan.`,
            details: null,
          } satisfies TransitionError_Serialize,
        } satisfies TransitionResponse_Serialize;
      }
      return {
        status: 'success',
        contractVersion: '2.0.0',
        requestId: crypto.randomUUID(),
        appliedAt: new Date().toISOString(),
        priorState: prior,
        newState: next,
        auditId: 'mock-audit-transition',
      } satisfies TransitionResponse_Serialize;
    }

    case 'archive_plan_generate': {
      // `archive.plan.generate` — whole-project reviewable archive plan (spec
      // 017 / constitution II: created in `ready_for_review`, never
      // auto-applied). Previously ABSENT from the mock switch, so the
      // completed → archived archive flow dead-ended after the plan.required
      // toast. One protected item so the spec-016 acknowledge gate is exercised.
      return {
        planId: 'plan-archive-mock',
        itemCount: 4,
        protectedItemCount: 1,
      } satisfies GenerateArchivePlanResult;
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
      // Real contract shape (PlanApproveResponse): the overlay consumes
      // `approvalToken` and hands it to `plans_apply_real`.
      const planId = (_args as { id?: string } | undefined)?.id ?? 'mock-plan';
      return {
        planId,
        newState: 'approved',
        approvalToken: `tok-${planId}-mock`,
        approvedAt: new Date().toISOString(),
      };
    }
    case 'plan_protection_check_cmd': {
      // One protected item so the spec-016 gate is exercised in mock mode.
      const planId =
        (_args as { planId?: string } | undefined)?.planId ?? 'mock-plan';
      return {
        planId,
        hasProtectedItems: true,
        protectedItems: [
          {
            itemId: `${planId}-item-0`,
            sourceId: 'mock-project-1',
            level: 'protected',
            reason:
              'Default protection level is protected; no per-source override.',
            matchedCategories: ['masters'],
            originalAction: 'archive',
            rewrittenAction: null,
          },
        ],
        nonBlockingSummary: { normalCount: 2, unprotectedCount: 0 },
      };
    }
    case 'protection_plan_acknowledged': {
      return 'mock-audit-ack';
    }
    case 'plans_confirm_destructive': {
      // FR-003/D9/issue #741: persists `destructive_confirmed` so the
      // review overlay's destructive-confirm gate unlocks Approve & apply.
      const planId =
        (_args as { planId?: string } | undefined)?.planId ?? 'mock-plan';
      return { planId, itemsConfirmed: 1 };
    }
    case 'cleanup_scan': {
      // D11 step 1: pure read-only preview. Reason strings follow the backend
      // generator format (see cleanup_generator.rs::scan_with_policy).
      const projectId =
        (_args as { projectId?: string } | undefined)?.projectId ??
        'mock-project-1';
      return {
        projectId,
        candidates: [
          {
            filePath: 'processing/calibrated/Ha_300s_c_0001.xisf',
            dataType: 'intermediate',
            sizeBytes: 268_435_456,
            reason:
              'intermediate artifact (classified by rule, 90% confidence); protection: normal; policy: archive',
          },
          {
            filePath: 'processing/calibrated/Ha_300s_c_0002.xisf',
            dataType: 'intermediate',
            sizeBytes: 268_435_456,
            reason:
              'intermediate artifact (classified by rule, 90% confidence); protection: normal; policy: archive',
          },
          {
            filePath: 'masters/master_dark_300s.xisf',
            dataType: 'master',
            sizeBytes: 536_870_912,
            reason:
              'master artifact (classified by rule, 95% confidence); protection: protected; policy: archive',
          },
        ],
        totalReclaimableBytes: 1_073_741_824,
      };
    }
    case 'cleanup_plan_generate': {
      return {
        planId: 'plan-cleanup-mock',
        itemCount: 3,
        protectedItemCount: 1,
      };
    }
    case 'plans_apply_real': {
      // Spec 042 US16 (T240): drive the live long-op channel if a subscriber
      // passed one. `onEvent` is a real `Channel<OperationEvent>` in mock mode;
      // pushing through `onmessage` mirrors the backend's Started → per-item →
      // Completed lifecycle so UI/tests can exercise streaming without a backend.
      const channel = (
        _args as { onEvent?: { onmessage?: (e: OperationEvent) => void } }
      )?.onEvent;
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
          push(
            mk(0, 'item_started', {
              runId: opId,
              itemsTotal: 1,
              at: '1970-01-01T00:00:00Z',
            }),
          );
          push(
            mk(1, 'item_applied', {
              runId: opId,
              itemId: 'item-0',
              newState: 'succeeded',
            }),
          );
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
      const applyPlanId =
        (_args as { planId?: string } | undefined)?.planId ?? 'mock-plan';
      return {
        planId: applyPlanId,
        runId: 'op-mock-001',
        newState: 'applied',
      } satisfies PlanApplyResponse;
    }
    case 'plans_discard': {
      return null;
    }
    case 'settings_update': {
      // The `observing` scope round-trips into the seedable values bag so a
      // UI-driven site creation / active-site switch persists across the
      // session (site store + altitude threshold both read this scope back).
      const scope = (_args as { scope?: string } | undefined)?.scope;
      if (scope === 'observing') {
        const values = (
          _args as { values?: Record<string, unknown> } | undefined
        )?.values;
        if (values) mockObservingValues = { ...observingValues(), ...values };
      }
      if (scope === 'cleanup') {
        const values = (
          _args as { values?: Record<string, unknown> } | undefined
        )?.values;
        const overrides = values?.cleanupTypeOverrides;
        if (overrides && typeof overrides === 'object') {
          mockCleanupTypeOverrides = {
            ...(overrides as Record<string, string>),
          };
        }
      }
      if (scope === 'framing') {
        const values = (
          _args as { values?: Record<string, unknown> } | undefined
        )?.values;
        if (values) mockFramingSettings = { ...mockFramingSettings, ...values };
      }
      return null;
    }
    case 'ingestion_settings_update': {
      const req = (_args as { request?: UpdateIngestionSettings } | undefined)
        ?.request;
      if (req) {
        mockIngestionSettings = { ...req };
      }
      return mockIngestionSettings;
    }
    case 'calibration_tolerances_update': {
      // Persist then return, mirroring the real `calibration.tolerances.update`
      // command's upsert-then-return behaviour (persistence_db::repositories::
      // calibration_tolerances::update). Storing back into the singleton makes a
      // later `calibration_tolerances_get` observe the edit (round-trip seam).
      const req = (_args as { request?: CalibrationTolerances } | undefined)
        ?.request;
      mockCalibrationTolerances = { ...mockCalibrationTolerances, ...req };
      return mockCalibrationTolerances satisfies CalibrationTolerances;
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
      const originalPath =
        mockRoots.find((r) => r.id === rootId)?.path ?? '/old/path';
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
      mockRoots = mockRoots.map((r) =>
        r.id === rootId ? { ...r, active } : r,
      );
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
      return {
        operationId: 'op-scan-001',
        kind: 'scan',
      } satisfies IpcOperationHandle;
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
      const req =
        (_args?.request as {
          sources?: Array<{ kind: string; path: string }>;
        }) ?? _args;
      const sources =
        (req?.sources as Array<{ kind: string; path: string }>) ?? [];
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
    case 'tools_validate_path': {
      // Setup wizard manual path entry (#662) add-time existence check —
      // mock mode has no real filesystem, so treat every non-empty path as
      // valid (mirrors the native-picker flow, which only ever adds paths
      // that already exist).
      const path = (_args?.path as string) ?? '';
      const valid = path.trim().length > 0;
      return {
        path,
        valid,
        reason: valid ? null : 'Path does not exist',
        // Mock mode has no real filesystem; treat every valid mock path as a
        // directory (mirrors the native-picker flow, which only ever adds
        // existing directories).
        isDir: valid ? true : null,
      } satisfies ToolPathValidation;
    }
    case 'firstrun_complete': {
      return {
        completedAt: new Date().toISOString(),
        registeredSourceCount: 0,
      } satisfies FirstRunCompleteResponse;
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
      return {
        completedAt: null,
        lastStep: 'welcome',
      } satisfies FirstRunStateResponse_Serialize;
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
              {
                kind: 'light',
                count: 16,
                destinationPreview: 'NGC7000/Ha/2025-10-10/light/',
                sampleFiles: ['NGC7000_Ha_001.fits', 'NGC7000_Ha_002.fits'],
              },
              {
                kind: 'dark',
                count: 2,
                destinationPreview: 'unclassified/2025-10-10/dark/',
                sampleFiles: ['dark_001.fits'],
              },
            ]
          : [
              {
                kind: 'dark',
                count: 50,
                destinationPreview: 'darks/2025-10-10/dark/',
                sampleFiles: ['dark_001.fits'],
              },
            ],
        unclassifiedFiles: isMixed ? ['NGC7000_Ha_mixed.fits'] : [],
        sampleFiles: ['NGC7000_Ha_001.fits'],
        computedAt: new Date().toISOString(),
      } satisfies InboxClassifyResponse_Serialize;
    }
    case 'inbox_confirm': {
      // Arg-sensitive: an ORGANIZED source catalogues in place (zero moves —
      // spec 041 US4/FR-018), an unorganized source produces a move plan
      // (FR-017). The observable move-vs-catalogue distinction surfaces on the
      // aggregate plan surface (`inbox_plan_list_open`); the confirm response
      // itself carries the branch via `actionsSummary`/`organizationState`.
      const req = (
        _args as
          | { req?: { inboxItemId?: string; rootAbsolutePath?: string } }
          | undefined
      )?.req;
      const inboxItemId = req?.inboxItemId ?? '';
      const rootAbsolutePath = req?.rootAbsolutePath ?? '/astro/raw';
      const organized = MOCK_ORGANIZED_ITEM_IDS.has(inboxItemId);
      // `itemsTotal` kept at 18 for the existing move-path e2e assertion.
      const itemsTotal = 18;
      const actionsSummary: InboxConfirmActionsSummary = organized
        ? { moveCount: 0, catalogueCount: itemsTotal }
        : { moveCount: itemsTotal, catalogueCount: 0 };
      const fromPath = `${rootAbsolutePath}/light_001.fits`;
      const destinations: InboxConfirmDestination[] = [
        organized
          ? {
              fromPath,
              toRelativePath: 'light_001.fits',
              toAbsolutePath: fromPath, // catalogue = no move
              toRootId: 'root-lights-001',
              action: 'catalogue',
            }
          : {
              fromPath,
              toRelativePath: 'darks/2025-10-10/light_001.fits',
              toAbsolutePath: '/astro/library/darks/2025-10-10/light_001.fits',
              toRootId: 'root-lights-001',
              action: 'move',
            },
      ];
      return {
        planId: `plan-${Date.now()}`,
        planState: 'ready_for_review',
        itemsTotal,
        registeredAsMaster: false,
        actionsSummary,
        organizationState: organized ? 'organized' : 'unorganized',
        destinations,
      } satisfies InboxConfirmResponse_Serialize;
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

    case 'inbox_reclassify_v2': {
      // Field-agnostic + bulk reclassify (spec 041 R-13/T068, issue #755).
      // No sub-item re-split fixture is modeled here — InboxDetail only reads
      // `needsReviewCount` and relies on cache invalidation to re-fetch the
      // list/classify queries (which their own mock cases already serve).
      const args = _args as { req?: { inboxItemId?: string } } | undefined;
      return {
        sourceGroupId: args?.req?.inboxItemId ?? 'item-001',
        subItems: [],
        needsReviewCount: 0,
      } satisfies InboxReclassifyV2Response_Serialize;
    }

    // ── Inbox plan surface (spec 041 US2) ─────────────────────────────────────
    //
    // These cases were previously ABSENT: every one fell through to `default:
    // throw new Error('Unknown mock command')`, so the "Review plans" overlay,
    // per-file metadata popover, and aggregate stats were unreachable in mock
    // mode. Shapes are pinned to the generated bindings.

    case 'inbox_plan_list_open': {
      const totalActions = mockInboxOpenPlans.reduce(
        (sum, p) => sum + p.actions.length,
        0,
      );
      return {
        plans: mockInboxOpenPlans,
        totalActions,
      } satisfies InboxOpenPlansResponse;
    }
    case 'inbox_plan': {
      const inboxItemId = (_args?.inboxItemId as string) ?? '';
      const plan = mockInboxOpenPlans.find(
        (p) => p.inboxItemId === inboxItemId,
      );
      if (!plan) {
        // Mirrors the backend's `inbox.item.no_plan` error branch, which the
        // hook swallows into an empty state (store.ts `useInboxPlan`).
        throw 'inbox.item.no_plan';
      }
      return {
        planId: plan.planId,
        state: plan.state,
        stale: plan.stale,
        actions: plan.actions,
      } satisfies InboxPlanView;
    }
    case 'inbox_plan_apply': {
      // The InboxPage apply-one path streams live progress through
      // `plans_apply_real` (Channel); this direct binding is retained for
      // completeness. Removes the applied plan from the aggregate surface.
      const inboxItemId = (_args?.inboxItemId as string) ?? '';
      const plan = mockInboxOpenPlans.find(
        (p) => p.inboxItemId === inboxItemId,
      );
      mockInboxOpenPlans = mockInboxOpenPlans.filter(
        (p) => p.inboxItemId !== inboxItemId,
      );
      return {
        planId: plan?.planId ?? 'plan-unknown',
        runId: 'op-inbox-apply-001',
        newState: 'applied',
      } satisfies PlanApplyResponse;
    }
    case 'inbox_plan_apply_all': {
      const results = mockInboxOpenPlans.map((p) => ({
        inboxItemId: p.inboxItemId,
        planId: p.planId,
        state: 'applied',
        error: null,
      }));
      mockInboxOpenPlans = [];
      return { results } satisfies InboxApplyAllResponse;
    }
    case 'inbox_plan_apply_selected': {
      const ids =
        (_args as { request?: { inboxItemIds?: string[] } } | undefined)
          ?.request?.inboxItemIds ?? [];
      const selected = mockInboxOpenPlans.filter((p) =>
        ids.includes(p.inboxItemId),
      );
      const results = selected.map((p) => ({
        inboxItemId: p.inboxItemId,
        planId: p.planId,
        state: 'applied',
        error: null,
      }));
      mockInboxOpenPlans = mockInboxOpenPlans.filter(
        (p) => !ids.includes(p.inboxItemId),
      );
      return { results } satisfies InboxApplyAllResponse;
    }
    case 'inbox_plan_cancel': {
      const inboxItemId = (_args?.inboxItemId as string) ?? '';
      const plan = mockInboxOpenPlans.find(
        (p) => p.inboxItemId === inboxItemId,
      );
      mockInboxOpenPlans = mockInboxOpenPlans.filter(
        (p) => p.inboxItemId !== inboxItemId,
      );
      return {
        inboxItemId,
        planId: plan?.planId ?? 'plan-unknown',
        state: 'classified',
      } satisfies InboxPlanCancelResponse;
    }
    case 'inbox_stats': {
      // Faithful aggregate: 3 folders (item-001/002/003) + 1 master
      // (item-master-dark), mirroring the `inbox_list` fixture. No component
      // currently invokes this (the UI derives stats client-side via
      // `deriveInboxStats`), but future batches can exercise it directly.
      return {
        perType: [
          { frameType: 'dark', folderCount: 0, masterCount: 1, imageCount: 1 },
          {
            frameType: 'mixed',
            folderCount: 3,
            masterCount: 0,
            imageCount: 67,
          },
        ],
        totals: { folders: 3, masters: 1, images: 68 },
      } satisfies InboxStatsResponse;
    }
    case 'inbox_item_metadata': {
      // Per-file extracted metadata for the selected inbox item (spec 041
      // US2/FR-010). Deliberately carries NO `missingPathAttributes` /
      // `missingMandatory` so confirm stays enabled in the move-path e2e.
      const inboxItemId =
        (_args as { req?: { inboxItemId?: string } } | undefined)?.req
          ?.inboxItemId ?? 'item-001';
      const files: InboxFileMetadata_Serialize[] = [
        {
          relativeFilePath: 'NGC7000_Ha_001.fits',
          frameTypeEffective: 'light',
          imageTyp: 'LIGHT',
          filter: 'Ha',
          exposureS: 300,
          gain: '100',
          binningX: 1,
          binningY: 1,
          temperatureC: -10,
          object: 'NGC 7000',
          dateObs: '2025-10-10T22:14:00',
          instrume: 'ASI2600MM Pro',
          telescop: 'Esprit 100ED',
          naxis1: 6248,
          naxis2: 4176,
          stackCount: null,
          isMaster: false,
          overrideStale: false,
          missingPathAttributes: [],
          missingMandatory: [],
          offset: 10,
          setTempC: -10,
          ccdTempC: -10,
        },
      ];
      return {
        inboxItemId,
        files,
      } satisfies InboxItemMetadataResponse_Serialize;
    }
    case 'inbox_property_registry': {
      // Typed property registry (spec 041 R-13/FR-044). No component invokes it
      // yet; a faithful subset keeps the field-agnostic reclassify editor
      // mockable for future batches.
      return [
        {
          key: 'frameType',
          kind: 'enum',
          unit: null,
          sourceHeaders: ['IMAGETYP'],
          overridable: true,
          appliesTo: ['light', 'dark', 'flat', 'bias'],
          validation: 'one of: light, dark, flat, bias',
        },
        {
          key: 'exposureS',
          kind: 'number',
          unit: 's',
          sourceHeaders: ['EXPTIME', 'EXPOSURE'],
          overridable: true,
          appliesTo: ['light', 'dark', 'flat'],
          validation: '> 0',
        },
        {
          key: 'filter',
          kind: 'string',
          unit: null,
          sourceHeaders: ['FILTER'],
          overridable: true,
          appliesTo: ['light', 'flat'],
          validation: null,
        },
      ] satisfies PropertyRegistryEntry_Serialize[];
    }

    // ── Inventory commands (spec 006) ─────────────────────────────────────────
    //
    // Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
    // inventory. `inventory_session_review` (the mock for the removed
    // `inventory.session.review` command) and the `reviewFilter`/`ignored`
    // session filtering were removed along with the review-state machine.

    case 'inventory_list': {
      const { INVENTORY_LIST_RESPONSE } = await import(
        '@/data/fixtures/inventory'
      );
      const req = (
        _args as
          | {
              req?: {
                filters?: {
                  sourceFilter?: string;
                  frameFilter?: 'light' | 'dark' | 'flat' | 'bias';
                };
              };
            }
          | undefined
      )?.req;
      const filters = req?.filters;
      // #652: mirror the real backend's `filters_to_db` scoping (source_id +
      // frame_type) so mock-mode e2e coverage of the Sessions Type filter
      // (defaults to Light) matches production behavior instead of always
      // returning the unfiltered fixture.
      const sources = filters
        ? INVENTORY_LIST_RESPONSE.sources
            .filter(
              (src) => !filters.sourceFilter || src.id === filters.sourceFilter,
            )
            .map((src) => ({
              ...src,
              sessions: filters.frameFilter
                ? src.sessions.filter((s) => s.type === filters.frameFilter)
                : src.sessions,
            }))
            .filter((src) => src.sessions.length > 0)
        : INVENTORY_LIST_RESPONSE.sources;
      return { ...INVENTORY_LIST_RESPONSE, sources };
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
      const req = (_args as { request?: { schemaPath?: string } } | undefined)
        ?.request;
      const path = req?.schemaPath ?? '';
      if (!path) {
        return { found: false };
      }
      // Return a minimal stub schema for any non-empty path.
      return {
        found: true,
        content: JSON.stringify(
          {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            title: 'mock-schema',
            description: `Mock schema for ${path}`,
          },
          null,
          2,
        ),
      };
    }

    case 'preparedview_list': {
      // Spec 049 US4 mock coverage: proj-002 carries two already-materialized
      // views so the Playwright mock suite can exercise "Verify before
      // processing" (clean + broken paths) without also mocking
      // generate/apply. Every other project keeps the pre-existing empty
      // list.
      const projectId = (_args as { projectId?: string } | undefined)
        ?.projectId;
      if (projectId === 'proj-002') {
        return {
          views: [
            {
              id: 'mock-sv-view-clean',
              projectId: 'proj-002',
              kind: 'symlink',
              state: 'current',
              createdAt: '2026-05-19T20:00:00Z',
              itemCount: 1,
              items: [
                {
                  id: 'mock-sv-item-clean-1',
                  inventoryItemId: 'mock-sv-inv-clean-1',
                  viewRelativePath: '/mock/source-views/clean/light_001.fits',
                  materialization: 'symlink',
                  lastObservedState: 'present',
                },
              ],
            },
            {
              id: 'mock-sv-view-broken',
              projectId: 'proj-002',
              kind: 'symlink',
              state: 'current',
              createdAt: '2026-05-19T20:00:00Z',
              itemCount: 1,
              items: [
                {
                  id: 'mock-sv-item-broken-1',
                  inventoryItemId: 'mock-sv-inv-broken-1',
                  viewRelativePath: '/mock/source-views/broken/light_002.fits',
                  materialization: 'symlink',
                  lastObservedState: 'present',
                },
              ],
            },
            // Spec 026 T014/T015/T016 mock coverage: a view already flagged
            // `stale` by a prior sweep, with one broken item pre-recorded —
            // the badge + broken-reference detail must render straight from
            // this list response, no Verify click required.
            {
              id: 'mock-sv-view-stale',
              projectId: 'proj-002',
              kind: 'symlink',
              state: 'stale',
              createdAt: '2026-05-19T20:00:00Z',
              itemCount: 2,
              items: [
                {
                  id: 'mock-sv-item-stale-ok',
                  inventoryItemId: 'mock-sv-inv-stale-ok',
                  viewRelativePath: '/mock/source-views/stale/light_003.fits',
                  materialization: 'symlink',
                  lastObservedState: 'present',
                },
                {
                  id: 'mock-sv-item-stale-broken',
                  inventoryItemId: 'mock-sv-inv-stale-broken',
                  viewRelativePath: '/mock/source-views/stale/light_004.fits',
                  materialization: 'symlink',
                  lastObservedState: 'missing',
                },
              ],
            },
          ],
        };
      }
      return { views: [] };
    }

    case 'preparedview_remove': {
      return { planId: 'mock-plan-remove-001' };
    }

    case 'preparedview_regenerate': {
      return { planId: 'mock-plan-regen-001', unresolvedItemCount: 0 };
    }

    case 'sourceview_verify': {
      // FR-014/FR-015: read-only, no mutation, no auto-repair — the mock
      // simply reports canned clean/broken results keyed by view id.
      const viewId = (_args as { viewId?: string } | undefined)?.viewId;
      if (viewId === 'mock-sv-view-broken') {
        return {
          clean: false,
          brokenItems: [
            {
              inventoryItemId: 'mock-sv-inv-broken-1',
              viewRelativePath: '/mock/source-views/broken/light_002.fits',
              state: 'moved',
            },
          ],
        };
      }
      return { clean: true, brokenItems: [] };
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
        sensorType: req?.sensorType ?? null,
        passband: req?.passband ?? null,
      };
      mockCameras = [...mockCameras, camera];
      return camera;
    }
    case 'equipment_cameras_update': {
      const req = (_args as { request?: UpdateCamera } | undefined)?.request;
      if (!req)
        return mockContractError('equipment.not_found', 'camera not found');
      const existing = mockCameras.find((c) => c.id === req.id);
      if (!existing)
        return mockContractError(
          'equipment.not_found',
          `camera ${req.id} not found`,
        );
      const updated: Camera = {
        ...existing,
        name: req.name,
        aliases: req.aliases,
        sensorType: req.sensorType ?? null,
        passband: req.passband ?? null,
      };
      mockCameras = mockCameras.map((c) => (c.id === req.id ? updated : c));
      return updated;
    }
    case 'equipment_cameras_delete': {
      const id = (_args as { id?: string } | undefined)?.id;
      if (!id || !mockCameras.some((c) => c.id === id)) {
        return mockContractError(
          'equipment.not_found',
          `camera ${id ?? ''} not found`,
        );
      }
      if (mockOpticalTrains.some((t) => t.cameraId === id)) {
        return mockContractError(
          'internal.database',
          'FOREIGN KEY constraint failed',
        );
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
      if (!req)
        return mockContractError('equipment.not_found', 'telescope not found');
      const existing = mockTelescopes.find((t) => t.id === req.id);
      if (!existing)
        return mockContractError(
          'equipment.not_found',
          `telescope ${req.id} not found`,
        );
      const updated: Telescope = {
        ...existing,
        name: req.name,
        aliases: req.aliases,
        focalLengthMm: req.focalLengthMm,
      };
      mockTelescopes = mockTelescopes.map((t) =>
        t.id === req.id ? updated : t,
      );
      return updated;
    }
    case 'equipment_telescopes_delete': {
      const id = (_args as { id?: string } | undefined)?.id;
      if (!id || !mockTelescopes.some((t) => t.id === id)) {
        return mockContractError(
          'equipment.not_found',
          `telescope ${id ?? ''} not found`,
        );
      }
      if (mockOpticalTrains.some((t) => t.telescopeId === id)) {
        return mockContractError(
          'internal.database',
          'FOREIGN KEY constraint failed',
        );
      }
      mockTelescopes = mockTelescopes.filter((t) => t.id !== id);
      return null;
    }

    case 'equipment_trains_create': {
      const req = (_args as { request?: CreateOpticalTrain } | undefined)
        ?.request;
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
      const req = (_args as { request?: UpdateOpticalTrain } | undefined)
        ?.request;
      if (!req)
        return mockContractError(
          'equipment.not_found',
          'optical train not found',
        );
      const existing = mockOpticalTrains.find((t) => t.id === req.id);
      if (!existing) {
        return mockContractError(
          'equipment.not_found',
          `optical train ${req.id} not found`,
        );
      }
      const updated: OpticalTrain = {
        ...existing,
        name: req.name,
        telescopeId: req.telescopeId,
        cameraId: req.cameraId,
        focalLengthMm: req.focalLengthMm,
      };
      mockOpticalTrains = mockOpticalTrains.map((t) =>
        t.id === req.id ? updated : t,
      );
      return updated;
    }
    case 'equipment_trains_delete': {
      const id = (_args as { id?: string } | undefined)?.id;
      if (!id || !mockOpticalTrains.some((t) => t.id === id)) {
        return mockContractError(
          'equipment.not_found',
          `optical train ${id ?? ''} not found`,
        );
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
      if (!req)
        return mockContractError('equipment.not_found', 'filter not found');
      const existing = mockFilters.find((f) => f.id === req.id);
      if (!existing)
        return mockContractError(
          'equipment.not_found',
          `filter ${req.id} not found`,
        );
      const updated: Filter = {
        ...existing,
        name: req.name,
        category: req.category,
      };
      mockFilters = mockFilters.map((f) => (f.id === req.id ? updated : f));
      return updated;
    }
    case 'equipment_filters_delete': {
      const id = (_args as { id?: string } | undefined)?.id;
      if (!id || !mockFilters.some((f) => f.id === id)) {
        return mockContractError(
          'equipment.not_found',
          `filter ${id ?? ''} not found`,
        );
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
      const req = (
        _args as
          | {
              request?: {
                pattern?: string;
                sampleMetadata?: Record<string, string | null | undefined>;
              };
            }
          | undefined
      )?.request;
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
