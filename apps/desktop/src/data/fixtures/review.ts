// Static mock fixture data for the review queue — session-centric.
// Matches design V3 mock data.

import type {
  ReviewItem,
  ConfidenceLevel,
  ProvenanceOrigin,
  MetaValue,
} from '@/bindings/types';

// ─── Design V3 flat fixture shape (Inbox) ───────────────────────────────────

export interface InboxFixture {
  id: number;
  target: string;
  filter: string;
  date: string;
  duration: string;
  size: string;
  frameType: 'light' | 'dark' | 'flat' | 'bias';
  frames: number;
  conflict?: string;
  gain: number;
  exposure: number;
}

export const INBOX_DATA: InboxFixture[] = [
  { id: 1, target: 'IC 1396', filter: 'Ha', date: '2025-10-10', duration: '1h 30m', size: '810 MB', frameType: 'light', frames: 18, conflict: 'Mixed gains: 100, 120', gain: 100, exposure: 300 },
  { id: 2, target: 'M42', filter: 'OIII', date: '2025-10-02', duration: '1h 15m', size: '675 MB', frameType: 'light', frames: 15, gain: 100, exposure: 300 },
  { id: 3, target: 'NGC 7000', filter: 'Ha', date: '2025-09-15', duration: '3h 30m', size: '1.8 GB', frameType: 'light', frames: 42, gain: 100, exposure: 300 },
  { id: 4, target: 'Dark', filter: '', date: '2025-09-15', duration: '4h 10m', size: '2.2 GB', frameType: 'dark', frames: 50, gain: 100, exposure: 300 },
  { id: 5, target: 'Flat', filter: 'Ha', date: '2025-09-15', duration: '0s', size: '1.3 GB', frameType: 'flat', frames: 30, gain: 100, exposure: 3 },
  { id: 6, target: 'Bias', filter: '', date: '2025-09-15', duration: '0s', size: '4.4 GB', frameType: 'bias', frames: 100, gain: 100, exposure: 0 },
  { id: 7, target: 'M31', filter: 'L', date: '2025-09-14', duration: '1h 24m', size: '1.2 GB', frameType: 'light', frames: 28, gain: 100, exposure: 300 },
];

// ─── Queue items (rich review shape, retained) ───────────────────────────────

export const reviewItems: ReviewItem[] = [
  {
    id: 'sess-7',
    kind: 'session',
    session_id: 'sess-7',
    confidence: 'low',
    blocking_reasons: [
      'observer_location needs reviewed provenance before this session can be marked confirmed. Currently inferred from FITS sitelong/sitelat headers.',
    ],
    evidence: {
      target: { value: 'NGC 7000', origin: 'reviewed', confidence: 'confirmed' },
      filter: { value: 'SII (Optolong 7nm)', origin: 'observed', confidence: 'high' },
      binning: { value: '1×1', origin: 'observed', confidence: 'high' },
      gain: { value: '100', origin: 'observed', confidence: 'high' },
      night: { value: '2024-12-01 (local solar noon)', origin: 'inferred', confidence: 'medium' },
      optical_train: { value: 'AT130-EDT + 2600MM', origin: 'reviewed', confidence: 'confirmed' },
      camera: { value: 'ZWO ASI2600MM Pro', origin: 'observed', confidence: 'high' },
      telescope: { value: 'AT130-EDT', origin: 'observed', confidence: 'high' },
      focal_length: { value: '910 mm', origin: 'reviewed', confidence: 'confirmed' },
      observer_location: { value: 'Truckee, CA (inferred from SITELAT/SITELONG)', origin: 'inferred', confidence: 'medium' },
      timezone: { value: 'America/Los_Angeles', origin: 'inferred', confidence: 'medium' },
    },
    suggested_target: 'NGC 7000',
    suggested_filter: 'SII',
  },
  {
    id: 'sess-12',
    kind: 'session',
    session_id: 'sess-12',
    confidence: 'low',
    blocking_reasons: [
      'OBJECT keyword missing on all 22 frames',
    ],
    evidence: {
      target: { value: '(unresolved)', origin: 'inferred', confidence: 'low' },
      filter: { value: 'Unknown', origin: 'inferred', confidence: 'low' },
      night: { value: '2024-12-08', origin: 'observed', confidence: 'high' },
      frame_count: { value: '22', origin: 'observed', confidence: 'high' },
    },
    suggested_target: undefined,
    suggested_filter: undefined,
  },
  {
    id: 'sess-14',
    kind: 'session',
    session_id: 'sess-14',
    confidence: 'medium',
    blocking_reasons: [
      'new night — confirm equipment train',
    ],
    evidence: {
      target: { value: 'NGC 7000', origin: 'reviewed', confidence: 'confirmed' },
      filter: { value: 'Ha', origin: 'observed', confidence: 'high' },
      night: { value: '2024-12-15', origin: 'observed', confidence: 'high' },
    },
    suggested_target: 'NGC 7000',
    suggested_filter: 'Ha',
  },
  {
    id: 'sess-15',
    kind: 'session',
    session_id: 'sess-15',
    confidence: 'medium',
    blocking_reasons: [
      'new night — confirm equipment train',
    ],
    evidence: {
      target: { value: 'NGC 7000', origin: 'reviewed', confidence: 'confirmed' },
      filter: { value: 'OIII', origin: 'observed', confidence: 'high' },
      night: { value: '2024-12-15', origin: 'observed', confidence: 'high' },
    },
    suggested_target: 'NGC 7000',
    suggested_filter: 'OIII',
  },
  {
    id: 'cal-22',
    kind: 'session',
    session_id: 'cal-22',
    confidence: 'medium',
    blocking_reasons: [
      'temperature drift across frames',
    ],
    evidence: {
      target: { value: 'Calibration: Flats Ha', origin: 'observed', confidence: 'high' },
      night: { value: '2024-12-14', origin: 'observed', confidence: 'high' },
    },
    suggested_target: 'Calibration: Flats Ha',
    suggested_filter: 'Ha',
  },
  {
    id: 'sess-31',
    kind: 'session',
    session_id: 'sess-31',
    confidence: 'medium',
    blocking_reasons: [
      'session spans two nights — split?',
    ],
    evidence: {
      target: { value: 'M42', origin: 'reviewed', confidence: 'confirmed' },
      filter: { value: 'Ha', origin: 'observed', confidence: 'high' },
      night: { value: '2024-12-10', origin: 'observed', confidence: 'high' },
    },
    suggested_target: 'M42',
    suggested_filter: 'Ha',
  },
];

