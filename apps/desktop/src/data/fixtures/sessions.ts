// Static mock fixture data for AcquisitionSession and SessionDetail
// Types mirror @/bindings/types — inline definitions used until that module is created
// Updated to match design V3 mock data

type SessionState = 'discovered' | 'candidate' | 'needs_review' | 'confirmed' | 'rejected' | 'ignored';
type ConfidenceLevel = 'unknown' | 'low' | 'medium' | 'high' | 'confirmed' | 'rejected';
type ProvenanceOrigin = 'reviewed' | 'inferred' | 'observed' | 'generated' | 'planned' | 'applied';

interface MetaValue {
  value: unknown;
  raw?: string;
  origin: ProvenanceOrigin;
  confidence: ConfidenceLevel;
  evidence_ref?: string;
}

interface SessionKey {
  target: string;
  filter: string;
  binning: number;
  gain: number;
  night: string; // ISO date of the observing night (local sunset date)
}

interface AcquisitionSession {
  id: string;
  session_key: SessionKey;
  state: SessionState;
  confidence: ConfidenceLevel;
  optical_train_id: string;
  frame_count: number;
  total_integration_seconds: number;
  total_size_bytes: number;
  metadata: Record<string, MetaValue>;
  target_ids: string[];
  project_ids: string[];
  warnings: string[];
}

interface Frameset {
  id: string;
  filter: string;
  exposure_s: number;
  frame_count: number;
  accepted_count: number;
  total_integration_seconds: number;
  binning: number;
  gain: number;
  temp_c: number;
}

interface CalibrationMatch {
  master_id: string;
  kind: 'dark' | 'flat' | 'bias';
  score: number;
  is_soft_mismatch: boolean;
  mismatch_reasons: string[];
}

interface HistoryEntry {
  timestamp: string;
  event_type: string;
  from_state?: string;
  to_state?: string;
  actor: 'user' | 'system';
  detail: string;
}

interface SessionDetail extends AcquisitionSession {
  framesets: Frameset[];
  calibration_matches: CalibrationMatch[];
  history: HistoryEntry[];
}

// ─── Design V3 flat fixture shape ───────────────────────────────────────────

export interface SessionFixture {
  id: number;
  target: string;
  filter: string;
  date: string;
  frames: number;
  integration: string;
  size: string;
  state: 'confirmed' | 'needs_review' | 'discovered' | 'candidate' | 'rejected' | 'ignored';
  projects: string[];
}

export const SESSIONS_DATA: SessionFixture[] = [
  { id: 1, target: 'NGC 7000', filter: 'SII', date: '2026-04-18', frames: 14, integration: '2h 20m', size: '936 MB', state: 'confirmed', projects: ['NGC 7000 · HOO'] },
  { id: 2, target: 'NGC 7000', filter: 'OIII', date: '2026-04-15', frames: 22, integration: '2h 30m', size: '1.4 GB', state: 'confirmed', projects: ['NGC 7000 · HOO'] },
  { id: 3, target: 'IC 1396', filter: 'SII', date: '2026-04-14', frames: 18, integration: '1h 48m', size: '1.1 GB', state: 'discovered', projects: [] },
  { id: 4, target: 'NGC 7000', filter: 'Ha', date: '2026-04-12', frames: 54, integration: '4h 30m', size: '3.2 GB', state: 'confirmed', projects: ['NGC 7000 · HOO', 'NGC 7000 · SHO mosaic'] },
  { id: 5, target: 'M31', filter: 'R', date: '2026-03-30', frames: 40, integration: '1h 7m 30s', size: '2.4 GB', state: 'confirmed', projects: ['M31 · LRGB'] },
  { id: 6, target: 'M31', filter: 'L', date: '2026-03-28', frames: 120, integration: '6h 30m', size: '7.2 GB', state: 'needs_review', projects: [] },
  { id: 7, target: 'M31', filter: 'B', date: '2026-03-10', frames: 35, integration: '0h 58m 30s', size: '2.1 GB', state: 'ignored', projects: [] },
  { id: 8, target: 'M42', filter: 'OIII', date: '2026-02-11', frames: 28, integration: '1h 20m', size: '1.7 GB', state: 'rejected', projects: [] },
  { id: 9, target: 'M42', filter: 'Ha', date: '2026-02-10', frames: 45, integration: '3h 45m', size: '2.8 GB', state: 'needs_review', projects: [] },
  { id: 10, target: 'NGC 2244', filter: 'Ha', date: '2026-01-20', frames: 62, integration: '5h 10m', size: '3.6 GB', state: 'confirmed', projects: ['NGC 2244 · HOO'] },
];

