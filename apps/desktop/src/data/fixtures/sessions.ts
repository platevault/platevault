// Static mock fixture data for AcquisitionSession and SessionDetail
// Types mirror @/bindings/types — inline definitions used until that module is created

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

// Optical train IDs
const TRAIN_FSQ106_ASI2600 = '550e8400-e29b-41d4-a716-446655440101';
const TRAIN_GT81_ASI533 = '550e8400-e29b-41d4-a716-446655440102';

// Target IDs
const TARGET_NGC7000 = '550e8400-e29b-41d4-a716-446655440201';
const TARGET_M31 = '550e8400-e29b-41d4-a716-446655440202';
const TARGET_IC1396 = '550e8400-e29b-41d4-a716-446655440203';
const TARGET_M42 = '550e8400-e29b-41d4-a716-446655440204';
const TARGET_NGC2244 = '550e8400-e29b-41d4-a716-446655440205';

// Project IDs
const PROJECT_NGC7000_NB = '550e8400-e29b-41d4-a716-446655440301';
const PROJECT_M31_LRGB = '550e8400-e29b-41d4-a716-446655440302';

export const sessions: AcquisitionSession[] = [
  // --- discovered (2) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    session_key: {
      target: 'NGC 7000',
      filter: 'Ha',
      binning: 1,
      gain: 100,
      night: '2026-04-12',
    },
    state: 'discovered',
    confidence: 'unknown',
    optical_train_id: TRAIN_FSQ106_ASI2600,
    frame_count: 18,
    total_integration_seconds: 10800,
    total_size_bytes: 1_258_291_200,
    metadata: {
      target: {
        value: 'NGC 7000',
        raw: 'NGC7000',
        origin: 'observed',
        confidence: 'medium',
      },
      filter: {
        value: 'Ha',
        raw: 'H-alpha 7nm',
        origin: 'observed',
        confidence: 'high',
      },
      exposure_s: {
        value: 600,
        raw: '600',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_NGC7000],
    project_ids: [],
    warnings: ['target not yet confirmed'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
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
    frame_count: 12,
    total_integration_seconds: 7200,
    total_size_bytes: 838_860_800,
    metadata: {
      target: {
        value: 'IC 1396',
        raw: 'IC1396',
        origin: 'inferred',
        confidence: 'low',
        evidence_ref: 'fits.object',
      },
      filter: {
        value: 'SII',
        raw: 'SII 6.5nm',
        origin: 'observed',
        confidence: 'high',
      },
      exposure_s: {
        value: 600,
        raw: '600',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_IC1396],
    project_ids: [],
    warnings: ['target confidence low', 'no calibration match found'],
  },

  // --- needs_review (2) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
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
    frame_count: 60,
    total_integration_seconds: 5400,
    total_size_bytes: 2_147_483_648,
    metadata: {
      target: {
        value: 'M31',
        raw: 'M31',
        origin: 'observed',
        confidence: 'high',
      },
      filter: {
        value: 'L',
        raw: 'Luminance',
        origin: 'inferred',
        confidence: 'medium',
        evidence_ref: 'fits.filter',
      },
      exposure_s: {
        value: 90,
        raw: '90',
        origin: 'observed',
        confidence: 'high',
      },
      temp_c: {
        value: -10,
        raw: '-10.1',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_M31],
    project_ids: [],
    warnings: ['filter origin is inferred — please verify'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
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
    frame_count: 30,
    total_integration_seconds: 18000,
    total_size_bytes: 2_097_152_000,
    metadata: {
      target: {
        value: 'M42',
        raw: 'Orion Nebula',
        origin: 'inferred',
        confidence: 'medium',
        evidence_ref: 'fits.object',
      },
      filter: {
        value: 'Ha',
        raw: 'Ha',
        origin: 'observed',
        confidence: 'high',
      },
      exposure_s: {
        value: 600,
        raw: '600',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_M42],
    project_ids: [],
    warnings: ['object name "Orion Nebula" needs alias confirmation'],
  },

  // --- confirmed (4) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
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
    frame_count: 15,
    total_integration_seconds: 9000,
    total_size_bytes: 1_048_576_000,
    metadata: {
      target: {
        value: 'NGC 7000',
        raw: 'NGC7000',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      filter: {
        value: 'OIII',
        raw: 'OIII 6.5nm',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      exposure_s: {
        value: 600,
        raw: '600',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_NGC7000],
    project_ids: [PROJECT_NGC7000_NB],
    warnings: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440006',
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
      target: {
        value: 'NGC 7000',
        raw: 'NGC7000',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      filter: {
        value: 'SII',
        raw: 'SII 6.5nm',
        origin: 'observed',
        confidence: 'high',
      },
      exposure_s: {
        value: 600,
        raw: '600',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_NGC7000],
    project_ids: [PROJECT_NGC7000_NB],
    warnings: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440007',
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
    frame_count: 45,
    total_integration_seconds: 4050,
    total_size_bytes: 1_610_612_736,
    metadata: {
      target: {
        value: 'M31',
        raw: 'M31',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      filter: {
        value: 'R',
        raw: 'Red',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      exposure_s: {
        value: 90,
        raw: '90',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_M31],
    project_ids: [PROJECT_M31_LRGB],
    warnings: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440008',
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
    frame_count: 20,
    total_integration_seconds: 12000,
    total_size_bytes: 1_400_000_000,
    metadata: {
      target: {
        value: 'NGC 2244',
        raw: 'NGC2244',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      filter: {
        value: 'Ha',
        raw: 'Ha 7nm',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      exposure_s: {
        value: 600,
        raw: '600',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_NGC2244],
    project_ids: [],
    warnings: [],
  },

  // --- rejected (1) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440009',
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
    frame_count: 8,
    total_integration_seconds: 4800,
    total_size_bytes: 560_000_000,
    metadata: {
      target: {
        value: 'M42',
        raw: 'M42',
        origin: 'observed',
        confidence: 'high',
      },
      filter: {
        value: 'OIII',
        raw: 'OIII',
        origin: 'observed',
        confidence: 'high',
      },
      exposure_s: {
        value: 600,
        raw: '600',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_M42],
    project_ids: [],
    warnings: ['high cloud cover during capture', 'star FWHM > 6 arcsec'],
  },

  // --- ignored (1) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440010',
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
    frame_count: 5,
    total_integration_seconds: 450,
    total_size_bytes: 179_200_000,
    metadata: {
      target: {
        value: 'M31',
        raw: 'M31',
        origin: 'observed',
        confidence: 'medium',
      },
      filter: {
        value: 'B',
        raw: 'Blue',
        origin: 'inferred',
        confidence: 'low',
      },
      exposure_s: {
        value: 90,
        raw: '90',
        origin: 'observed',
        confidence: 'high',
      },
    },
    target_ids: [TARGET_M31],
    project_ids: [],
    warnings: ['aborted session — too few frames', 'moon interference'],
  },
];

// Full session detail for the first confirmed NGC 7000 OIII session
export const sessionDetail: SessionDetail = {
  ...sessions[4], // 550e8400-e29b-41d4-a716-446655440005 (confirmed, NGC 7000 OIII)
  framesets: [
    {
      id: '550e8400-e29b-41d4-a716-446655440501',
      filter: 'OIII',
      exposure_s: 600,
      frame_count: 15,
      accepted_count: 14,
      total_integration_seconds: 8400,
      binning: 1,
      gain: 100,
      temp_c: -15,
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
      detail: 'Inbox scan detected 15 new FITS files matching session pattern',
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
