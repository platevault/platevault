// Static mock fixture data for Calibration page — masters as primary content.
// Matches wireframe: calibration.jsx

import type {
  CalibrationKind,
  ConfidenceLevel,
  ProvenanceOrigin,
} from '@/api/types';

// ─── Master list ────────────────────────────────────────────────────────────

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

export const masters: CalibrationMasterFixture[] = [
  { id: 'm-1', name: 'MasterDark_300s_-10C_g100', kind: 'dark', exp: '300s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 2, projects: 4, age: '23d', ageDays: 23, conf: 'confirmed', size: '128 MB' },
  { id: 'm-2', name: 'MasterDark_180s_-10C_g100', kind: 'dark', exp: '180s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 3, projects: 6, age: '23d', ageDays: 23, conf: 'confirmed', size: '128 MB' },
  { id: 'm-3', name: 'MasterDark_120s_-10C_g100', kind: 'dark', exp: '120s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 1, projects: 2, age: '60d', ageDays: 60, conf: 'high', size: '128 MB' },
  { id: 'm-4', name: 'MasterDark_300s_-10C_g100_MC', kind: 'dark', exp: '300s', temp: '−10°C', gain: '100', cam: 'ASI2600MC', sessions: 1, projects: 1, age: '90d', ageDays: 90, conf: 'high', warn: 'aging', size: '128 MB' },
  { id: 'm-5', name: 'MasterFlat_Ha_2024-12', kind: 'flat', exp: '3s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 2, projects: 2, age: '8d', ageDays: 8, conf: 'confirmed', size: '128 MB' },
  { id: 'm-6', name: 'MasterFlat_OIII_2024-12', kind: 'flat', exp: '3s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 2, projects: 2, age: '8d', ageDays: 8, conf: 'confirmed', size: '128 MB' },
  { id: 'm-7', name: 'MasterFlat_Ha_2024-11', kind: 'flat', exp: '3s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 4, projects: 1, age: '37d', ageDays: 37, conf: 'confirmed', size: '128 MB' },
  { id: 'm-8', name: 'MasterFlat_OIII_2024-11', kind: 'flat', exp: '3s', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 3, projects: 1, age: '37d', ageDays: 37, conf: 'confirmed', size: '128 MB' },
  { id: 'm-9', name: 'MasterFlat_L_2024-10', kind: 'flat', exp: '2s', temp: '−10°C', gain: '100', cam: 'ASI2600MC', sessions: 8, projects: 2, age: '50d', ageDays: 50, conf: 'high', size: '128 MB' },
  { id: 'm-10', name: 'MasterBias_g100', kind: 'bias', exp: '—', temp: '−10°C', gain: '100', cam: 'ASI2600MM', sessions: 18, projects: 12, age: '180d', ageDays: 180, conf: 'high', warn: 'aging', size: '64 MB' },
  { id: 'm-11', name: 'MasterBias_g100_MC', kind: 'bias', exp: '—', temp: '−10°C', gain: '100', cam: 'ASI2600MC', sessions: 8, projects: 3, age: '180d', ageDays: 180, conf: 'high', warn: 'aging', size: '64 MB' },
];

// ─── Detail for the focused master (m-1) ────────────────────────────────────

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
  id: 'm-1',
  name: 'MasterDark_300s_-10C_g100',
  kind: 'dark' as CalibrationKind,
  conf: 'confirmed' as ConfidenceLevel,
  size: '128 MB',
  path: 'D:\\Astrophotography\\Calibration\\masters\\MasterDark_300s_-10C_g100.xisf',
  sourceSession: 'cal-sess #14',
  sessions: 2,
  projects: 4,
  age: '23d',

  fingerprint: [
    { k: 'Frame type', v: 'dark', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Exposure', v: '300s', prov: 'observed' as ProvenanceOrigin },
    { k: 'Sensor temperature', v: '−10°C (σ 0.4)', prov: 'observed' as ProvenanceOrigin },
    { k: 'Gain', v: '100', prov: 'observed' as ProvenanceOrigin },
    { k: 'Offset', v: '10', prov: 'observed' as ProvenanceOrigin },
    { k: 'Binning', v: '1×1', prov: 'observed' as ProvenanceOrigin },
    { k: 'Camera', v: 'ASI2600MM', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Sensor mode', v: 'Mono', prov: 'inferred' as ProvenanceOrigin },
  ],

  provenance: [
    { k: 'Source session', v: 'cal-sess #14 · 50 darks → master', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Created', v: '2025-01-30 02:14', prov: 'observed' as ProvenanceOrigin },
    { k: 'Created in', v: 'PixInsight 1.8.9 · ImageIntegration', prov: 'observed' as ProvenanceOrigin },
    { k: 'Imported by', v: 'user · scan #14', prov: 'reviewed' as ProvenanceOrigin },
    { k: 'Age', v: '23d (still within 90d window)', prov: 'generated' as ProvenanceOrigin },
    { k: 'Hash', v: 'sha256:a3f7…2bd1', mono: true },
  ],

  lastUsedProject: 'NGC 7000 · HOO',

  linkedProjects: [
    { project: 'NGC 7000 · HOO', workflowProfile: 'PixInsight/WBPP', lifecycle: 'processing', lifecycleVariant: 'info' as const, role: 'dark (lights)', selectedBy: 'auto-match (score 0.92)', selectedAt: '2024-12-02' },
    { project: 'NGC 7000 · SHO mosaic', workflowProfile: 'PixInsight/WBPP', lifecycle: 'ready', lifecycleVariant: 'ghost' as const, role: 'dark (lights)', selectedBy: 'auto-match (score 0.92)', selectedAt: '2024-12-18' },
    { project: 'IC 1396 · HOO', workflowProfile: 'PixInsight/WBPP', lifecycle: 'prepared', lifecycleVariant: 'info' as const, role: 'dark (lights)', selectedBy: 'user override', selectedAt: '2024-09-22' },
    { project: 'M42 · HOO', workflowProfile: 'PixInsight/WBPP', lifecycle: 'ready', lifecycleVariant: 'ghost' as const, role: 'dark (lights)', selectedBy: 'auto-match (score 0.88)', selectedAt: '2024-12-12' },
  ] as LinkedProject[],

  compatibleSessions: [
    { check: 'ok', session: 'NGC 7000 · Ha · 2024-11-30', frames: 54, score: 0.92, softMismatches: '—', decision: 'accepted' },
    { check: 'ok', session: 'NGC 7000 · OIII · 2024-11-30', frames: 38, score: 0.92, softMismatches: '—', decision: 'accepted' },
    { check: 'ok', session: 'NGC 7000 · SII · 2024-12-01', frames: 22, score: 0.91, softMismatches: '—', decision: 'undecided' },
    { check: 'soft', session: 'NGC 7000 · Ha · 2024-12-15', frames: 30, score: 0.88, softMismatches: '−10.3°C vs −10°C (Δ 0.3)', decision: 'undecided' },
    { check: 'soft', session: 'IC 1396 · Ha · 2024-09-18', frames: 72, score: 0.85, softMismatches: 'temperature stability', decision: 'accepted' },
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
