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

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Inline fixtures for modules not yet created by T015 ---

const mockAuditEntries: AuditEntry[] = [
  { id: 'audit-001', timestamp: '2026-05-20T22:15:00Z', eventType: 'session.confirmed', entityType: 'session', entityId: 'ses-001', fromState: 'needs_review', toState: 'confirmed', actor: 'user', outcome: 'applied', detail: 'User confirmed session' },
  { id: 'audit-002', timestamp: '2026-05-20T22:10:00Z', eventType: 'plan.approved', entityType: 'plan', entityId: 'plan-001', fromState: 'ready_for_review', toState: 'approved', actor: 'user', outcome: 'applied', detail: 'Plan approved' },
  { id: 'audit-003', timestamp: '2026-05-20T21:45:00Z', eventType: 'plan.applied', entityType: 'plan', entityId: 'plan-001', fromState: 'approved', toState: 'applied', actor: 'system', outcome: 'applied', detail: 'All 12 items applied' },
  { id: 'audit-004', timestamp: '2026-05-19T23:30:00Z', eventType: 'scan.completed', entityType: 'root', entityId: 'root-001', actor: 'system', outcome: 'ok', detail: 'Discovered 1,247 files in 4.2s' },
  { id: 'audit-005', timestamp: '2026-05-19T23:25:00Z', eventType: 'scan.started', entityType: 'root', entityId: 'root-001', actor: 'user', outcome: 'ok', detail: 'Manual scan triggered' },
];

const mockSettingsData: SettingsData = {
  scope: 'general',
  values: {
    naming_pattern: '{target}/{date}/{filter}/{target}_{filter}_{sequence}.fits',
    default_source_view_strategy: 'symlink',
    calibration_age_warning_days: 90,
  },
};

const mockRoots: LibraryRoot[] = [
  { id: 'root-001', path: '/astro/raw', category: 'raw', online: true, fileCount: 1247, lastScanned: '2026-05-19T23:30:00Z' },
  { id: 'root-002', path: '/astro/calibration', category: 'calibration', online: true, fileCount: 342, lastScanned: '2026-05-19T23:30:00Z' },
  { id: 'root-003', path: '/astro/projects', category: 'project', online: true, fileCount: 856, lastScanned: '2026-05-18T20:00:00Z' },
];

const mockEquipment: Equipment[] = [
  { id: 'eq-001', name: 'ASI2600MM Pro', kind: 'camera', aliases: ['ZWO ASI2600MM'] },
  { id: 'eq-002', name: 'Esprit 100ED', kind: 'telescope', aliases: ['SW Esprit 100ED'] },
  { id: 'eq-003', name: 'EQ6-R Pro', kind: 'mount', aliases: ['EQ6R'] },
];

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

