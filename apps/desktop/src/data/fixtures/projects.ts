// Static mock fixture data for Project and ProjectDetail
// Matches design V3 mock data.

import type {
  Project,
  ProjectDetail,
  ProjectSource,
  ProjectSourceView,
  ProjectOutput,
  ProjectArtifactGroup,
} from '@/bindings/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function uuid(suffix: string): string {
  return `550e8400-e29b-41d4-a716-${suffix}`;
}

// ─── Design V3 flat fixture shape ───────────────────────────────────────────

export interface ProjectFixture {
  id: number;
  name: string;
  state: 'setup_incomplete' | 'ready' | 'prepared' | 'processing' | 'completed' | 'archived' | 'blocked';
  profile: string;
  target: string;
  hours: number;
  size: string;
  views: number;
  outputs: number;
  sources: number;
  blockedReason?: string;
}

export const PROJECTS_DATA: ProjectFixture[] = [
  { id: 1, name: 'IC 1396 · HOO', state: 'prepared', profile: 'PixInsight/WBPP', target: 'IC 1396', hours: 9.3, size: '6.9 GB', views: 1, outputs: 0, sources: 4 },
  { id: 2, name: 'NGC 7000 · HOO', state: 'processing', profile: 'PixInsight/WBPP', target: 'NGC 7000', hours: 7.7, size: '8.4 GB', views: 2, outputs: 4, sources: 7 },
  { id: 3, name: 'NGC 7000 · SHO mosaic', state: 'ready', profile: 'PixInsight/WBPP', target: 'NGC 7000', hours: 12.0, size: '10.2 GB', views: 0, outputs: 0, sources: 5 },
  { id: 4, name: 'M31 · LRGB', state: 'completed', profile: 'PixInsight/WBPP', target: 'M31', hours: 11.8, size: '4.8 GB', views: 1, outputs: 2, sources: 3 },
  { id: 5, name: 'Jupiter 2025-02-03', state: 'completed', profile: 'Planetary', target: 'Jupiter', hours: 0.5, size: '1.8 GB', views: 0, outputs: 3, sources: 2 },
  { id: 6, name: 'untitled-attempt', state: 'blocked', profile: 'PixInsight/WBPP', target: '?', hours: 0, size: '0', views: 0, outputs: 0, sources: 0, blockedReason: 'Missing calibration masters for SII filter' },
  { id: 7, name: 'M31 · 2022 (legacy)', state: 'archived', profile: 'PixInsight/WBPP', target: 'M31', hours: 8.4, size: '3.2 GB', views: 0, outputs: 1, sources: 2 },
];

// ─── Project List ───────────────────────────────────────────────────────────

