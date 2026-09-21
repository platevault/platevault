// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The sample library the demonstration mode is built on.
 *
 * Everything here is a fixed, hand-authored record of one plausible
 * astrophotography library: registered roots plus one external drive that is
 * currently unplugged, acquisition sessions across four targets, and the
 * project work that consumes them. Nothing is randomised and no value depends
 * on the current date, so a reviewer opening the same surface twice sees the
 * same counts, the same ordering and the same warnings.
 *
 * The deliberate rough edges are the point: a missing frame, a locked master,
 * a plan that stopped part-way, an unresolved target. Those are the states
 * worth reviewing, and a library with none of them proves nothing.
 */

import type {
  ArtifactSummary,
  ConeSearchSuggestResponse_Serialize,
  FramingDto_Serialize,
  InboxFileEntry,
  InboxTargetCandidate,
  InventoryFrame_Serialize,
  LedgerRowDto,
  PlanApplyStatus_Serialize,
  ProvenanceField_Serialize,
  RawFrameCleanupCandidate_Serialize,
  RawFrameType,
  ResolverSettings,
  RootInventoryConfig,
  TargetAliasDto,
  TargetProjectItem,
  TargetSessionItem,
} from '@/bindings/index';

/** The reference instant the sample library is described relative to. */
export const SAMPLE_NOW = '2026-05-20T21:40:00Z';

/** Registered root identities, matching the roots the library reports. */
export const ROOT_RAW = 'root-001';
export const ROOT_CALIBRATION = 'root-002';
export const ROOT_PROJECTS = 'root-003';
/** An external drive that is registered but not currently attached. */
export const ROOT_OFFLINE = 'root-004';
export const ROOT_OFFLINE_PATH = '/Volumes/AstroArchive';

/** Session identities reused across the ledger, calibration and planning. */
export const SESSION_NGC7000_HA = '550e8400-e29b-41d4-a716-446655440001';
export const SESSION_NGC7000_OIII = '550e8400-e29b-41d4-a716-446655440002';
export const SESSION_IC1396_SII = '550e8400-e29b-41d4-a716-446655440003';
export const SESSION_M31_LUM = '550e8400-e29b-41d4-a716-446655440004';

export const PROJECT_NGC7000_HOO = '550e8400-e29b-41d4-a716-446655440301';
export const PROJECT_M31_LRGB = '550e8400-e29b-41d4-a716-446655440302';

export const TARGET_M31 = '550e8400-e29b-41d4-a716-446655440202';
export const TARGET_IC1396 = '550e8400-e29b-41d4-a716-446655440203';
export const TARGET_JUPITER = '550e8400-e29b-41d4-a716-446655440204';
export const TARGET_UNRESOLVED = '550e8400-e29b-41d4-a716-446655440206';

/** Zero-padded ordinal, so a frame list sorts the way a capture run wrote it. */
function seq(n: number): string {
  return String(n).padStart(4, '0');
}

/**
 * One capture run's worth of frames.
 *
 * `missingAt` and `protectedAt` mark the one-based positions that are not
 * merely present, which is how the sample library carries a broken link and a
 * cleanup-immune original without needing a second fixture set.
 */
function run(opts: {
  sessionId: string;
  rootId: string;
  dir: string;
  stem: string;
  frameType: RawFrameType;
  count: number;
  sizeBytes: number;
  missingAt?: number[];
  protectedAt?: number[];
}): InventoryFrame_Serialize[] {
  const missing = new Set(opts.missingAt ?? []);
  const locked = new Set(opts.protectedAt ?? []);
  return Array.from({ length: opts.count }, (_unused, i) => {
    const n = i + 1;
    const state: InventoryFrame_Serialize['state'] = missing.has(n)
      ? 'missing'
      : locked.has(n)
        ? 'protected'
        : 'present';
    return {
      frameId: `${opts.sessionId}-f${seq(n)}`,
      rootId: opts.rootId,
      relativePath: `${opts.dir}/${opts.stem}_${seq(n)}.fits`,
      frameType: opts.frameType,
      sizeBytes: opts.sizeBytes,
      state,
      sessionId: opts.sessionId,
    };
  });
}

