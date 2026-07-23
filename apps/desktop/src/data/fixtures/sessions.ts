// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Static mock fixture data for AcquisitionSession and SessionDetail
// Types mirror @/bindings/types — inline definitions used until that module is created
// Updated to match design V3 mock data

import type {
  AcquisitionSession_Serialize,
  SessionDetail_Serialize,
} from '@/bindings/index';

/**
 * Display-only metadata used by the Sessions design fixtures (SESSIONS_DATA).
 * Not part of any IPC contract — the wire shapes below come from the generated
 * bindings so mock payloads cannot drift from the backend (#1221).
 */
// ─── Design V3 flat fixture shape ───────────────────────────────────────────

export interface SessionFixture {
  id: number;
  target: string;
  filter: string;
  date: string;
  frames: number;
  integration: string;
  size: string;
  state:
    | 'confirmed'
    | 'needs_review'
    | 'discovered'
    | 'candidate'
    | 'rejected'
    | 'ignored';
  projects: string[];
}

export const SESSIONS_DATA: SessionFixture[] = [
  {
    id: 1,
    target: 'NGC 7000',
    filter: 'SII',
    date: '2026-04-18',
    frames: 14,
    integration: '2h 20m',
    size: '936 MB',
    state: 'confirmed',
    projects: ['NGC 7000 · HOO'],
  },
  {
    id: 2,
    target: 'NGC 7000',
    filter: 'OIII',
    date: '2026-04-15',
    frames: 22,
    integration: '2h 30m',
    size: '1.4 GB',
    state: 'confirmed',
    projects: ['NGC 7000 · HOO'],
  },
  {
    id: 3,
    target: 'IC 1396',
    filter: 'SII',
    date: '2026-04-14',
    frames: 18,
    integration: '1h 48m',
    size: '1.1 GB',
    state: 'discovered',
    projects: [],
  },
  {
    id: 4,
    target: 'NGC 7000',
    filter: 'Ha',
    date: '2026-04-12',
    frames: 54,
    integration: '4h 30m',
    size: '3.2 GB',
    state: 'confirmed',
    projects: ['NGC 7000 · HOO', 'NGC 7000 · SHO mosaic'],
  },
  {
    id: 5,
    target: 'M31',
    filter: 'R',
    date: '2026-03-30',
    frames: 40,
    integration: '1h 7m 30s',
    size: '2.4 GB',
    state: 'confirmed',
    projects: ['M31 · LRGB'],
  },
  {
    id: 6,
    target: 'M31',
    filter: 'L',
    date: '2026-03-28',
    frames: 120,
    integration: '6h 30m',
    size: '7.2 GB',
    state: 'needs_review',
    projects: [],
  },
  {
    id: 7,
    target: 'M31',
    filter: 'B',
    date: '2026-03-10',
    frames: 35,
    integration: '0h 58m 30s',
    size: '2.1 GB',
    state: 'ignored',
    projects: [],
  },
  {
    id: 8,
    target: 'M42',
    filter: 'OIII',
    date: '2026-02-11',
    frames: 28,
    integration: '1h 20m',
    size: '1.7 GB',
    state: 'rejected',
    projects: [],
  },
  {
    id: 9,
    target: 'M42',
    filter: 'Ha',
    date: '2026-02-10',
    frames: 45,
    integration: '3h 45m',
    size: '2.8 GB',
    state: 'needs_review',
    projects: [],
  },
  {
    id: 10,
    target: 'NGC 2244',
    filter: 'Ha',
    date: '2026-01-20',
    frames: 62,
    integration: '5h 10m',
    size: '3.6 GB',
    state: 'confirmed',
    projects: ['NGC 2244 · HOO'],
  },
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

export const sessions: AcquisitionSession_Serialize[] = [
  // --- confirmed (5) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    sessionKey: {
      target: 'NGC 7000',
      filter: 'SII',
      binning: '1',
      gain: '100',
      night: '2026-04-18',
    },
    confidence: 'high',
    opticalTrainId: TRAIN_FSQ106_ASI2600,
    frameCount: 14,
    totalIntegrationSeconds: 8400,
    totalSizeBytes: 981_467_136,
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
    targetIds: [TARGET_NGC7000],
    projectIds: [PROJECT_NGC7000_NB],
    warnings: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    sessionKey: {
      target: 'NGC 7000',
      filter: 'OIII',
      binning: '1',
      gain: '100',
      night: '2026-04-15',
    },
    confidence: 'confirmed',
    opticalTrainId: TRAIN_FSQ106_ASI2600,
    frameCount: 22,
    totalIntegrationSeconds: 9000,
    totalSizeBytes: 1_503_238_554,
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
    targetIds: [TARGET_NGC7000],
    projectIds: [PROJECT_NGC7000_NB],
    warnings: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    sessionKey: {
      target: 'IC 1396',
      filter: 'SII',
      binning: '1',
      gain: '100',
      night: '2026-04-14',
    },
    confidence: 'low',
    opticalTrainId: TRAIN_FSQ106_ASI2600,
    frameCount: 18,
    totalIntegrationSeconds: 6480,
    totalSizeBytes: 1_181_116_006,
    metadata: {
      target: {
        value: 'IC 1396',
        raw: 'IC1396',
        origin: 'inferred',
        confidence: 'low',
        evidenceRef: 'fits.object',
      },
      filter: {
        value: 'SII',
        raw: 'SII 6.5nm',
        origin: 'observed',
        confidence: 'high',
      },
      exposure_s: {
        value: 360,
        raw: '360',
        origin: 'observed',
        confidence: 'high',
      },
    },
    targetIds: [TARGET_IC1396],
    projectIds: [],
    warnings: ['target confidence low', 'no calibration match found'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    sessionKey: {
      target: 'NGC 7000',
      filter: 'Ha',
      binning: '1',
      gain: '100',
      night: '2026-04-12',
    },
    confidence: 'confirmed',
    opticalTrainId: TRAIN_FSQ106_ASI2600,
    frameCount: 54,
    totalIntegrationSeconds: 16200,
    totalSizeBytes: 3_435_973_837,
    metadata: {
      target: {
        value: 'NGC 7000',
        raw: 'NGC7000',
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
        value: 300,
        raw: '300',
        origin: 'observed',
        confidence: 'high',
      },
    },
    targetIds: [TARGET_NGC7000],
    projectIds: [PROJECT_NGC7000_NB, '550e8400-e29b-41d4-a716-446655440303'],
    warnings: [],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
    sessionKey: {
      target: 'M31',
      filter: 'R',
      binning: '1',
      gain: '0',
      night: '2026-03-30',
    },
    confidence: 'high',
    opticalTrainId: TRAIN_GT81_ASI533,
    frameCount: 40,
    totalIntegrationSeconds: 4050,
    totalSizeBytes: 2_576_980_378,
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
        value: 101,
        raw: '101',
        origin: 'observed',
        confidence: 'high',
      },
    },
    targetIds: [TARGET_M31],
    projectIds: [PROJECT_M31_LRGB],
    warnings: [],
  },

  // --- needs_review (2) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440006',
    sessionKey: {
      target: 'M31',
      filter: 'L',
      binning: '1',
      gain: '0',
      night: '2026-03-28',
    },
    confidence: 'medium',
    opticalTrainId: TRAIN_GT81_ASI533,
    frameCount: 120,
    totalIntegrationSeconds: 23400,
    totalSizeBytes: 7_730_941_133,
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
        evidenceRef: 'fits.filter',
      },
      exposure_s: {
        value: 195,
        raw: '195',
        origin: 'observed',
        confidence: 'high',
      },
    },
    targetIds: [TARGET_M31],
    projectIds: [],
    warnings: ['filter origin is inferred — please verify'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440009',
    sessionKey: {
      target: 'M42',
      filter: 'Ha',
      binning: '1',
      gain: '100',
      night: '2026-02-10',
    },
    confidence: 'medium',
    opticalTrainId: TRAIN_FSQ106_ASI2600,
    frameCount: 45,
    totalIntegrationSeconds: 13500,
    totalSizeBytes: 3_006_477_107,
    metadata: {
      target: {
        value: 'M42',
        raw: 'Orion Nebula',
        origin: 'inferred',
        confidence: 'medium',
        evidenceRef: 'fits.object',
      },
      filter: {
        value: 'Ha',
        raw: 'Ha',
        origin: 'observed',
        confidence: 'high',
      },
      exposure_s: {
        value: 300,
        raw: '300',
        origin: 'observed',
        confidence: 'high',
      },
    },
    targetIds: [TARGET_M42],
    projectIds: [],
    warnings: ['object name "Orion Nebula" needs alias confirmation'],
  },

  // --- ignored (1) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440007',
    sessionKey: {
      target: 'M31',
      filter: 'B',
      binning: '1',
      gain: '0',
      night: '2026-03-10',
    },
    confidence: 'low',
    opticalTrainId: TRAIN_GT81_ASI533,
    frameCount: 35,
    totalIntegrationSeconds: 3510,
    totalSizeBytes: 2_254_857_830,
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
        value: 100,
        raw: '100',
        origin: 'observed',
        confidence: 'high',
      },
    },
    targetIds: [TARGET_M31],
    projectIds: [],
    warnings: ['aborted session — too few frames', 'moon interference'],
  },

  // --- rejected (1) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440008',
    sessionKey: {
      target: 'M42',
      filter: 'OIII',
      binning: '1',
      gain: '100',
      night: '2026-02-11',
    },
    confidence: 'rejected',
    opticalTrainId: TRAIN_FSQ106_ASI2600,
    frameCount: 28,
    totalIntegrationSeconds: 4800,
    totalSizeBytes: 1_825_361_101,
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
        value: 171,
        raw: '171',
        origin: 'observed',
        confidence: 'high',
      },
    },
    targetIds: [TARGET_M42],
    projectIds: [],
    warnings: ['high cloud cover during capture', 'star FWHM > 6 arcsec'],
  },

  // --- confirmed (1 more) ---
  {
    id: '550e8400-e29b-41d4-a716-446655440010',
    sessionKey: {
      target: 'NGC 2244',
      filter: 'Ha',
      binning: '1',
      gain: '100',
      night: '2026-01-20',
    },
    confidence: 'confirmed',
    opticalTrainId: TRAIN_FSQ106_ASI2600,
    frameCount: 62,
    totalIntegrationSeconds: 18600,
    totalSizeBytes: 3_865_470_566,
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
        value: 300,
        raw: '300',
        origin: 'observed',
        confidence: 'high',
      },
    },
    targetIds: [TARGET_NGC2244],
    projectIds: [],
    warnings: [],
  },
];

