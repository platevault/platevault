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
} from './types';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Inline fixtures for modules not yet created by T015 ---

const mockAuditEntries: AuditEntry[] = [
  { id: 'audit-001', timestamp: '2026-05-20T22:15:00Z', event_type: 'session.confirmed', entity_type: 'session', entity_id: 'ses-001', from_state: 'needs_review', to_state: 'confirmed', actor: 'user', outcome: 'applied', detail: 'User confirmed session' },
  { id: 'audit-002', timestamp: '2026-05-20T22:10:00Z', event_type: 'plan.approved', entity_type: 'plan', entity_id: 'plan-001', from_state: 'ready_for_review', to_state: 'approved', actor: 'user', outcome: 'applied', detail: 'Plan approved' },
  { id: 'audit-003', timestamp: '2026-05-20T21:45:00Z', event_type: 'plan.applied', entity_type: 'plan', entity_id: 'plan-001', from_state: 'approved', to_state: 'applied', actor: 'system', outcome: 'applied', detail: 'All 12 items applied' },
  { id: 'audit-004', timestamp: '2026-05-19T23:30:00Z', event_type: 'scan.completed', entity_type: 'root', entity_id: 'root-001', actor: 'system', outcome: 'ok', detail: 'Discovered 1,247 files in 4.2s' },
  { id: 'audit-005', timestamp: '2026-05-19T23:25:00Z', event_type: 'scan.started', entity_type: 'root', entity_id: 'root-001', actor: 'user', outcome: 'ok', detail: 'Manual scan triggered' },
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
  { id: 'root-001', path: '/astro/raw', category: 'raw', online: true, file_count: 1247, last_scanned: '2026-05-19T23:30:00Z' },
  { id: 'root-002', path: '/astro/calibration', category: 'calibration', online: true, file_count: 342, last_scanned: '2026-05-19T23:30:00Z' },
  { id: 'root-003', path: '/astro/projects', category: 'project', online: true, file_count: 856, last_scanned: '2026-05-18T20:00:00Z' },
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
  fingerprint: { camera: 'ASI2600MM', sensor_mode: 'normal', exposure_s: 300, temp_c: -10, gain: 100, binning: '1x1' },
  source_session_id: 'cal-ses-001',
  created_at: '2026-05-15T20:00:00Z',
  age_days: 9,
  size_bytes: 52_428_800,
  used_by_session_ids: ['ses-001', 'ses-003'],
  used_by_project_ids: ['proj-001'],
  compatible_sessions: [{ session_id: 'ses-001', score: 0.97, soft_mismatches: [] }],
  usage_stats: { session_count: 2, project_count: 1 },
};

const mockMatchCandidates: MatchCandidate[] = [
  { master_id: 'master-001', kind: 'dark', score: 0.97, soft_mismatches: [] },
  { master_id: 'master-002', kind: 'flat', score: 0.92, filter: 'L', soft_mismatches: ['age > 60 days'] },
  { master_id: 'master-003', kind: 'bias', score: 0.99, soft_mismatches: [] },
];

export async function mockInvoke<T>(
  cmd: string,
  _args?: Record<string, unknown>,
): Promise<T> {
  // Simulate realistic network/IPC latency
  await delay(50 + Math.random() * 100);

  switch (cmd) {
    // ---------- Query Commands ----------

    case 'sessions.list': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return sessions as T;
    }
    case 'sessions.get': {
      const { sessionDetail } = await import('@/data/fixtures/sessions');
      return sessionDetail as T;
    }
    case 'sessions.calendar': {
      return mockCalendarData as T;
    }
    case 'calibration.masters.list': {
      const { masters } = await import('@/data/fixtures/calibration');
      return masters as T;
    }
    case 'calibration.masters.get': {
      return mockMasterDetail as T;
    }
    case 'calibration.matches': {
      return mockMatchCandidates as T;
    }
    case 'targets.list': {
      const { targets } = await import('@/data/fixtures/targets');
      return targets as T;
    }
    case 'targets.get': {
      const { targetDetail } = await import('@/data/fixtures/targets');
      return targetDetail as T;
    }
    case 'projects.list': {
      const { projects } = await import('@/data/fixtures/projects');
      return projects as T;
    }
    case 'projects.get': {
      const { projectDetail } = await import('@/data/fixtures/projects');
      return projectDetail as T;
    }
    case 'plans.list': {
      const { plans } = await import('@/data/fixtures/plans');
      return plans as T;
    }
    case 'plans.get': {
      const { planDetail } = await import('@/data/fixtures/plans');
      return planDetail as T;
    }
    case 'audit.list': {
      return { entries: mockAuditEntries, total: mockAuditEntries.length } as T;
    }
    case 'audit.export': {
      return mockAuditEntries.map((e) => JSON.stringify(e)).join('\n') as T;
    }
    case 'settings.get': {
      return mockSettingsData as T;
    }
    case 'roots.list': {
      return mockRoots as T;
    }
    case 'equipment.list': {
      return mockEquipment as T;
    }
    case 'review.queue': {
      const { reviewItems } = await import('@/data/fixtures/review');
      return reviewItems as T;
    }
    case 'preferences.get': {
      return mockPreferences as T;
    }
    case 'search.global': {
      return mockSearchResults as T;
    }

    // ---------- Mutation Commands ----------

    case 'sessions.transition': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return sessions[0] as T;
    }
    case 'sessions.split': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return { original: sessions[0], new: sessions[1] } as T;
    }
    case 'sessions.merge': {
      const { sessions } = await import('@/data/fixtures/sessions');
      return sessions[0] as T;
    }
    case 'projects.create_plan': {
      const { plans } = await import('@/data/fixtures/plans');
      return plans[0] as T;
    }
    case 'plans.approve': {
      const { plans } = await import('@/data/fixtures/plans');
      return plans[0] as T;
    }
    case 'plans.apply': {
      return { operation_id: 'op-mock-001', kind: 'plan_apply' } as T;
    }
    case 'plans.discard': {
      return undefined as T;
    }
    case 'settings.update': {
      return undefined as T;
    }
    case 'roots.register': {
      return mockRoots[0] as T;
    }
    case 'roots.remap': {
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
    case 'roots.remap.apply': {
      return undefined as T;
    }
    case 'scan.start': {
      return { operation_id: 'op-scan-001', kind: 'scan' } as T;
    }
    case 'preferences.set': {
      return undefined as T;
    }
    case 'tour.complete_step': {
      return undefined as T;
    }

    default:
      throw new Error(`Unknown mock command: ${cmd}`);
  }
}