/**
 * Per-frame inventory, keyed by session.
 *
 * The Ha run is the long one — a reviewer needs at least one session whose
 * frame list does not fit on screen, otherwise scrolling and the per-frame
 * footer are never exercised.
 */
export const FRAMES_BY_SESSION: Record<string, InventoryFrame_Serialize[]> = {
  [SESSION_NGC7000_HA]: run({
    sessionId: SESSION_NGC7000_HA,
    rootId: ROOT_RAW,
    dir: '2026-04-12/NGC7000',
    stem: 'NGC7000_Ha_300s',
    frameType: 'light',
    count: 54,
    sizeBytes: 62_914_560,
    missingAt: [17, 41],
    protectedAt: [1],
  }),
  [SESSION_NGC7000_OIII]: run({
    sessionId: SESSION_NGC7000_OIII,
    rootId: ROOT_RAW,
    dir: '2026-04-15/NGC7000',
    stem: 'NGC7000_OIII_300s',
    frameType: 'light',
    count: 22,
    sizeBytes: 62_914_560,
  }),
  [SESSION_IC1396_SII]: run({
    sessionId: SESSION_IC1396_SII,
    rootId: ROOT_RAW,
    dir: '2026-04-14/IC1396',
    stem: 'IC1396_SII_300s',
    frameType: 'light',
    count: 18,
    sizeBytes: 62_914_560,
    missingAt: [3],
  }),
  // The Andromeda run lives on the drive that is currently unplugged, so its
  // frames are recorded but not reachable.
  [SESSION_M31_LUM]: run({
    sessionId: SESSION_M31_LUM,
    rootId: ROOT_OFFLINE,
    dir: '2025-10-02/M31',
    stem: 'M31_L_180s',
    frameType: 'light',
    count: 31,
    sizeBytes: 41_943_040,
  }),
};

/** Every frame in the library, in session then capture order. */
export function allFrames(): InventoryFrame_Serialize[] {
  return Object.values(FRAMES_BY_SESSION).flat();
}

/** Frames inside one session, one root, or the whole library. */
export function framesForScope(scope: {
  sessionId?: string | null;
  rootId?: string | null;
}): InventoryFrame_Serialize[] {
  if (scope.sessionId) return FRAMES_BY_SESSION[scope.sessionId] ?? [];
  if (scope.rootId) return allFrames().filter((f) => f.rootId === scope.rootId);
  return allFrames();
}

/** Candidate relative paths offered when a broken frame link is repaired. */
export const RELINK_CANDIDATES: Record<string, string> = {
  [`${SESSION_NGC7000_HA}-f0017`]:
    '2026-04-12/NGC7000/reprocessed/NGC7000_Ha_300s_0017.fits',
  [`${SESSION_NGC7000_HA}-f0041`]:
    '2026-04-12/NGC7000/reprocessed/NGC7000_Ha_300s_0041.fits',
  [`${SESSION_IC1396_SII}-f0003`]:
    '2026-04-14/IC1396/rescued/IC1396_SII_300s_0003.fits',
};

/** Per-root scanning behaviour, editable from the root configuration panel. */
export const ROOT_CONFIGS: Record<string, RootInventoryConfig> = {
  [ROOT_RAW]: {
    reconcileMode: 'flag_missing',
    detection: {
      live: true,
      scheduled: true,
      onOpen: true,
      followSymlinks: false,
    },
  },
  [ROOT_CALIBRATION]: {
    reconcileMode: 'auto_reconcile',
    detection: {
      live: false,
      scheduled: true,
      onOpen: true,
      followSymlinks: false,
    },
  },
  [ROOT_PROJECTS]: {
    reconcileMode: 'flag_missing',
    detection: {
      live: false,
      scheduled: false,
      onOpen: true,
      followSymlinks: true,
    },
  },
  [ROOT_OFFLINE]: {
    reconcileMode: 'flag_missing',
    detection: {
      live: false,
      scheduled: false,
      onOpen: false,
      followSymlinks: false,
    },
  },
};

