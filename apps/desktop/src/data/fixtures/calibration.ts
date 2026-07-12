// Static mock fixture data for Calibration page — masters as primary content.
// Matches design V3 mock data.

import type {
  CalibrationKind,
  ConfidenceLevel,
  ProvenanceOrigin,
} from '@/bindings/types';
import type { CalibrationMaster_Serialize } from '@/bindings/index';

// ─── Design V3 flat fixture shape ───────────────────────────────────────────

export interface MasterFixture {
  id: number;
  name: string;
  kind: 'dark' | 'flat' | 'bias';
  exposure: string;
  temp: string;
  gain: number;
  camera: string;
  binning: string;
  age: number;
  size: string;
  sessions: number;
  projects: number;
  aging?: boolean;
}

export const MASTERS_DATA: MasterFixture[] = [
  {
    id: 1,
    name: 'MasterDark_120s_-10C_g100',
    kind: 'dark',
    exposure: '120s',
    temp: '-10°C',
    gain: 100,
    camera: 'ASI2600MM',
    binning: '1×1',
    age: 60,
    size: '128 MB',
    sessions: 1,
    projects: 2,
  },
  {
    id: 2,
    name: 'MasterDark_180s_-10C_g100',
    kind: 'dark',
    exposure: '180s',
    temp: '-10°C',
    gain: 100,
    camera: 'ASI2600MM',
    binning: '1×1',
    age: 45,
    size: '128 MB',
    sessions: 2,
    projects: 3,
  },
  {
    id: 3,
    name: 'MasterDark_300s_-10C_g100',
    kind: 'dark',
    exposure: '300s',
    temp: '-10°C',
    gain: 100,
    camera: 'ASI2600MM',
    binning: '1×1',
    age: 23,
    size: '128 MB',
    sessions: 4,
    projects: 4,
  },
  {
    id: 4,
    name: 'MasterDark_300s_-10C_g100_MC',
    kind: 'dark',
    exposure: '300s',
    temp: '-10°C',
    gain: 100,
    camera: 'ASI2600MC',
    binning: '1×1',
    age: 95,
    size: '256 MB',
    sessions: 1,
    projects: 1,
    aging: true,
  },
  {
    id: 5,
    name: 'MasterFlat_Ha_2024-11',
    kind: 'flat',
    exposure: '3s',
    temp: '--',
    gain: 100,
    camera: 'ASI2600MM',
    binning: '1×1',
    age: 180,
    size: '128 MB',
    sessions: 3,
    projects: 2,
  },
  {
    id: 6,
    name: 'MasterFlat_Ha_2024-12',
    kind: 'flat',
    exposure: '3s',
    temp: '--',
    gain: 100,
    camera: 'ASI2600MM',
    binning: '1×1',
    age: 150,
    size: '128 MB',
    sessions: 2,
    projects: 2,
  },
  {
    id: 7,
    name: 'MasterFlat_L_2024-10',
    kind: 'flat',
    exposure: '2s',
    temp: '--',
    gain: 100,
    camera: 'ASI2600MC',
    binning: '1×1',
    age: 210,
    size: '256 MB',
    sessions: 1,
    projects: 1,
  },
  {
    id: 8,
    name: 'MasterFlat_OIII_2024-11',
    kind: 'flat',
    exposure: '3s',
    temp: '--',
    gain: 100,
    camera: 'ASI2600MM',
    binning: '1×1',
    age: 180,
    size: '128 MB',
    sessions: 2,
    projects: 2,
  },
  {
    id: 9,
    name: 'MasterFlat_OIII_2024-12',
    kind: 'flat',
    exposure: '3s',
    temp: '--',
    gain: 100,
    camera: 'ASI2600MM',
    binning: '1×1',
    age: 150,
    size: '128 MB',
    sessions: 1,
    projects: 1,
  },
  {
    id: 10,
    name: 'MasterBias_g100',
    kind: 'bias',
    exposure: '--',
    temp: '--',
    gain: 100,
    camera: 'ASI2600MM',
    binning: '1×1',
    age: 180,
    size: '128 MB',
    sessions: 8,
    projects: 5,
  },
  {
    id: 11,
    name: 'MasterBias_g100_MC',
    kind: 'bias',
    exposure: '--',
    temp: '--',
    gain: 100,
    camera: 'ASI2600MC',
    binning: '1×1',
    age: 120,
    size: '256 MB',
    sessions: 1,
    projects: 1,
    aging: true,
  },
];

