// Static mock fixture data for CalibrationMaster
// Types mirror @/api/types — inline definitions used until that module is created

type CalibrationKind = 'dark' | 'flat' | 'bias' | 'dark_flat' | 'bad_pixel_map';

interface CalibrationFingerprint {
  camera: string;
  sensor_mode: string;
  exposure_s: number;
  temp_c: number;
  gain: number;
  binning: number;
  filter?: string;
}

interface CalibrationMaster {
  id: string;
  kind: CalibrationKind;
  fingerprint: CalibrationFingerprint;
  source_session_id: string;
  created_at: string; // ISO date
  age_days: number;
  size_bytes: number;
  used_by_session_ids: string[];
  used_by_project_ids: string[];
}

// Session IDs referenced
const SRC_SESSION_DARKS_A = '550e8400-e29b-41d4-a716-446655441001';
const SRC_SESSION_FLATS_A = '550e8400-e29b-41d4-a716-446655441002';
const SRC_SESSION_BIAS_A = '550e8400-e29b-41d4-a716-446655441003';

export const masters: CalibrationMaster[] = [
  // --- darks (3) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440401',
    kind: 'dark',
    fingerprint: {
      camera: 'ZWO ASI2600MM Pro',
      sensor_mode: 'High Gain',
      exposure_s: 600,
      temp_c: -15,
      gain: 100,
      binning: 1,
    },
    source_session_id: SRC_SESSION_DARKS_A,
    created_at: '2026-04-10T22:00:00Z',
    age_days: 14,
    size_bytes: 524_288_000,
    used_by_session_ids: [
      '550e8400-e29b-41d4-a716-446655440005',
      '550e8400-e29b-41d4-a716-446655440006',
      '550e8400-e29b-41d4-a716-446655440001',
    ],
    used_by_project_ids: ['550e8400-e29b-41d4-a716-446655440301'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440402',
    kind: 'dark',
    fingerprint: {
      camera: 'ZWO ASI2600MM Pro',
      sensor_mode: 'High Gain',
      exposure_s: 600,
      temp_c: -15,
      gain: 100,
      binning: 1,
    },
    source_session_id: SRC_SESSION_DARKS_A,
    // Aged: 100 days — triggers aging warning in UI
    created_at: '2026-01-14T22:00:00Z',
    age_days: 100,
    size_bytes: 524_288_000,
    used_by_session_ids: ['550e8400-e29b-41d4-a716-446655440008'],
    used_by_project_ids: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440406',
    kind: 'dark',
    fingerprint: {
      camera: 'ZWO ASI533MC Pro',
      sensor_mode: 'Standard',
      exposure_s: 90,
      temp_c: -10,
      gain: 0,
      binning: 1,
    },
    source_session_id: SRC_SESSION_DARKS_A,
    // Aged: 95 days — triggers aging warning
    created_at: '2026-01-19T22:00:00Z',
    age_days: 95,
    size_bytes: 310_000_000,
    used_by_session_ids: [
      '550e8400-e29b-41d4-a716-446655440003',
      '550e8400-e29b-41d4-a716-446655440007',
    ],
    used_by_project_ids: ['550e8400-e29b-41d4-a716-446655440302'],
  },

  // --- flats (3) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440403',
    kind: 'flat',
    fingerprint: {
      camera: 'ZWO ASI2600MM Pro',
      sensor_mode: 'High Gain',
      exposure_s: 2,
      temp_c: 0, // flats at ambient
      gain: 100,
      binning: 1,
      filter: 'OIII',
    },
    source_session_id: SRC_SESSION_FLATS_A,
    created_at: '2026-03-16T18:30:00Z',
    age_days: 39,
    size_bytes: 156_000_000,
    used_by_session_ids: ['550e8400-e29b-41d4-a716-446655440005'],
    used_by_project_ids: ['550e8400-e29b-41d4-a716-446655440301'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440404',
    kind: 'flat',
    fingerprint: {
      camera: 'ZWO ASI2600MM Pro',
      sensor_mode: 'High Gain',
      exposure_s: 2,
      temp_c: 0,
      gain: 100,
      binning: 1,
      filter: 'Ha',
    },
    source_session_id: SRC_SESSION_FLATS_A,
    created_at: '2026-04-01T18:30:00Z',
    age_days: 23,
    size_bytes: 156_000_000,
    used_by_session_ids: [
      '550e8400-e29b-41d4-a716-446655440001',
      '550e8400-e29b-41d4-a716-446655440004',
      '550e8400-e29b-41d4-a716-446655440008',
    ],
    used_by_project_ids: ['550e8400-e29b-41d4-a716-446655440301'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440405',
    kind: 'flat',
    fingerprint: {
      camera: 'ZWO ASI533MC Pro',
      sensor_mode: 'Standard',
      exposure_s: 1,
      temp_c: 0,
      gain: 0,
      binning: 1,
      filter: 'L',
    },
    source_session_id: SRC_SESSION_FLATS_A,
    created_at: '2026-03-20T18:45:00Z',
    age_days: 35,
    size_bytes: 96_000_000,
    used_by_session_ids: [
      '550e8400-e29b-41d4-a716-446655440003',
      '550e8400-e29b-41d4-a716-446655440007',
    ],
    used_by_project_ids: ['550e8400-e29b-41d4-a716-446655440302'],
  },

  // --- bias (2) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440407',
    kind: 'bias',
    fingerprint: {
      camera: 'ZWO ASI2600MM Pro',
      sensor_mode: 'High Gain',
      exposure_s: 0.001,
      temp_c: -15,
      gain: 100,
      binning: 1,
    },
    source_session_id: SRC_SESSION_BIAS_A,
    created_at: '2026-04-10T21:00:00Z',
    age_days: 14,
    size_bytes: 52_428_800,
    used_by_session_ids: [
      '550e8400-e29b-41d4-a716-446655440005',
      '550e8400-e29b-41d4-a716-446655440006',
      '550e8400-e29b-41d4-a716-446655440001',
      '550e8400-e29b-41d4-a716-446655440004',
      '550e8400-e29b-41d4-a716-446655440008',
    ],
    used_by_project_ids: ['550e8400-e29b-41d4-a716-446655440301'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440408',
    kind: 'bias',
    fingerprint: {
      camera: 'ZWO ASI533MC Pro',
      sensor_mode: 'Standard',
      exposure_s: 0.001,
      temp_c: -10,
      gain: 0,
      binning: 1,
    },
    source_session_id: SRC_SESSION_BIAS_A,
    created_at: '2026-03-19T21:00:00Z',
    age_days: 36,
    size_bytes: 32_000_000,
    used_by_session_ids: [
      '550e8400-e29b-41d4-a716-446655440003',
      '550e8400-e29b-41d4-a716-446655440007',
      '550e8400-e29b-41d4-a716-446655440010',
    ],
    used_by_project_ids: ['550e8400-e29b-41d4-a716-446655440302'],
  },
];