/** Files a rescan of the sample inbox folder reports. */
export const INBOX_SCAN_ENTRIES: InboxFileEntry[] = [
  ...Array.from({ length: 46 }, (_unused, i) => ({
    path: `/astro/inbox/2025-10-10/darks/Dark_300s_${seq(i + 1)}.fits`,
    fileName: `Dark_300s_${seq(i + 1)}.fits`,
    sizeBytes: 62_914_560,
    extension: 'fits',
  })),
  {
    path: '/astro/inbox/2025-10-10/darks/masterDark_Ha_300s.xisf',
    fileName: 'masterDark_Ha_300s.xisf',
    sizeBytes: 251_658_240,
    extension: 'xisf',
  },
  ...Array.from({ length: 18 }, (_unused, i) => ({
    path: `/astro/inbox/2025-10-10/NGC7000/NGC7000_Ha_300s_${seq(i + 1)}.fits`,
    fileName: `NGC7000_Ha_300s_${seq(i + 1)}.fits`,
    sizeBytes: 62_914_560,
    extension: 'fits',
  })),
  ...Array.from({ length: 3 }, (_unused, i) => ({
    path: `/astro/inbox/2025-11-01/Jupiter/Jupiter_2025-11-01_${seq(i + 1)}.ser`,
    fileName: `Jupiter_2025-11-01_${seq(i + 1)}.ser`,
    sizeBytes: 3_221_225_472,
    extension: 'ser',
  })),
];

/**
 * Ranked target suggestions for an unclassified light-frame folder.
 *
 * Nothing is preselected: the closest candidate is a fraction of a degree
 * away, near enough to be plausible and far enough that the app must not
 * decide on the reviewer's behalf.
 */
export const INBOX_TARGET_CANDIDATES: InboxTargetCandidate[] = [
  { targetId: TARGET_IC1396, name: 'IC 1396', separationDeg: 0.42 },
  { targetId: TARGET_M31, name: 'M31', separationDeg: 11.8 },
  { targetId: TARGET_UNRESOLVED, name: '(unresolved)', separationDeg: null },
];

/** Aliases the sample targets are also known by. */
export const TARGET_ALIASES: Record<string, TargetAliasDto[]> = {
  [TARGET_M31]: [
    { id: 'alias-m31-ngc', alias: 'NGC 224', kind: 'designation' },
    { id: 'alias-m31-common', alias: 'Andromeda Galaxy', kind: 'common_name' },
    { id: 'alias-m31-capture', alias: 'M31_LRGB', kind: 'user' },
  ],
  [TARGET_IC1396]: [
    { id: 'alias-ic1396-common', alias: "Elephant's Trunk", kind: 'common_name' },
    { id: 'alias-ic1396-sh2', alias: 'Sh2-131', kind: 'designation' },
  ],
  [TARGET_JUPITER]: [],
  [TARGET_UNRESOLVED]: [],
};

/** Sessions each target was observed in. */
export const TARGET_SESSIONS: Record<string, TargetSessionItem[]> = {
  [TARGET_M31]: [
    {
      id: SESSION_M31_LUM,
      sessionKey: 'M31 · L · 2025-10-02',
      createdAt: '2025-10-03T04:12:00Z',
      frameCount: 31,
      filter: 'L',
    },
  ],
  [TARGET_IC1396]: [
    {
      id: SESSION_IC1396_SII,
      sessionKey: 'IC 1396 · SII · 2026-04-14',
      createdAt: '2026-04-15T03:58:00Z',
      frameCount: 18,
      filter: 'SII',
    },
  ],
  [TARGET_JUPITER]: [],
  [TARGET_UNRESOLVED]: [],
};

/** Projects that draw on each target. */
export const TARGET_PROJECTS: Record<string, TargetProjectItem[]> = {
  [TARGET_M31]: [
    { id: PROJECT_M31_LRGB, name: 'M31 · LRGB', lifecycle: 'processing' },
  ],
  [TARGET_IC1396]: [],
  [TARGET_JUPITER]: [],
  [TARGET_UNRESOLVED]: [],
};

/** Free-text notes a reviewer can edit and re-read. */
export const TARGET_NOTES: Record<string, string> = {
  [TARGET_M31]: 'Luminance is on the archive drive. Re-shoot RGB at f/5.5.',
  [TARGET_IC1396]: '',
  [TARGET_JUPITER]: 'Best seeing so far was the 2025-11-01 run.',
  [TARGET_UNRESOLVED]: 'Object keyword was blank on all 22 frames.',
};