// ─── Detail data for the focused session (sess-7) ───────────────────────────

export interface ReviewSessionDetail {
  id: string;
  label: string;
  frameCount: number;
  integrationHours: number;
  opticalTrain: string;
  camera: string;
  sourcePath: string;

  sessionKey: Array<{ k: string; v: string; prov: ProvenanceOrigin }>;
  equipment: Array<{ k: string; v: string; prov: ProvenanceOrigin; conf?: ConfidenceLevel; warn?: boolean }>;
  framesSummary: Array<{ label: string; value: string; warn?: boolean }>;
  calibrationMatches: Array<{ label: string; status: 'match' | 'none' | 'warn'; pill: string }>;
  calibrationNote?: string;
}

export const focusedSession: ReviewSessionDetail = {
  id: 'sess-7',
  label: 'NGC 7000 · SII · 2024-12-01',
  frameCount: 22,
  integrationHours: 1.8,
  opticalTrain: 'AT130-EDT + 2600MM Pro',
  camera: 'ZWO ASI2600MM Pro',
  sourcePath: 'D:\\...\\Raw\\2024-12-01\\NGC7000\\',

  sessionKey: [
    { k: 'Target', v: 'NGC 7000', prov: 'reviewed' },
    { k: 'Filter', v: 'SII (Optolong 7nm)', prov: 'observed' },
    { k: 'Binning', v: '1×1', prov: 'observed' },
    { k: 'Gain', v: '100', prov: 'observed' },
    { k: 'Night', v: '2024-12-01 (local solar noon)', prov: 'inferred' },
    { k: 'Optical train', v: 'AT130-EDT + 2600MM', prov: 'reviewed' },
  ],

  equipment: [
    { k: 'Camera', v: 'ZWO ASI2600MM Pro', prov: 'observed' },
    { k: 'Telescope', v: 'AT130-EDT', prov: 'observed' },
    { k: 'Focal length', v: '910 mm', prov: 'reviewed' },
    { k: 'Observer location', v: 'Truckee, CA (inferred from SITELAT/SITELONG)', prov: 'inferred', conf: 'medium', warn: true },
    { k: 'Timezone', v: 'America/Los_Angeles', prov: 'inferred' },
  ],

  framesSummary: [
    { label: 'Time span', value: '03:11 → 05:02' },
    { label: 'EXPTIME (consistent)', value: '300 s × 22' },
    { label: 'CCD-TEMP range', value: '−10.0 → −10.3 °C' },
    { label: 'HFR mean / max', value: '2.7 / 4.4' },
    { label: 'Frames flagged', value: '1 (HFR > 4.0)', warn: true },
  ],

  calibrationMatches: [
    { label: 'Master Dark 300s', status: 'match', pill: 'match' },
    { label: 'Master Flat SII', status: 'none', pill: 'none in library' },
    { label: 'Master Bias', status: 'match', pill: 'match' },
  ],
  calibrationNote: 'This session cannot be fully calibrated until SII flats are captured.',
};

// ─── Queue progress ─────────────────────────────────────────────────────────

export const queueProgress = {
  reviewed: 2,
  remaining: 46,
  total: 48,
  acquisitionCount: 42,
  calibrationCount: 6,
};