// Full session detail for the first confirmed NGC 7000 OIII session
export const sessionDetail: SessionDetail_Serialize = {
  ...sessions[1], // 550e8400-e29b-41d4-a716-446655440002 (confirmed, NGC 7000 OIII)
  // Frameset/SessionCalibrationMatch/SessionHistoryEntry are far narrower on the
  // wire than the old hand-written fixture assumed; exposure, binning, gain,
  // temperature and per-state history transitions are simply not sent (#1221).
  framesets: [
    {
      filter: 'OIII',
      count: 22,
      integrationS: 9000,
    },
  ],
  calibrationMatches: [
    {
      masterId: '550e8400-e29b-41d4-a716-446655440401',
      kind: 'dark',
      score: 0.97,
      softMismatches: [],
      wasOverride: false,
    },
    {
      masterId: '550e8400-e29b-41d4-a716-446655440403',
      kind: 'flat',
      score: 0.91,
      softMismatches: ['flat age 34 days (threshold: 30)'],
      wasOverride: false,
    },
    {
      masterId: '550e8400-e29b-41d4-a716-446655440407',
      kind: 'bias',
      score: 0.99,
      softMismatches: [],
      wasOverride: false,
    },
  ],
  history: [
    {
      timestamp: '2026-04-15T21:05:00Z',
      event: 'session.discovered',
      actor: 'system',
    },
    {
      timestamp: '2026-04-15T21:06:00Z',
      event: 'session.candidate',
      actor: 'system',
    },
    {
      timestamp: '2026-04-16T09:12:00Z',
      event: 'session.confirmed',
      actor: 'user',
    },
  ],
};