// ─── Rich master list (existing shape retained for detail view) ──────────────

export interface CalibrationMasterFixture {
  id: string;
  name: string;
  kind: CalibrationKind;
  exp: string;
  temp: string;
  gain: string;
  cam: string;
  sessions: number;
  projects: number;
  age: string;
  ageDays: number;
  conf: ConfidenceLevel;
  warn?: 'aging';
  size: string;
}

// ─── CalibrationMaster_Serialize[] — the real contract shape consumed by ────
// useCalibrationMasters → MastersTable.  fingerprint values are derived from
// actual FITS headers in the user's library (READ-ONLY analysis).
//
// Poseidon-C PRO (NINA 3.1.2, Celestron C925 HS, f/2.2, 525mm):
//   INSTRUME=Poseidon-C PRO  GAIN=0 (LUM) / 125 (narrowband)  OFFSET=20
//   XBINNING=1  SET-TEMP=0.0  XPIXSZ=3.76
//
// ZWO ASI2600MM Pro (NINA 3.2.0, Celestron C925, f/7, 1645mm):
//   INSTRUME=ZWO ASI2600MM Pro  GAIN=0  OFFSET=50  XBINNING=1  SET-TEMP=0.0
//   XPIXSZ=3.76  BAYERPAT=NONE (mono)
//
// DWARFIII (DWARFLAB, f/4.83, 150mm):
//   INSTRUME=DWARFIII  GAIN=60  XBINNING=1  DET-TEMP varies (32–45°C ambient)
//   XPIXSZ=2.0  BAYERPAT=RGGB (OSC)
//
// Flat frames (Poseidon-C PRO / NINA): GAIN=0 OFFSET=20 BIN=1 SET-TEMP=0°C
//   FILTER=LUM  EXPTIME≈2.34s (FlatWizard auto-exposure)