// ─── Optical train IDs ───────────────────────────────────────────────────────

const TRAIN_FSQ106_ASI2600 = '550e8400-e29b-41d4-a716-446655440101';
const TRAIN_GT81_ASI533 = '550e8400-e29b-41d4-a716-446655440102';

// ─── Target IDs ─────────────────────────────────────────────────────────────

const TARGET_NGC7000 = '550e8400-e29b-41d4-a716-446655440201';
const TARGET_M31 = '550e8400-e29b-41d4-a716-446655440202';
const TARGET_IC1396 = '550e8400-e29b-41d4-a716-446655440203';
const TARGET_M42 = '550e8400-e29b-41d4-a716-446655440204';
const TARGET_NGC2244 = '550e8400-e29b-41d4-a716-446655440205';

// ─── Project IDs ─────────────────────────────────────────────────────────────

const PROJECT_NGC7000_NB = '550e8400-e29b-41d4-a716-446655440301';
const PROJECT_M31_LRGB = '550e8400-e29b-41d4-a716-446655440302';

export const sessions: AcquisitionSession[] = [
  // --- confirmed (5) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    session_key: {
      target: 'NGC 7000',
      filter: 'SII',
      binning: 1,
      gain: 100,
      night: '2026-04-18',
    },
    state: 'confirmed',
    confidence: 'high',
    optical_train_id: TRAIN_FSQ106_ASI2600,
    frame_count: 14,
    total_integration_seconds: 8400,
    total_size_bytes: 981_467_136,
    metadata: {
      target: { value: 'NGC 7000', raw: 'NGC7000', origin: 'reviewed', confidence: 'confirmed' },
      filter: { value: 'SII', raw: 'SII 6.5nm', origin: 'observed', confidence: 'high' },
      exposure_s: { value: 600, raw: '600', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_NGC7000],
    project_ids: [PROJECT_NGC7000_NB],
    warnings: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    session_key: {
      target: 'NGC 7000',
      filter: 'OIII',
      binning: 1,
      gain: 100,
      night: '2026-04-15',
    },
    state: 'confirmed',
    confidence: 'confirmed',
    optical_train_id: TRAIN_FSQ106_ASI2600,
    frame_count: 22,
    total_integration_seconds: 9000,
    total_size_bytes: 1_503_238_554,
    metadata: {
      target: { value: 'NGC 7000', raw: 'NGC7000', origin: 'reviewed', confidence: 'confirmed' },
      filter: { value: 'OIII', raw: 'OIII 6.5nm', origin: 'reviewed', confidence: 'confirmed' },
      exposure_s: { value: 600, raw: '600', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_NGC7000],
    project_ids: [PROJECT_NGC7000_NB],
    warnings: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    session_key: {
      target: 'IC 1396',
      filter: 'SII',
      binning: 1,
      gain: 100,
      night: '2026-04-14',
    },
    state: 'discovered',
    confidence: 'low',
    optical_train_id: TRAIN_FSQ106_ASI2600,
    frame_count: 18,
    total_integration_seconds: 6480,
    total_size_bytes: 1_181_116_006,
    metadata: {
      target: { value: 'IC 1396', raw: 'IC1396', origin: 'inferred', confidence: 'low', evidence_ref: 'fits.object' },
      filter: { value: 'SII', raw: 'SII 6.5nm', origin: 'observed', confidence: 'high' },
      exposure_s: { value: 360, raw: '360', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_IC1396],
    project_ids: [],
    warnings: ['target confidence low', 'no calibration match found'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    session_key: {
      target: 'NGC 7000',
      filter: 'Ha',
      binning: 1,
      gain: 100,
      night: '2026-04-12',
    },
    state: 'confirmed',
    confidence: 'confirmed',
    optical_train_id: TRAIN_FSQ106_ASI2600,
    frame_count: 54,
    total_integration_seconds: 16200,
    total_size_bytes: 3_435_973_837,
    metadata: {
      target: { value: 'NGC 7000', raw: 'NGC7000', origin: 'reviewed', confidence: 'confirmed' },
      filter: { value: 'Ha', raw: 'Ha 7nm', origin: 'reviewed', confidence: 'confirmed' },
      exposure_s: { value: 300, raw: '300', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_NGC7000],
    project_ids: [PROJECT_NGC7000_NB, '550e8400-e29b-41d4-a716-446655440303'],
    warnings: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
    session_key: {
      target: 'M31',
      filter: 'R',
      binning: 1,
      gain: 0,
      night: '2026-03-30',
    },
    state: 'confirmed',
    confidence: 'high',
    optical_train_id: TRAIN_GT81_ASI533,
    frame_count: 40,
    total_integration_seconds: 4050,
    total_size_bytes: 2_576_980_378,
    metadata: {
      target: { value: 'M31', raw: 'M31', origin: 'reviewed', confidence: 'confirmed' },
      filter: { value: 'R', raw: 'Red', origin: 'reviewed', confidence: 'confirmed' },
      exposure_s: { value: 101, raw: '101', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_M31],
    project_ids: [PROJECT_M31_LRGB],
    warnings: [],
  },

  // --- needs_review (2) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440006',
    session_key: {
      target: 'M31',
      filter: 'L',
      binning: 1,
      gain: 0,
      night: '2026-03-28',
    },
    state: 'needs_review',
    confidence: 'medium',
    optical_train_id: TRAIN_GT81_ASI533,
    frame_count: 120,
    total_integration_seconds: 23400,
    total_size_bytes: 7_730_941_133,
    metadata: {
      target: { value: 'M31', raw: 'M31', origin: 'observed', confidence: 'high' },
      filter: { value: 'L', raw: 'Luminance', origin: 'inferred', confidence: 'medium', evidence_ref: 'fits.filter' },
      exposure_s: { value: 195, raw: '195', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_M31],
    project_ids: [],
    warnings: ['filter origin is inferred — please verify'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440009',
    session_key: {
      target: 'M42',
      filter: 'Ha',
      binning: 1,
      gain: 100,
      night: '2026-02-10',
    },
    state: 'needs_review',
    confidence: 'medium',
    optical_train_id: TRAIN_FSQ106_ASI2600,
    frame_count: 45,
    total_integration_seconds: 13500,
    total_size_bytes: 3_006_477_107,
    metadata: {
      target: { value: 'M42', raw: 'Orion Nebula', origin: 'inferred', confidence: 'medium', evidence_ref: 'fits.object' },
      filter: { value: 'Ha', raw: 'Ha', origin: 'observed', confidence: 'high' },
      exposure_s: { value: 300, raw: '300', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_M42],
    project_ids: [],
    warnings: ['object name "Orion Nebula" needs alias confirmation'],
  },

  // --- ignored (1) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440007',
    session_key: {
      target: 'M31',
      filter: 'B',
      binning: 1,
      gain: 0,
      night: '2026-03-10',
    },
    state: 'ignored',
    confidence: 'low',
    optical_train_id: TRAIN_GT81_ASI533,
    frame_count: 35,
    total_integration_seconds: 3510,
    total_size_bytes: 2_254_857_830,
    metadata: {
      target: { value: 'M31', raw: 'M31', origin: 'observed', confidence: 'medium' },
      filter: { value: 'B', raw: 'Blue', origin: 'inferred', confidence: 'low' },
      exposure_s: { value: 100, raw: '100', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_M31],
    project_ids: [],
    warnings: ['aborted session — too few frames', 'moon interference'],
  },

  // --- rejected (1) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440008',
    session_key: {
      target: 'M42',
      filter: 'OIII',
      binning: 1,
      gain: 100,
      night: '2026-02-11',
    },
    state: 'rejected',
    confidence: 'rejected',
    optical_train_id: TRAIN_FSQ106_ASI2600,
    frame_count: 28,
    total_integration_seconds: 4800,
    total_size_bytes: 1_825_361_101,
    metadata: {
      target: { value: 'M42', raw: 'M42', origin: 'observed', confidence: 'high' },
      filter: { value: 'OIII', raw: 'OIII', origin: 'observed', confidence: 'high' },
      exposure_s: { value: 171, raw: '171', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_M42],
    project_ids: [],
    warnings: ['high cloud cover during capture', 'star FWHM > 6 arcsec'],
  },

  // --- confirmed (1 more) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440010',
    session_key: {
      target: 'NGC 2244',
      filter: 'Ha',
      binning: 1,
      gain: 100,
      night: '2026-01-20',
    },
    state: 'confirmed',
    confidence: 'confirmed',
    optical_train_id: TRAIN_FSQ106_ASI2600,
    frame_count: 62,
    total_integration_seconds: 18600,
    total_size_bytes: 3_865_470_566,
    metadata: {
      target: { value: 'NGC 2244', raw: 'NGC2244', origin: 'reviewed', confidence: 'confirmed' },
      filter: { value: 'Ha', raw: 'Ha 7nm', origin: 'reviewed', confidence: 'confirmed' },
      exposure_s: { value: 300, raw: '300', origin: 'observed', confidence: 'high' },
    },
    target_ids: [TARGET_NGC2244],
    project_ids: [],
    warnings: [],
  },
];

// Full session detail for the first confirmed NGC 7000 OIII session
export const sessionDetail: SessionDetail = {
  ...sessions[1], // 550e8400-e29b-41d4-a716-446655440002 (confirmed, NGC 7000 OIII)
  framesets: [
    {
      id: '550e8400-e29b-41d4-a716-446655440501',
      filter: 'OIII',
      exposure_s: 600,
      frame_count: 22,
      accepted_count: 21,
      total_integration_seconds: 9000,
      binning: 1,
      gain: 100,
      temp_c: -10,
    },
  ],
  calibration_matches: [
    {
      master_id: '550e8400-e29b-41d4-a716-446655440401',
      kind: 'dark',
      score: 0.97,
      is_soft_mismatch: false,
      mismatch_reasons: [],
    },
    {
      master_id: '550e8400-e29b-41d4-a716-446655440403',
      kind: 'flat',
      score: 0.91,
      is_soft_mismatch: true,
      mismatch_reasons: ['flat age 34 days (threshold: 30)'],
    },
    {
      master_id: '550e8400-e29b-41d4-a716-446655440407',
      kind: 'bias',
      score: 0.99,
      is_soft_mismatch: false,
      mismatch_reasons: [],
    },
  ],
  history: [
    {
      timestamp: '2026-04-15T21:05:00Z',
      event_type: 'session.discovered',
      to_state: 'discovered',
      actor: 'system',
      detail: 'Inbox scan detected 22 new FITS files matching session pattern',
    },
    {
      timestamp: '2026-04-15T21:06:00Z',
      event_type: 'session.candidate',
      from_state: 'discovered',
      to_state: 'candidate',
      actor: 'system',
      detail: 'Metadata extraction completed; target and filter resolved',
    },
    {
      timestamp: '2026-04-16T09:12:00Z',
      event_type: 'session.confirmed',
      from_state: 'needs_review',
      to_state: 'confirmed',
      actor: 'user',
      detail: 'Reviewed and confirmed via Review queue',
    },
  ],
};