export const projects: Project[] = [
  {
    id: uuid('440301'),
    name: 'NGC 7000 · HOO',
    workflow_profile_id: 'PixInsight/WBPP',
    root_path: 'D:\\Astrophotography\\Projects\\NGC7000_HOO',
    state: 'processing',
    verification_state: 'has_accepted',
    cleanup_state: { reclaimable_bytes: 2_253_914_931 }, // 2.1 GB
    integration_hours: 7.7,
    target_ids: [uuid('440201')],
    source_map: {
      lights: [uuid('440001'), uuid('440005'), uuid('440006')],
      darks: [uuid('440401')],
      flats: [uuid('440403'), uuid('440404')],
      bias: [uuid('440407')],
      dark_flats: [],
    },
    source_view_ids: [uuid('440601'), uuid('440602')],
    output_ids: [uuid('440701'), uuid('440702b'), uuid('440703b'), uuid('440704b')],
    processing_directory: 'processing/',
    output_directory: 'outputs/',
    updated_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
  {
    id: uuid('440302'),
    name: 'NGC 7000 · SHO mosaic',
    workflow_profile_id: 'PixInsight/WBPP',
    root_path: 'D:\\Astrophotography\\Projects\\NGC7000_SHO',
    state: 'ready',
    verification_state: 'unreviewed',
    cleanup_state: { reclaimable_bytes: 0 },
    integration_hours: 12.0,
    target_ids: [uuid('440201')],
    source_map: {
      lights: [uuid('440010'), uuid('440011'), uuid('440012'), uuid('440013'), uuid('440014')],
      darks: [uuid('440401')],
      flats: [uuid('440403'), uuid('440404'), uuid('440405')],
      bias: [uuid('440407')],
      dark_flats: [],
    },
    source_view_ids: [],
    output_ids: [],
    processing_directory: 'processing/',
    output_directory: 'outputs/',
    updated_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  },
  {
    id: uuid('440303'),
    name: 'M31 · LRGB',
    workflow_profile_id: 'PixInsight/WBPP',
    root_path: 'D:\\Astrophotography\\Projects\\M31_LRGB',
    state: 'completed',
    verification_state: 'has_accepted',
    cleanup_state: { reclaimable_bytes: 5_153_960_755 }, // 4.8 GB
    integration_hours: 11.8,
    target_ids: [uuid('440202')],
    source_map: {
      lights: Array.from({ length: 3 }, (_, i) => uuid(`44002${i}`)),
      darks: [uuid('440406')],
      flats: [uuid('440410'), uuid('440411'), uuid('440412')],
      bias: [uuid('440408')],
      dark_flats: [],
    },
    source_view_ids: [uuid('440620')],
    output_ids: [uuid('440702'), uuid('440703')],
    processing_directory: 'processing/',
    output_directory: 'outputs/',
    updated_at: new Date(Date.now() - 21 * 86_400_000).toISOString(),
  },
  {
    id: uuid('440304'),
    name: 'Jupiter 2025-02-03',
    workflow_profile_id: 'planetary/lunar',
    root_path: 'D:\\Astrophotography\\Projects\\Jupiter_2025-02-03',
    state: 'completed',
    verification_state: 'has_accepted',
    cleanup_state: { reclaimable_bytes: 1_932_735_283 }, // 1.8 GB
    integration_hours: 0.5,
    target_ids: [uuid('440204')],
    source_map: {
      lights: [uuid('440050'), uuid('440051')],
      darks: [],
      flats: [],
      bias: [],
      dark_flats: [],
    },
    source_view_ids: [],
    output_ids: [uuid('440720'), uuid('440721'), uuid('440722')],
    processing_directory: 'processing/',
    output_directory: 'outputs/',
    updated_at: new Date(Date.now() - 90 * 86_400_000).toISOString(),
  },
  {
    id: uuid('440305'),
    name: 'untitled-attempt',
    workflow_profile_id: '—',
    root_path: 'D:\\Astrophotography\\Misc\\untitled',
    state: 'blocked',
    blocked_reason: 'Missing calibration masters for SII filter',
    verification_state: 'unreviewed',
    cleanup_state: { reclaimable_bytes: 0 },
    integration_hours: 0,
    target_ids: [],
    source_map: {
      lights: [],
      darks: [],
      flats: [],
      bias: [],
      dark_flats: [],
    },
    source_view_ids: [],
    output_ids: [],
    processing_directory: '',
    output_directory: '',
    updated_at: new Date(Date.now() - 120 * 86_400_000).toISOString(),
  },
  {
    id: uuid('440306'),
    name: 'IC 1396 · HOO',
    workflow_profile_id: 'PixInsight/WBPP',
    root_path: 'D:\\Astrophotography\\Projects\\IC1396_HOO',
    state: 'prepared',
    verification_state: 'unreviewed',
    cleanup_state: { reclaimable_bytes: 0 },
    integration_hours: 9.3,
    target_ids: [uuid('440203')],
    source_map: {
      lights: [uuid('440040'), uuid('440041'), uuid('440042'), uuid('440043')],
      darks: [uuid('440401')],
      flats: [uuid('440403'), uuid('440404')],
      bias: [uuid('440407')],
      dark_flats: [],
    },
    source_view_ids: [uuid('440630')],
    output_ids: [],
    processing_directory: 'processing/',
    output_directory: 'outputs/',
    updated_at: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: uuid('440307'),
    name: 'M31 · 2022 (legacy)',
    workflow_profile_id: 'PixInsight/WBPP',
    root_path: 'D:\\Astrophotography\\Archive\\M31_2022',
    state: 'archived',
    verification_state: 'has_accepted',
    cleanup_state: { reclaimable_bytes: 0 },
    integration_hours: 8.4,
    target_ids: [uuid('440202')],
    source_map: {
      lights: Array.from({ length: 2 }, (_, i) => uuid(`44003${i}`)),
      darks: [uuid('440420')],
      flats: [uuid('440421'), uuid('440422')],
      bias: [uuid('440423')],
      dark_flats: [],
    },
    source_view_ids: [],
    output_ids: [uuid('440710')],
    processing_directory: 'processing/',
    output_directory: 'outputs/',
    updated_at: new Date(Date.now() - 180 * 86_400_000).toISOString(),
  },
];

// ─── Target names for list display ──────────────────────────────────────────

export const targetNames: Record<string, string> = {
  [uuid('440201')]: 'NGC 7000',
  [uuid('440202')]: 'M31',
  [uuid('440203')]: 'IC 1396',
  [uuid('440204')]: 'Jupiter',
};

// ─── Project Detail — NGC 7000 HOO (processing) ────────────────────────────

const ngc7000Sources: ProjectSource[] = [
  { role: 'light', name: 'NGC 7000 · Ha · 2024-11-30', frames: 54, hours: '4.5h', selection: 'selected' },
  { role: 'light', name: 'NGC 7000 · OIII · 2024-11-30', frames: 38, hours: '3.2h', selection: 'selected' },
  { role: 'light', name: 'NGC 7000 · Ha · 2024-12-15', frames: 30, hours: '2.5h', selection: 'candidate', warning: 'newer, review' },
  { role: 'dark', name: 'MasterDark_300s_-10C_g100', frames: 1, hours: '—', selection: 'selected' },
  { role: 'flat', name: 'MasterFlat_Ha_2024-11', frames: 1, hours: '—', selection: 'selected' },
  { role: 'flat', name: 'MasterFlat_OIII_2024-11', frames: 1, hours: '—', selection: 'selected' },
  { role: 'bias', name: 'MasterBias_g100', frames: 1, hours: '—', selection: 'candidate', warning: 'age > 90d' },
];

const ngc7000Views: ProjectSourceView[] = [
  { name: 'wbpp_input', strategy: 'junction', link_count: 92, plan_ref: 'plan #18' },
  { name: 'wbpp_input_p2', strategy: 'symlink', link_count: 92, plan_ref: 'plan #21' },
];

const ngc7000Outputs: ProjectOutput[] = [
  { id: uuid('440701'), filename: 'NGC7000_final_v3.tif', kind: 'final image', size_bytes: 536_870_912, date: '2025-02-14', verification: 'accepted', protected: true },
  { id: uuid('440702b'), filename: 'NGC7000_final_v2.tif', kind: 'final image', size_bytes: 522_190_848, date: '2025-01-30', verification: 'superseded', protected: false },
  { id: uuid('440703b'), filename: 'NGC7000_review_starless.tif', kind: 'preview', size_bytes: 503_316_480, date: '2025-02-13', verification: 'unreviewed', protected: false },
  { id: uuid('440704b'), filename: 'NGC7000_drizzle3x.xisf', kind: 'drizzle result', size_bytes: 4_939_212_390, date: '2025-02-12', verification: 'unreviewed', protected: false },
];

const ngc7000Artifacts: ProjectArtifactGroup[] = [
  { type: 'Registered frames', count: 92, total_size_bytes: 12_238_274_560, cleanup_eligibility: 'eligible', confidence: 'high', tool: 'PixInsight', protected: false },
  { type: 'Calibrated frames', count: 92, total_size_bytes: 12_238_274_560, cleanup_eligibility: 'eligible', confidence: 'high', tool: 'PixInsight', protected: false },
  { type: 'Debayered frames', count: 0, total_size_bytes: 0, cleanup_eligibility: 'none', confidence: 'unknown', tool: '—', protected: false },
  { type: 'Local normalized', count: 92, total_size_bytes: 8_804_682_138, cleanup_eligibility: 'eligible', confidence: 'high', tool: 'PixInsight', protected: false },
  { type: 'Drizzle data', count: 14, total_size_bytes: 922_746_880, cleanup_eligibility: 'eligible', confidence: 'high', tool: 'PixInsight', protected: false },
  { type: 'Integration cache', count: 6, total_size_bytes: 440_401_920, cleanup_eligibility: 'eligible', confidence: 'high', tool: 'PixInsight', protected: false },
  { type: 'Temporary files', count: 4, total_size_bytes: 268_435_456, cleanup_eligibility: 'eligible', confidence: 'medium', tool: '?', protected: false },
  { type: 'Logs', count: 8, total_size_bytes: 4_404_019, cleanup_eligibility: 'archive', confidence: 'high', tool: 'PixInsight', protected: false },
  { type: 'Process icons', count: 6, total_size_bytes: 12_288, cleanup_eligibility: 'keep', confidence: 'high', tool: 'PixInsight', protected: true },
  { type: 'Tool project files (.pxi)', count: 1, total_size_bytes: 8_192, cleanup_eligibility: 'keep', confidence: 'confirmed', tool: 'PixInsight', protected: true },
  { type: 'Manual notes (.md)', count: 2, total_size_bytes: 4_096, cleanup_eligibility: 'keep', confidence: 'high', tool: '—', protected: true },
  { type: 'Unknown', count: 3, total_size_bytes: 1_258_291, cleanup_eligibility: 'none', confidence: 'low', tool: '?', protected: false, warning: 'needs classification' },
];

export const projectDetail: ProjectDetail = {
  ...projects[0],
  targets: ['NGC 7000 (primary)'],
  sources: ngc7000Sources,
  source_views: ngc7000Views,
  outputs: ngc7000Outputs,
  artifacts: ngc7000Artifacts,
  lifecycle_stage_index: 3, // processing
  audit_count: 47,
  plan_count: 18,
  cleanup_bytes: 2_253_914_931,
  cleanup_label: '2.1 GB',
  total_integration_label: '10.2h',
  on_disk_label: '8.4 GB',
  notes_count: 2,
  manifest_count: 3,
};