export const masters: CalibrationMaster_Serialize[] = [
  // ── Darks (Poseidon-C PRO, GAIN=125, narrowband mode) ────────────────────
  {
    // dark_exp_120s_gain_125_bin_1 (real: Poseidon-C PRO library)
    id: 'm-1',
    kind: 'dark',
    fingerprint: {
      camera: 'Poseidon-C PRO',
      sensorMode: 'Low Noise',
      exposureS: 120,
      tempC: 0,
      gain: 125,
      binning: '1x1',
      filter: null,
    },
    sourceSessionId: 'cal-ses-001',
    createdAt: '2025-10-19T02:00:00Z',
    ageDays: 245,
    sizeBytes: 156_237_824,
    usedBySessionIds: ['550e8400-e29b-41d4-a716-446655440001'],
    usedByProjectIds: ['550e8400-e29b-41d4-a716-446655440301'],
  },
  {
    // dark_exp_180s_gain_125_bin_1 (real: Poseidon-C PRO library)
    id: 'm-2',
    kind: 'dark',
    fingerprint: {
      camera: 'Poseidon-C PRO',
      sensorMode: 'Low Noise',
      exposureS: 180,
      tempC: 0,
      gain: 125,
      binning: '1x1',
      filter: null,
    },
    sourceSessionId: 'cal-ses-002',
    createdAt: '2025-10-18T03:00:00Z',
    ageDays: 246,
    sizeBytes: 156_237_824,
    usedBySessionIds: [
      '550e8400-e29b-41d4-a716-446655440002',
      '550e8400-e29b-41d4-a716-446655440004',
    ],
    usedByProjectIds: [
      '550e8400-e29b-41d4-a716-446655440301',
      '550e8400-e29b-41d4-a716-446655440302',
    ],
  },
  {
    // dark_exp_300s_gain_125_bin_1 — primary narrowband dark master
    id: 'm-3',
    kind: 'dark',
    fingerprint: {
      camera: 'Poseidon-C PRO',
      sensorMode: 'Low Noise',
      exposureS: 300,
      tempC: 0,
      gain: 125,
      binning: '1x1',
      filter: null,
    },
    sourceSessionId: 'cal-ses-003',
    createdAt: '2026-02-21T21:00:00Z',
    ageDays: 120,
    sizeBytes: 156_237_824,
    usedBySessionIds: [
      '550e8400-e29b-41d4-a716-446655440001',
      '550e8400-e29b-41d4-a716-446655440003',
      '550e8400-e29b-41d4-a716-446655440009',
    ],
    usedByProjectIds: [
      '550e8400-e29b-41d4-a716-446655440301',
      '550e8400-e29b-41d4-a716-446655440302',
      '550e8400-e29b-41d4-a716-446655440303',
      '550e8400-e29b-41d4-a716-446655440304',
    ],
  },
  {
    // dark_exp_300s_gain_0_bin_1 — broadband / LUM dark master (Poseidon-C PRO, GAIN=0)
    id: 'm-4',
    kind: 'dark',
    fingerprint: {
      camera: 'Poseidon-C PRO',
      sensorMode: 'Low Noise',
      exposureS: 300,
      tempC: 0,
      gain: 0,
      binning: '1x1',
      filter: null,
    },
    sourceSessionId: 'cal-ses-004',
    createdAt: '2025-08-22T23:00:00Z',
    ageDays: 303,
    sizeBytes: 156_237_824,
    usedBySessionIds: ['550e8400-e29b-41d4-a716-446655440005'],
    usedByProjectIds: ['550e8400-e29b-41d4-a716-446655440302'],
  },
  // ── Darks (ZWO ASI2600MM Pro, GAIN=0, mono narrowband) ───────────────────
  {
    // dark_exp_300s_gain_0_bin_1 — ZWO mono camera narrowband dark
    id: 'm-5',
    kind: 'dark',
    fingerprint: {
      camera: 'ZWO ASI2600MM Pro',
      sensorMode: null,
      exposureS: 300,
      tempC: 0,
      gain: 0,
      binning: '1x1',
      filter: null,
    },
    sourceSessionId: 'cal-ses-005',
    createdAt: '2026-05-14T23:00:00Z',
    ageDays: 38,
    sizeBytes: 156_237_824,
    usedBySessionIds: ['550e8400-e29b-41d4-a716-446655440010'],
    usedByProjectIds: [],
  },
  // ── Flats (Poseidon-C PRO, LUM filter, FlatWizard auto-exp ≈ 2.34s) ──────
  {
    // FLAT_LUM_2025-08-23 — GAIN=0, OFFSET=20, BIN=1, SET-TEMP=0°C, EXP=2.34s
    // Source: Calibration/Raw/Flats/Poseidon-C PRO/2025-08-22/LUM/*.fits
    id: 'm-6',
    kind: 'flat',
    fingerprint: {
      camera: 'Poseidon-C PRO',
      sensorMode: 'Low Noise',
      exposureS: 2.34,
      tempC: null,
      gain: 0,
      binning: '1x1',
      filter: 'LUM',
    },
    sourceSessionId: 'cal-ses-006',
    createdAt: '2025-08-22T22:13:09Z',
    ageDays: 303,
    sizeBytes: 49_500_000,
    usedBySessionIds: [
      '550e8400-e29b-41d4-a716-446655440005',
      '550e8400-e29b-41d4-a716-446655440006',
    ],
    usedByProjectIds: ['550e8400-e29b-41d4-a716-446655440301'],
  },
  {
    // FLAT_LUM_2025-10-04 — GAIN=0, OFFSET=20, BIN=1, SET-TEMP=0°C
    // Source: Calibration/Raw/Flats/Poseidon-C PRO/2025-10-04/LUM/*.fits
    id: 'm-7',
    kind: 'flat',
    fingerprint: {
      camera: 'Poseidon-C PRO',
      sensorMode: 'Low Noise',
      exposureS: 2.34,
      tempC: null,
      gain: 0,
      binning: '1x1',
      filter: 'LUM',
    },
    sourceSessionId: 'cal-ses-007',
    createdAt: '2025-10-04T22:00:00Z',
    ageDays: 260,
    sizeBytes: 49_500_000,
    usedBySessionIds: ['550e8400-e29b-41d4-a716-446655440006'],
    usedByProjectIds: ['550e8400-e29b-41d4-a716-446655440302'],
  },
  {
    // FLAT_Ha (Poseidon-C PRO, GAIN=125, narrowband mode)
    // Real NINA Ha flat: auto-exposure ≈ 3s for Ha 3nm
    id: 'm-8',
    kind: 'flat',
    fingerprint: {
      camera: 'Poseidon-C PRO',
      sensorMode: 'Low Noise',
      exposureS: 3.0,
      tempC: null,
      gain: 125,
      binning: '1x1',
      filter: 'Ha',
    },
    sourceSessionId: 'cal-ses-008',
    createdAt: '2025-10-18T22:00:00Z',
    ageDays: 246,
    sizeBytes: 49_500_000,
    usedBySessionIds: [
      '550e8400-e29b-41d4-a716-446655440001',
      '550e8400-e29b-41d4-a716-446655440009',
    ],
    usedByProjectIds: [
      '550e8400-e29b-41d4-a716-446655440301',
      '550e8400-e29b-41d4-a716-446655440302',
    ],
  },
  {
    // FLAT_OIII (Poseidon-C PRO, GAIN=125, narrowband mode)
    id: 'm-9',
    kind: 'flat',
    fingerprint: {
      camera: 'Poseidon-C PRO',
      sensorMode: 'Low Noise',
      exposureS: 3.0,
      tempC: null,
      gain: 125,
      binning: '1x1',
      filter: 'OIII',
    },
    sourceSessionId: 'cal-ses-009',
    createdAt: '2025-10-18T22:30:00Z',
    ageDays: 246,
    sizeBytes: 49_500_000,
    usedBySessionIds: [
      '550e8400-e29b-41d4-a716-446655440002',
      '550e8400-e29b-41d4-a716-446655440008',
    ],
    usedByProjectIds: ['550e8400-e29b-41d4-a716-446655440301'],
  },
  // ── Bias (ZWO ASI2600MM Pro, mono, 0s) ────────────────────────────────────
  {
    // MasterBias — ZWO ASI2600MM Pro, GAIN=0, OFFSET=50, BIN=1
    id: 'm-10',
    kind: 'bias',
    fingerprint: {
      camera: 'ZWO ASI2600MM Pro',
      sensorMode: null,
      exposureS: null,
      tempC: 0,
      gain: 0,
      binning: '1x1',
      filter: null,
    },
    sourceSessionId: 'cal-ses-010',
    createdAt: '2026-05-14T21:00:00Z',
    ageDays: 38,
    sizeBytes: 49_500_000,
    usedBySessionIds: ['550e8400-e29b-41d4-a716-446655440010'],
    usedByProjectIds: [],
  },
  {
    // MasterBias — Poseidon-C PRO, GAIN=0 (LUM mode), OFFSET=20, BIN=1
    id: 'm-11',
    kind: 'bias',
    fingerprint: {
      camera: 'Poseidon-C PRO',
      sensorMode: 'Low Noise',
      exposureS: null,
      tempC: 0,
      gain: 0,
      binning: '1x1',
      filter: null,
    },
    sourceSessionId: 'cal-ses-011',
    createdAt: '2025-10-18T23:00:00Z',
    ageDays: 246,
    sizeBytes: 49_500_000,
    usedBySessionIds: [
      '550e8400-e29b-41d4-a716-446655440005',
      '550e8400-e29b-41d4-a716-446655440006',
      '550e8400-e29b-41d4-a716-446655440007',
      '550e8400-e29b-41d4-a716-446655440008',
    ],
    usedByProjectIds: [
      '550e8400-e29b-41d4-a716-446655440301',
      '550e8400-e29b-41d4-a716-446655440302',
      '550e8400-e29b-41d4-a716-446655440303',
      '550e8400-e29b-41d4-a716-446655440304',
      '550e8400-e29b-41d4-a716-446655440305',
    ],
  },
];