export async function mockInvoke<T>(
  cmd: string,
  _args?: Record<string, unknown>,
): Promise<T> {
  // Simulate realistic network/IPC latency
  await delay(50 + Math.random() * 100);

  switch (cmd) {
    // ---------- Query Commands ----------

    case 'sessions_list': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return sessions as T;
    }
    case 'sessions_get': {
      const { sessionDetail } = await import('@/data/fixtures/sessions');
      return sessionDetail as T;
    }
    case 'sessions_calendar': {
      return mockCalendarData as T;
    }
    case 'calibration_masters_list': {
      const { masters } = await import('@/data/fixtures/calibration');
      return masters as T;
    }
    case 'calibration_masters_get': {
      return mockMasterDetail as T;
    }
    case 'calibration_matches': {
      return mockMatchCandidates as T;
    }
    case 'targets_list': {
      const { targets } = await import('@/data/fixtures/targets');
      return targets as T;
    }
    case 'targets_get': {
      const { targetDetail } = await import('@/data/fixtures/targets');
      return targetDetail as T;
    }

    // ── gen-3 target commands (spec 036) ──────────────────────────────────────
    case 'target_list': {
      return [
        { id: 'tgt-m31', effectiveLabel: 'M 31', primaryDesignation: 'M 31', objectType: 'galaxy' },
        { id: 'tgt-ngc7000', effectiveLabel: 'NGC 7000', primaryDesignation: 'NGC 7000', objectType: 'emission_nebula' },
      ] as T;
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
      } as T;
    }
    case 'target_search': {
      const req = (_args as { req?: { query?: string } } | undefined)?.req;
      const q = (req?.query ?? '').toLowerCase();
      const allSuggestions = [
        { targetId: 'tgt-m31', primaryDesignation: 'M 31', commonName: 'Andromeda Galaxy', objectType: 'galaxy', matchedAlias: 'Andromeda', source: 'seed' },
        { targetId: 'tgt-ngc7000', primaryDesignation: 'NGC 7000', commonName: null, objectType: 'emission_nebula', matchedAlias: 'North America Nebula', source: 'seed' },
      ];
      const suggestions = q
        ? allSuggestions.filter(
            (s) =>
              s.primaryDesignation.toLowerCase().includes(q) ||
              (s.commonName?.toLowerCase().includes(q) ?? false) ||
              (s.matchedAlias?.toLowerCase().includes(q) ?? false),
          )
        : allSuggestions;
      return { contractVersion: '1.0', requestId: crypto.randomUUID(), suggestions } as T;
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
        },
        unresolvedReason: null,
        error: null,
      } as T;
    }

    case 'projects_list': {
      // spec 008 real shape: ProjectSummaryDto[]
      const { mockProjectSummaries } = await import('@/data/fixtures/projects');
      return mockProjectSummaries as T;
    }
    case 'projects_get': {
      // spec 008 real shape: ProjectDetailDto
      const { mockProjectDetail008 } = await import('@/data/fixtures/projects');
      return mockProjectDetail008 as T;
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
      } as T;
    }
    case 'projects_update': {
      return {
        projectId: (_args as Record<string, Record<string, string>>)?.req?.projectId ?? 'mock-id',
        fieldsUpdated: [],
        auditId: 'mock-audit-id',
        updatedAt: new Date().toISOString(),
      } as T;
    }
    case 'projects_source_add': {
      return {
        projectId: (_args as Record<string, Record<string, string>>)?.req?.projectId ?? 'mock-id',
        sourceAdded: { inventoryId: 'mock-inv', name: '', frames: 0, filter: '', exposure: '', linkedAt: new Date().toISOString() },
        channels: [],
        auditId: 'mock-audit-id',
        linkedAt: new Date().toISOString(),
      } as T;
    }
    case 'projects_source_remove': {
      return {
        projectId: (_args as Record<string, Record<string, string>>)?.req?.projectId ?? 'mock-id',
        removedSourceId: (_args as Record<string, Record<string, string>>)?.req?.projectSourceId ?? 'mock-src',
        auditId: 'mock-audit-id',
      } as T;
    }
    case 'projects_channels_reinfer': {
      return {
        projectId: (_args as Record<string, Record<string, string>>)?.req?.projectId ?? 'mock-id',
        channels: [],
        auditId: 'mock-audit-id',
        updatedAt: new Date().toISOString(),
      } as T;
    }
    case 'projects_channels_dismiss_drift': {
      return {
        projectId: (_args as Record<string, Record<string, string>>)?.req?.projectId ?? 'mock-id',
        auditId: 'mock-audit-id',
        dismissedAt: new Date().toISOString(),
      } as T;
    }
    case 'plans_list': {
      const { plans } = await import('@/data/fixtures/plans');
      return plans as T;
    }
    case 'plans_get': {
      const { planDetail } = await import('@/data/fixtures/plans');
      return planDetail as T;
    }
    case 'audit_list': {
      return { entries: mockAuditEntries, total: mockAuditEntries.length } as T;
    }
    case 'audit_export': {
      return mockAuditEntries.map((e) => JSON.stringify(e)).join('\n') as T;
    }
    case 'log_recent': {
      const { MOCK_LOG_ENTRIES } = await import('@/data/mockLogEntries');
      return {
        contractVersion: '1',
        entries: MOCK_LOG_ENTRIES,
        truncated: false,
      } as T;
    }
    case 'log_export': {
      return {
        contractVersion: '1',
        requestId: (_args as Record<string, string>)?.requestId ?? 'mock-req',
        status: 'success',
        filePath: (_args as Record<string, string>)?.filePath ?? '/tmp/log-export.json',
        count: 8,
        bytes: 1024,
      } as T;
    }
    case 'settings_get': {
      return mockSettingsData as T;
    }
    case 'roots_list': {
      return mockRoots as T;
    }
    case 'equipment_list': {
      return mockEquipment as T;
    }
    case 'review_queue': {
      const { reviewItems } = await import('@/data/fixtures/review');
      return reviewItems as T;
    }
    case 'preferences_get': {
      return mockPreferences as T;
    }
    case 'search_global': {
      return mockSearchResults as T;
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
      } as T;
    }

    case 'sessions_transition': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return sessions[0] as T;
    }
    case 'sessions_split': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return { original: sessions[0], new: sessions[1] } as T;
    }
    case 'sessions_merge': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return sessions[0] as T;
    }
    case 'projects_create_plan': {
      const { plans } = await import('@/data/fixtures/plans');
      return plans[0] as T;
    }
    case 'plans_approve': {
      const { plans } = await import('@/data/fixtures/plans');
      return plans[0] as T;
    }
    case 'plans_apply_real': {
      return { operationId: 'op-mock-001', kind: 'plan_apply' } as T;
    }
    case 'plans_discard': {
      return undefined as T;
    }
    case 'settings_update': {
      return undefined as T;
    }
    case 'roots_register': {
      return mockRoots[0] as T;
    }
    case 'roots_remap': {
      return {
        root_id: (_args?.root_id as string) ?? 'root-1',
        original_path: '/old/path',
        new_path: (_args?.new_path as string) ?? '/new/path',
        samples: [
          { relative_path: 'M31/light_001.fits', found: true },
          { relative_path: 'M31/light_002.fits', found: true },
        ],
        all_verified: true,
      } as T;
    }
    case 'roots_remap_apply': {
      return undefined as T;
    }
    case 'scan_start': {
      return { operationId: 'op-scan-001', kind: 'scan' } as T;
    }
    case 'preferences_set': {
      return undefined as T;
    }
    case 'tour_complete_step': {
      return undefined as T;
    }

    // ---------- First-Run / Batch Commands ----------

    case 'roots_register_batch': {
      // Payload is { request: { sources } }; tolerate a legacy top-level shape too.
      const req = (_args?.request as { sources?: Array<{ kind: string; path: string }> }) ?? _args;
      const sources = (req?.sources as Array<{ kind: string; path: string }>) ?? [];
      return {
        results: sources.map((s, i) => ({
          kind: s.kind,
          path: s.path,
          success: true,
          root: { ...mockRoots[i % mockRoots.length], path: s.path, category: s.kind },
        })),
      } as T;
    }
    case 'firstrun_complete': {
      return { success: true } as T;
    }
    case 'firstrun_restart': {
      return {
        success: true,
        prefilled_sources: mockRoots.map((r) => ({ kind: r.category, path: r.path })),
      } as T;
    }
    case 'firstrun_state': {
      return { completed: false } as T;
    }

    // ── Inbox commands (spec 005 + 039) ───────────────────────────────────────
    case 'inbox_list': {
      // Mock: two roots each with unacknowledged items (SC-001 cross-root).
      // Spec 040 P2a: includes individual master items + real format field.
      return {
        items: [
          {
            inboxItemId: 'item-001',
            rootId: 'root-lights-001',
            rootAbsolutePath: '/astro/raw',
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
            rootId: 'root-lights-001',
            rootAbsolutePath: '/astro/raw',
            relativePath: '2025-10-10/darks',
            fileCount: 46,
            lane: 'fits',
            format: 'fits',
            state: 'pending_classification',
            contentSignature: 'sig-def',
            isMaster: false,
          },
          {
            // Individual master item — spec 040 FR-005
            inboxItemId: 'item-master-dark',
            rootId: 'root-lights-001',
            rootAbsolutePath: '/astro/raw',
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
          {
            inboxItemId: 'item-003',
            rootId: 'root-inbox-001',
            rootAbsolutePath: '/astro/inbox',
            relativePath: '2025-11-01/Jupiter',
            fileCount: 3,
            lane: 'video',
            format: 'video',
            state: 'pending_classification',
            contentSignature: 'sig-ghi',
            isMaster: false,
          },
        ],
        capped: false,
        limit: 500,
      } as T;
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
      } as T;
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
      } as T;
    }
    case 'inbox_confirm': {
      return {
        planId: `plan-${Date.now()}`,
        planState: 'ready_for_review',
        itemsTotal: 18,
        registeredAsMaster: false,
      } as T;
    }
    case 'inbox_reclassify': {
      const args = _args as { req: { inboxItemId: string } } | undefined;
      return {
        inboxItemId: args?.req?.inboxItemId ?? 'item-001',
        updatedType: 'single_type',
        frameType: 'light',
        remainingUnclassified: 0,
        appliedCount: 1,
      } as T;
    }

    // ── Inventory commands (spec 006) ─────────────────────────────────────────

    case 'inventory_list': {
      const { INVENTORY_LIST_RESPONSE, INVENTORY_SOURCES } = await import(
        '@/data/fixtures/inventory'
      );
      const req = (_args as { req?: { filters?: { reviewFilter?: string } } } | undefined)?.req;
      const reviewFilter = req?.filters?.reviewFilter;
      // If reviewFilter=ignored, include ignored sessions; otherwise exclude them.
      const sources =
        reviewFilter === 'ignored'
          ? INVENTORY_SOURCES.map((src) => ({
              ...src,
              sessions: src.sessions.filter((s) => s.state === 'ignored'),
            })).filter((src) => src.sessions.length > 0)
          : INVENTORY_LIST_RESPONSE.sources;
      return {
        ...INVENTORY_LIST_RESPONSE,
        sources,
        requestId: req?.filters ? INVENTORY_LIST_RESPONSE.requestId : INVENTORY_LIST_RESPONSE.requestId,
      } as T;
    }

    case 'inventory_session_review': {
      const req = (_args as {
        req?: { sessionId?: string; nextState?: string; requestId?: string };
      } | undefined)?.req;
      const requestId = req?.requestId ?? '00000000-0000-0000-0000-000000000099';
      // Mock: always succeeds (idempotency handled by noop check in real impl).
      return {
        status: 'success',
        contractVersion: '2.0.0',
        requestId,
        appliedAt: new Date().toISOString(),
        entityType: 'acquisition_session',
        priorState: 'needs_review',
        newState: req?.nextState ?? 'confirmed',
        auditId: `audit-${Date.now()}`,
      } as T;
    }

    // ── Developer diagnostics (spec 021) ─────────────────────────────────────

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
      } as T;
    }

    case 'dev_calls_list': {
      return { calls: [] } as T;
    }

    case 'dev_export': {
      return {
        writtenPath: '/tmp/dev-export.json',
        callCount: 0,
        contractCount: 2,
      } as T;
    }

    case 'dev_schema_get': {
      const req = (_args as { request?: { schemaPath?: string } } | undefined)?.request;
      const path = req?.schemaPath ?? '';
      if (!path) {
        return { found: false } as T;
      }
      // Return a minimal stub schema for any non-empty path.
      return {
        found: true,
        content: JSON.stringify({ '$schema': 'https://json-schema.org/draft/2020-12/schema', title: 'mock-schema', description: `Mock schema for ${path}` }, null, 2),
      } as T;
    }

    case 'preparedview_list': {
      return { views: [] } as T;
    }

    case 'preparedview_remove': {
      return { planId: 'mock-plan-remove-001' } as T;
    }

    case 'preparedview_regenerate': {
      return { planId: 'mock-plan-regen-001', unresolvedItemCount: 0 } as T;
    }

    default:
      throw new Error(`Unknown mock command: ${cmd}`);
  }
}
