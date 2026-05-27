// Static mock fixture data for Target and TargetDetail
// Matches design V3 mock data.

import type {
  Target,
  TargetDetail as TargetDetailType,
  AcquisitionSession,
  ProjectState,
  SessionState,
  ConfidenceLevel,
} from '@/bindings/types';

// ─── Design V3 flat fixture shape ───────────────────────────────────────────

export interface TargetFixture {
  id: number;
  name: string;
  common: string;
  kind: string;
  sessions: number;
  hours: number;
  projects: number;
  warn?: boolean;
}

export const TARGETS_DATA: TargetFixture[] = [
  { id: 1, name: '(unresolved)', common: '', kind: 'unknown', sessions: 3, hours: 4.2, projects: 0, warn: true },
  { id: 2, name: 'IC 1396', common: "Elephant's Trunk", kind: 'deep sky', sessions: 4, hours: 9.3, projects: 1 },
  { id: 3, name: 'Jupiter', common: '', kind: 'planetary', sessions: 6, hours: 2.5, projects: 1 },
  { id: 4, name: 'M31', common: 'Andromeda Galaxy', kind: 'deep sky', sessions: 8, hours: 11.8, projects: 1, warn: true },
  { id: 5, name: 'M42', common: 'Orion Nebula', kind: 'deep sky', sessions: 5, hours: 3.4, projects: 0 },
  { id: 6, name: 'NGC 7000', common: 'North America Nebula', kind: 'deep sky', sessions: 12, hours: 14.2, projects: 2 },
];

// ---------------------------------------------------------------------------
// Rich list items — shown in the left pane (existing shape retained)
// ---------------------------------------------------------------------------

export const targets: Target[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440201',
    name: 'NGC 7000',
    aliases: ['North America Nebula', 'Caldwell 20'],
    catalog_ids: { ngc: '7000' },
    kind: 'deep_sky',
    coordinates: { ra: 20.983, dec: 44.517 },
    session_count: 12,
    project_count: 2,
    total_integration_hours: 14.2,
    coverage: { Ha: 6.3, OIII: 4.8, SII: 1.8, L: 0 },
    recommended_hours: { Ha: 6.0, OIII: 5.0, SII: 3.0, L: 0 },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440202',
    name: 'M31',
    aliases: ['Andromeda Galaxy'],
    catalog_ids: { messier: '31', ngc: '224' },
    kind: 'deep_sky',
    coordinates: { ra: 0.712, dec: 41.27 },
    session_count: 8,
    project_count: 1,
    total_integration_hours: 11.8,
    coverage: { L: 5.2, R: 3.1, G: 1.8, B: 1.7 },
    recommended_hours: { L: 6.0, R: 3.0, G: 3.0, B: 3.0 },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440203',
    name: 'IC 1396',
    aliases: ["Elephant's Trunk"],
    catalog_ids: { ic: '1396' },
    kind: 'deep_sky',
    coordinates: { ra: 21.62, dec: 57.5 },
    session_count: 4,
    project_count: 1,
    total_integration_hours: 9.3,
    coverage: { Ha: 5.1, OIII: 4.2 },
    recommended_hours: { Ha: 6.0, OIII: 6.0 },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440204',
    name: 'Jupiter',
    aliases: [],
    catalog_ids: {},
    kind: 'planetary',
    coordinates: {},
    session_count: 6,
    project_count: 1,
    total_integration_hours: 2.5,
    coverage: {},
    recommended_hours: {},
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440205',
    name: 'M42',
    aliases: ['Orion Nebula'],
    catalog_ids: { messier: '42', ngc: '1976' },
    kind: 'deep_sky',
    coordinates: { ra: 5.588, dec: -5.39 },
    session_count: 5,
    project_count: 0,
    total_integration_hours: 3.4,
    coverage: { Ha: 3.4 },
    recommended_hours: { Ha: 4.0 },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440206',
    name: '(unresolved)',
    aliases: [],
    catalog_ids: {},
    kind: 'deep_sky',
    coordinates: {},
    session_count: 3,
    project_count: 0,
    total_integration_hours: 4.2,
    coverage: { Ha: 4.2 },
    recommended_hours: { Ha: 4.0 },
  },
];

// ---------------------------------------------------------------------------
// Detail — the full NGC 7000 detail matching the wireframe
// ---------------------------------------------------------------------------

export const targetDetail: TargetDetailType = {
  ...targets[0],
  sessions: [
    {
      id: 's-001',
      session_key: { target: 'NGC 7000', filter: 'Ha', binning: '1x1', gain: '100', night: '2024-11-30' },
      state: 'confirmed' as SessionState,
      confidence: 'confirmed' as ConfidenceLevel,
      optical_train_id: 'ot-2600mm',
      frame_count: 54,
      total_integration_seconds: 16200,
      total_size_bytes: 0,
      metadata: {},
      target_ids: ['550e8400-e29b-41d4-a716-446655440201'],
      project_ids: ['proj-hoo'],
      warnings: [],
    },
    {
      id: 's-002',
      session_key: { target: 'NGC 7000', filter: 'OIII', binning: '1x1', gain: '100', night: '2024-11-30' },
      state: 'confirmed' as SessionState,
      confidence: 'confirmed' as ConfidenceLevel,
      optical_train_id: 'ot-2600mm',
      frame_count: 38,
      total_integration_seconds: 11520,
      total_size_bytes: 0,
      metadata: {},
      target_ids: ['550e8400-e29b-41d4-a716-446655440201'],
      project_ids: ['proj-hoo'],
      warnings: [],
    },
    {
      id: 's-003',
      session_key: { target: 'NGC 7000', filter: 'SII', binning: '1x1', gain: '100', night: '2024-12-01' },
      state: 'needs_review' as SessionState,
      confidence: 'high' as ConfidenceLevel,
      optical_train_id: 'ot-2600mm',
      frame_count: 22,
      total_integration_seconds: 6480,
      total_size_bytes: 0,
      metadata: {},
      target_ids: ['550e8400-e29b-41d4-a716-446655440201'],
      project_ids: [],
      warnings: [],
    },
    {
      id: 's-004',
      session_key: { target: 'NGC 7000', filter: 'Ha', binning: '1x1', gain: '100', night: '2024-12-15' },
      state: 'confirmed' as SessionState,
      confidence: 'confirmed' as ConfidenceLevel,
      optical_train_id: 'ot-2600mm',
      frame_count: 30,
      total_integration_seconds: 9000,
      total_size_bytes: 0,
      metadata: {},
      target_ids: ['550e8400-e29b-41d4-a716-446655440201'],
      project_ids: ['proj-sho'],
      warnings: [],
    },
  ],
  projects: [
    { id: 'proj-hoo', name: 'NGC 7000 · HOO', state: 'processing' as ProjectState },
    { id: 'proj-sho', name: 'NGC 7000 · SHO mosaic', state: 'ready' as ProjectState },
  ],
};