/** Coordinates the library holds for each target, already formatted. */
export const TARGET_COORDS: Record<
  string,
  { raSexagesimal: string; decSexagesimal: string }
> = {
  [TARGET_M31]: {
    raSexagesimal: '00h 42m 44.3s',
    decSexagesimal: '+41° 16′ 09″',
  },
  [TARGET_IC1396]: {
    raSexagesimal: '21h 39m 06.0s',
    decSexagesimal: '+57° 30′ 00″',
  },
  [TARGET_JUPITER]: {
    raSexagesimal: '04h 18m 51.2s',
    decSexagesimal: '+20° 44′ 33″',
  },
  [TARGET_UNRESOLVED]: { raSexagesimal: '—', decSexagesimal: '—' },
};

/** How the library looks up an unfamiliar designation. */
export const RESOLVER_SETTINGS: ResolverSettings = {
  onlineEnabled: false,
  simbadEndpoint: 'https://simbad.u-strasbg.fr/simbad/sim-tap',
  debounceMs: 300,
  requestTimeoutSecs: 8,
};

/**
 * Sky-position candidates offered when a group of frames has no confirmed
 * target. Neither is preselected: the app proposes, the reviewer decides.
 */
export const CONE_SEARCH: ConeSearchSuggestResponse_Serialize = {
  pointing: {
    source: 'wcs',
    centerRaDeg: 324.1,
    centerDecDeg: 57.5,
    radiusDeg: 1.2,
    opticsKnown: true,
  },
  suggestions: [
    {
      candidate: {
        canonicalTargetId: TARGET_IC1396,
        primaryDesignation: 'IC 1396',
        commonName: "Elephant's Trunk",
        objectType: 'emission_nebula',
        raDeg: 324.775,
        decDeg: 57.5,
        magnitude: 3.5,
        constellation: 'Cepheus',
      },
      separationDeg: 0.42,
      confidence: 'medium',
      preselected: false,
      excluded: false,
    },
    {
      candidate: {
        canonicalTargetId: null,
        primaryDesignation: 'Sh2-131',
        commonName: null,
        objectType: 'emission_nebula',
        raDeg: 324.8,
        decDeg: 57.4,
        magnitude: null,
        constellation: 'Cepheus',
      },
      separationDeg: 0.61,
      confidence: 'low',
      preselected: false,
      excluded: false,
    },
  ],
};

/**
 * Mosaic panel grouping per project.
 *
 * The wide-field run was captured as two overlapping panels, so the panel
 * surface has real rows to merge, split and reassign rather than an empty
 * shell.
 */
export const FRAMINGS: Record<string, FramingDto_Serialize[]> = {
  [PROJECT_NGC7000_HOO]: [
    {
      id: 'framing-7000-a',
      projectId: PROJECT_NGC7000_HOO,
      targetId: null,
      opticTrainKey: 'Esprit 100ED + ASI2600MM Pro',
      pointing: { ra: 314.75, dec: 44.35 },
      rotation: 0,
      tolerance: { pointing: 0.25, rotation: 2 },
      sessionIds: [SESSION_NGC7000_HA],
      clustering: 'suggested',
    },
    {
      id: 'framing-7000-b',
      projectId: PROJECT_NGC7000_HOO,
      targetId: null,
      opticTrainKey: 'Esprit 100ED + ASI2600MM Pro',
      pointing: { ra: 315.4, dec: 44.1 },
      rotation: 0,
      tolerance: { pointing: 0.25, rotation: 2 },
      sessionIds: [SESSION_NGC7000_OIII],
      clustering: 'user_adjusted',
    },
  ],
  [PROJECT_M31_LRGB]: [],
};