// ─── Detail for the focused master (m-3: MasterDark_300s) ───────────────────

export interface MasterFingerprint {
  k: string;
  v: string;
  prov: ProvenanceOrigin;
}

export interface MasterProvenance {
  k: string;
  v: string;
  prov?: ProvenanceOrigin;
  mono?: boolean;
}

export interface LinkedProject {
  project: string;
  workflowProfile: string;
  lifecycle: string;
  lifecycleVariant: 'info' | 'ghost';
  role: string;
  selectedBy: string;
  selectedAt: string;
}

export interface CompatibleSession {
  check: 'ok' | 'soft';
  session: string;
  frames: number;
  score: number;
  softMismatches: string;
  decision: 'accepted' | 'undecided';
}

export const focusedMaster = {
  id: 'm-3',
  name: 'MasterDark_300s_-10C_g100',
  kind: 'dark' as CalibrationKind,
  conf: 'confirmed' as ConfidenceLevel,
  size: '128 MB',
  path: 'D:\\Astrophotography\\Calibration\\masters\\MasterDark_300s_-10C_g100.xisf',
  sourceSession: 'cal-sess #14',
  sessions: 4,
  projects: 4,
  age: '23d',

  fingerprint: [
    { k: 'Frame type', v: 'dark', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Exposure', v: '300s', prov: 'observed' as ProvenanceOrigin },
    {
      k: 'Sensor temperature',
      v: '−10°C (σ 0.4)',
      prov: 'observed' as ProvenanceOrigin,
    },
    { k: 'Gain', v: '100', prov: 'observed' as ProvenanceOrigin },
    { k: 'Offset', v: '10', prov: 'observed' as ProvenanceOrigin },
    { k: 'Binning', v: '1×1', prov: 'observed' as ProvenanceOrigin },
    { k: 'Camera', v: 'ASI2600MM', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Sensor mode', v: 'Mono', prov: 'inferred' as ProvenanceOrigin },
  ],

  provenance: [
    {
      k: 'Source session',
      v: 'cal-sess #14 · 50 darks → master',
      prov: 'reviewed' as ProvenanceOrigin,
    },
    {
      k: 'Created',
      v: '2025-01-30 02:14',
      prov: 'observed' as ProvenanceOrigin,
    },
    {
      k: 'Created in',
      v: 'PixInsight 1.8.9 · ImageIntegration',
      prov: 'observed' as ProvenanceOrigin,
    },
    {
      k: 'Imported by',
      v: 'user · scan #14',
      prov: 'reviewed' as ProvenanceOrigin,
    },
    {
      k: 'Age',
      v: '23d (still within 90d window)',
      prov: 'generated' as ProvenanceOrigin,
    },
    { k: 'Hash', v: 'sha256:a3f7…2bd1', mono: true },
  ],

  lastUsedProject: 'NGC 7000 · HOO',

  linkedProjects: [
    {
      project: 'NGC 7000 · HOO',
      workflowProfile: 'PixInsight/WBPP',
      lifecycle: 'processing',
      lifecycleVariant: 'info' as const,
      role: 'dark (lights)',
      selectedBy: 'auto-match (score 0.92)',
      selectedAt: '2024-12-02',
    },
    {
      project: 'NGC 7000 · SHO mosaic',
      workflowProfile: 'PixInsight/WBPP',
      lifecycle: 'ready',
      lifecycleVariant: 'ghost' as const,
      role: 'dark (lights)',
      selectedBy: 'auto-match (score 0.92)',
      selectedAt: '2024-12-18',
    },
    {
      project: 'IC 1396 · HOO',
      workflowProfile: 'PixInsight/WBPP',
      lifecycle: 'prepared',
      lifecycleVariant: 'info' as const,
      role: 'dark (lights)',
      selectedBy: 'user override',
      selectedAt: '2024-09-22',
    },
    {
      project: 'M42 · HOO',
      workflowProfile: 'PixInsight/WBPP',
      lifecycle: 'ready',
      lifecycleVariant: 'ghost' as const,
      role: 'dark (lights)',
      selectedBy: 'auto-match (score 0.88)',
      selectedAt: '2024-12-12',
    },
  ] as LinkedProject[],

  compatibleSessions: [
    {
      check: 'ok',
      session: 'NGC 7000 · Ha · 2024-11-30',
      frames: 54,
      score: 0.92,
      softMismatches: '—',
      decision: 'accepted',
    },
    {
      check: 'ok',
      session: 'NGC 7000 · OIII · 2024-11-30',
      frames: 38,
      score: 0.92,
      softMismatches: '—',
      decision: 'accepted',
    },
    {
      check: 'ok',
      session: 'NGC 7000 · SII · 2024-12-01',
      frames: 22,
      score: 0.91,
      softMismatches: '—',
      decision: 'undecided',
    },
    {
      check: 'soft',
      session: 'NGC 7000 · Ha · 2024-12-15',
      frames: 30,
      score: 0.88,
      softMismatches: '−10.3°C vs −10°C (Δ 0.3)',
      decision: 'undecided',
    },
    {
      check: 'soft',
      session: 'IC 1396 · Ha · 2024-09-18',
      frames: 72,
      score: 0.85,
      softMismatches: 'temperature stability',
      decision: 'accepted',
    },
  ] as CompatibleSession[],
};

// ─── Summary counts ─────────────────────────────────────────────────────────

export const calibrationSummary = {
  totalMasters: 11,
  darks: 4,
  flats: 5,
  bias: 2,
  agingCount: 2,
};