/** Outputs and intermediates observed inside the two active projects. */
export const ARTIFACTS: Record<string, ArtifactSummary[]> = {
  [PROJECT_NGC7000_HOO]: [
    {
      id: 'art-7000-final',
      projectId: PROJECT_NGC7000_HOO,
      toolLaunchId: 'launch-7000-01',
      path: 'outputs/NGC7000_HOO_final.tif',
      kind: 'final',
      tool: 'PixInsight',
      detectedAt: '2026-05-18T22:14:00Z',
      lastSeenAt: SAMPLE_NOW,
      state: 'accepted',
      classificationConfidence: 0.96,
      classificationSource: 'reviewed',
      sizeBytes: 1_181_116_006,
    },
    {
      id: 'art-7000-drizzle',
      projectId: PROJECT_NGC7000_HOO,
      toolLaunchId: 'launch-7000-01',
      path: 'processing/drizzle/NGC7000_Ha_drizzle.xisf',
      kind: 'drizzle',
      tool: 'PixInsight',
      detectedAt: '2026-05-18T20:02:00Z',
      lastSeenAt: SAMPLE_NOW,
      state: 'unreviewed',
      classificationConfidence: 0.71,
      classificationSource: 'inferred',
      sizeBytes: 4_294_967_296,
    },
    {
      id: 'art-7000-log',
      projectId: PROJECT_NGC7000_HOO,
      toolLaunchId: 'launch-7000-01',
      path: 'processing/logs/stacking-2026-05-18.log',
      kind: 'log',
      tool: 'PixInsight',
      detectedAt: '2026-05-18T20:02:00Z',
      lastSeenAt: SAMPLE_NOW,
      state: 'unreviewed',
      classificationConfidence: null,
      classificationSource: 'observed',
      sizeBytes: 486_539,
    },
  ],
  [PROJECT_M31_LRGB]: [
    {
      id: 'art-m31-preview',
      projectId: PROJECT_M31_LRGB,
      toolLaunchId: null,
      path: 'outputs/M31_LRGB_preview.jpg',
      kind: 'preview',
      tool: 'unknown',
      detectedAt: '2026-05-11T19:30:00Z',
      lastSeenAt: SAMPLE_NOW,
      state: 'superseded',
      classificationConfidence: 0.44,
      classificationSource: 'inferred',
      sizeBytes: 2_411_724,
    },
  ],
};

/**
 * Raw frames a cleanup scan would offer to reclaim.
 *
 * The first row is deliberately locked. Cleanup views that hide protected
 * material look safer and prove less, so the sample library always has one.
 */
export const CLEANUP_CANDIDATES: RawFrameCleanupCandidate_Serialize[] = [
  {
    frameId: `${SESSION_NGC7000_HA}-f0001`,
    sessionId: SESSION_NGC7000_HA,
    rootId: ROOT_RAW,
    relativePath: '2026-04-12/NGC7000/NGC7000_Ha_300s_0001.fits',
    frameType: 'light',
    sizeBytes: 62_914_560,
    protection: 'protected',
    confidence: null,
  },
  {
    frameId: `${SESSION_NGC7000_OIII}-f0019`,
    sessionId: SESSION_NGC7000_OIII,
    rootId: ROOT_RAW,
    relativePath: '2026-04-15/NGC7000/NGC7000_OIII_300s_0019.fits',
    frameType: 'light',
    sizeBytes: 62_914_560,
    protection: 'unprotected',
    confidence: 0.88,
  },
  {
    frameId: `${SESSION_NGC7000_OIII}-f0020`,
    sessionId: SESSION_NGC7000_OIII,
    rootId: ROOT_RAW,
    relativePath: '2026-04-15/NGC7000/NGC7000_OIII_300s_0020.fits',
    frameType: 'light',
    sizeBytes: 62_914_560,
    protection: 'unprotected',
    confidence: 0.82,
  },
  {
    frameId: `${SESSION_IC1396_SII}-f0011`,
    sessionId: SESSION_IC1396_SII,
    rootId: ROOT_RAW,
    relativePath: '2026-04-14/IC1396/IC1396_SII_300s_0011.fits',
    frameType: 'light',
    sizeBytes: 62_914_560,
    protection: 'unprotected',
    confidence: 0.64,
  },
];

/** Lifecycle positions across the library, newest change first. */
export const LEDGER_ROWS: LedgerRowDto[] = [
  {
    entityId: PROJECT_NGC7000_HOO,
    entityType: 'project',
    currentState: 'processing',
    title: 'NGC 7000 · HOO',
    path: '/astro/projects/NGC7000_HOO',
    projectId: PROJECT_NGC7000_HOO,
    updatedAt: '2026-05-18T22:14:00Z',
  },
  {
    entityId: PROJECT_M31_LRGB,
    entityType: 'project',
    currentState: 'blocked',
    title: 'M31 · LRGB',
    path: '/astro/projects/M31_LRGB',
    projectId: PROJECT_M31_LRGB,
    updatedAt: '2026-05-12T09:02:00Z',
  },
  {
    entityId: SESSION_NGC7000_HA,
    entityType: 'acquisition_session',
    currentState: 'confirmed',
    title: 'NGC 7000 · Ha — 2026-04-12',
    path: '/astro/raw/2026-04-12/NGC7000',
    projectId: PROJECT_NGC7000_HOO,
    updatedAt: '2026-04-19T18:40:00Z',
  },
  {
    entityId: SESSION_IC1396_SII,
    entityType: 'acquisition_session',
    currentState: 'needs_review',
    title: 'IC 1396 · SII — 2026-04-14',
    path: '/astro/raw/2026-04-14/IC1396',
    projectId: null,
    updatedAt: '2026-04-15T03:58:00Z',
  },
  {
    entityId: SESSION_M31_LUM,
    entityType: 'acquisition_session',
    currentState: 'confirmed',
    title: 'M31 · L — 2025-10-02',
    path: `${ROOT_OFFLINE_PATH}/2025-10-02/M31`,
    projectId: PROJECT_M31_LRGB,
    updatedAt: '2025-10-04T11:20:00Z',
  },
];

/**
 * Where an interrupted plan stopped.
 *
 * The sample library keeps one plan stopped part-way through: it is the only
 * way a reviewer can see resume, retry and per-item outcome without waiting
 * for a real failure.
 */
export const PLAN_APPLY_STATUS: Record<string, PlanApplyStatus_Serialize> = {
  'plan-006': {
    planId: 'plan-006',
    runId: 'run-006-a',
    planState: 'paused',
    itemsTotal: 41,
    itemsApplied: 18,
    itemsFailed: 1,
    itemsSkipped: 2,
    itemsCancelled: 0,
    itemsPending: 20,
    pauseReason: 'destination volume unavailable',
  },
};

/** What a plan that has not been started yet reports. */
export function defaultPlanApplyStatus(
  planId: string,
): PlanApplyStatus_Serialize {
  return {
    planId,
    runId: null,
    planState: 'ready_for_review',
    itemsTotal: 12,
    itemsApplied: 0,
    itemsFailed: 0,
    itemsSkipped: 0,
    itemsCancelled: 0,
    itemsPending: 12,
    pauseReason: null,
  };
}

/** Recorded origin of a value, so a detail pane can explain where it came from. */
export const PROVENANCE_FIELDS: ProvenanceField_Serialize[] = [
  {
    fieldPath: 'target',
    current: 'NGC 7000',
    origin: 'reviewed',
    capturedAt: '2026-04-19T18:40:00Z',
    sourceId: ROOT_RAW,
    history: [],
    historyTruncated: false,
  },
  {
    fieldPath: 'filter',
    current: 'Ha',
    origin: 'observed',
    capturedAt: '2026-04-13T02:11:00Z',
    sourceId: ROOT_RAW,
    history: [],
    historyTruncated: false,
  },
  {
    fieldPath: 'observerLocation',
    current: null,
    origin: 'inferred',
    capturedAt: '2026-04-13T02:11:00Z',
    sourceId: ROOT_RAW,
    history: [],
    historyTruncated: true,
  },
];

/** Settings a reviewer is allowed to override per source. */
export const OVERRIDABLE_SETTING_KEYS: string[] = [
  'ingestion.hashMode',
  'ingestion.followSymlinks',
  'ingestion.metadataDepth',
  'naming.perFrameTypePatterns',
  'cleanup.policy',
  'sourceViews.strategy',
];

/** Which material every source refuses to hand to cleanup. */
export const PROTECTED_CATEGORIES: string[] = [
  'source_frames',
  'calibration_masters',
  'final_outputs',
  'manifests',
  'notes',
  'audit_records',
];
