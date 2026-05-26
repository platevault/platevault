/**
 * Mock data for the Inbox Session Review feature.
 *
 * Provides realistic astrophotography inbox sessions for UI development.
 * No Tauri data fetching — this is used until the backend is wired.
 */

import type { FrameType } from './session-naming';
import type { FrameProperties } from './conflict-detection';

export interface InboxFrame {
  id: string;
  filename: string;
  gain: number | null;
  filter: string | null;
  exposureSeconds: number | null;
  temperatureC: number | null;
  sizeBytes: number;
}

export interface InboxSession {
  id: string;
  frameType: FrameType;
  object: string;
  date: string;
  filter: string;
  setTemp: string | null;
  gain: number;
  binning: string;
  exposureSeconds: number;
  temperatureC: number;
  frameCount: number;
  totalIntegrationSeconds: number;
  totalSizeBytes: number;
  rootPath: string;
  relativePath: string;
  frames: InboxFrame[];
  properties: InboxSessionProperty[];
}

export interface InboxSessionProperty {
  key: string;
  label: string;
  value: string | number | boolean | null;
  source: 'fits' | 'user' | 'inferred' | 'default';
  editable: boolean;
  confirmed: boolean;
}

export function toFrameProperties(session: InboxSession): FrameProperties[] {
  return session.frames.map((f) => ({
    gain: f.gain,
    filter: f.filter,
    exposureSeconds: f.exposureSeconds,
    temperatureC: f.temperatureC,
  }));
}

function makeFrames(
  count: number,
  prefix: string,
  gain: number,
  filter: string,
  exposure: number,
  temp: number,
  sizeEach: number,
): InboxFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-frame-${String(i + 1).padStart(3, '0')}`,
    filename: `${prefix}_${String(i + 1).padStart(4, '0')}.fits`,
    gain,
    filter,
    exposureSeconds: exposure,
    temperatureC: temp,
    sizeBytes: sizeEach,
  }));
}

function makeProperties(session: {
  object: string;
  filter: string;
  gain: number;
  binning: string;
  exposureSeconds: number;
  temperatureC: number;
  frameType: FrameType;
  setTemp: string | null;
}): InboxSessionProperty[] {
  return [
    {
      key: 'object',
      label: 'Object',
      value: session.object,
      source: session.frameType === 'light' ? 'fits' : 'inferred',
      editable: true,
      confirmed: false,
    },
    {
      key: 'frameType',
      label: 'Frame Type',
      value: session.frameType,
      source: 'fits',
      editable: true,
      confirmed: true,
    },
    {
      key: 'filter',
      label: 'Filter',
      value: session.filter,
      source: 'fits',
      editable: true,
      confirmed: false,
    },
    {
      key: 'gain',
      label: 'Gain',
      value: session.gain,
      source: 'fits',
      editable: false,
      confirmed: true,
    },
    {
      key: 'binning',
      label: 'Binning',
      value: session.binning,
      source: 'fits',
      editable: false,
      confirmed: true,
    },
    {
      key: 'exposure',
      label: 'Exposure (s)',
      value: session.exposureSeconds,
      source: 'fits',
      editable: false,
      confirmed: true,
    },
    {
      key: 'temperature',
      label: 'Temperature',
      value: `${session.temperatureC}°C`,
      source: 'fits',
      editable: false,
      confirmed: true,
    },
    {
      key: 'setTemp',
      label: 'Set Temperature',
      value: session.setTemp,
      source: session.setTemp ? 'fits' : 'default',
      editable: true,
      confirmed: false,
    },
  ];
}

const ngc7000Frames = makeFrames(42, 'NGC7000_Ha', 100, 'Ha', 300, -10, 47_185_920);
const m31Frames = makeFrames(28, 'M31_L', 56, 'L', 180, -10, 47_185_920);
const m42Frames = makeFrames(15, 'M42_OIII', 100, 'OIII', 300, -10, 47_185_920);
const darkFrames = makeFrames(50, 'Dark_300s', 100, '', 300, -10, 47_185_920);
const flatFrames = makeFrames(30, 'Flat_Ha', 100, 'Ha', 0.005, 20, 47_185_920);
const biasFrames = makeFrames(100, 'Bias', 100, '', 0, -10, 47_185_920);

// Session with conflicts: mixed gains
const conflictFrames: InboxFrame[] = [
  ...makeFrames(10, 'IC1396_Ha_G100', 100, 'Ha', 300, -10, 47_185_920),
  ...makeFrames(8, 'IC1396_Ha_G120', 120, 'Ha', 300, -10, 47_185_920),
];

export const MOCK_INBOX_SESSIONS: InboxSession[] = [
  {
    id: 'inbox-001',
    frameType: 'light',
    object: 'NGC 7000',
    date: '2025-09-15',
    filter: 'Ha',
    setTemp: '-10°C',
    gain: 100,
    binning: '1x1',
    exposureSeconds: 300,
    temperatureC: -10,
    frameCount: 42,
    totalIntegrationSeconds: 12600,
    totalSizeBytes: 42 * 47_185_920,
    rootPath: 'E:\\Astro',
    relativePath: 'Lights/NGC7000/2025-09-15/Ha',
    frames: ngc7000Frames,
    properties: [],
  },
  {
    id: 'inbox-002',
    frameType: 'light',
    object: 'M31',
    date: '2025-09-14',
    filter: 'L',
    setTemp: '-10°C',
    gain: 56,
    binning: '1x1',
    exposureSeconds: 180,
    temperatureC: -10,
    frameCount: 28,
    totalIntegrationSeconds: 5040,
    totalSizeBytes: 28 * 47_185_920,
    rootPath: 'E:\\Astro',
    relativePath: 'Lights/M31/2025-09-14/L',
    frames: m31Frames,
    properties: [],
  },
  {
    id: 'inbox-003',
    frameType: 'light',
    object: 'M42',
    date: '2025-10-02',
    filter: 'OIII',
    setTemp: '-10°C',
    gain: 100,
    binning: '1x1',
    exposureSeconds: 300,
    temperatureC: -10,
    frameCount: 15,
    totalIntegrationSeconds: 4500,
    totalSizeBytes: 15 * 47_185_920,
    rootPath: 'E:\\Astro',
    relativePath: 'Lights/M42/2025-10-02/OIII',
    frames: m42Frames,
    properties: [],
  },
  {
    id: 'inbox-004',
    frameType: 'dark',
    object: 'Dark',
    date: '2025-09-15',
    filter: '',
    setTemp: '-10°C',
    gain: 100,
    binning: '1x1',
    exposureSeconds: 300,
    temperatureC: -10,
    frameCount: 50,
    totalIntegrationSeconds: 15000,
    totalSizeBytes: 50 * 47_185_920,
    rootPath: 'E:\\Astro',
    relativePath: 'Darks/2025-09-15/300s',
    frames: darkFrames,
    properties: [],
  },
  {
    id: 'inbox-005',
    frameType: 'flat',
    object: 'Flat',
    date: '2025-09-15',
    filter: 'Ha',
    setTemp: null,
    gain: 100,
    binning: '1x1',
    exposureSeconds: 0.005,
    temperatureC: 20,
    frameCount: 30,
    totalIntegrationSeconds: 0.15,
    totalSizeBytes: 30 * 47_185_920,
    rootPath: 'E:\\Astro',
    relativePath: 'Flats/2025-09-15/Ha',
    frames: flatFrames,
    properties: [],
  },
  {
    id: 'inbox-006',
    frameType: 'bias',
    object: 'Bias',
    date: '2025-09-15',
    filter: '',
    setTemp: null,
    gain: 100,
    binning: '1x1',
    exposureSeconds: 0,
    temperatureC: -10,
    frameCount: 100,
    totalIntegrationSeconds: 0,
    totalSizeBytes: 100 * 47_185_920,
    rootPath: 'E:\\Astro',
    relativePath: 'Bias/2025-09-15',
    frames: biasFrames,
    properties: [],
  },
  {
    id: 'inbox-007',
    frameType: 'light',
    object: 'IC 1396',
    date: '2025-10-10',
    filter: 'Ha',
    setTemp: '-10°C',
    gain: 100,
    binning: '1x1',
    exposureSeconds: 300,
    temperatureC: -10,
    frameCount: 18,
    totalIntegrationSeconds: 5400,
    totalSizeBytes: 18 * 47_185_920,
    rootPath: 'E:\\Astro',
    relativePath: 'Lights/IC1396/2025-10-10/Ha',
    frames: conflictFrames,
    properties: [],
  },
];

// Initialize properties after session objects are created
for (const session of MOCK_INBOX_SESSIONS) {
  session.properties = makeProperties(session);
}

export const FILTER_CATEGORIES = {
  narrowband: ['Ha', 'SII', 'OIII', 'NII'],
  broadband: ['L', 'R', 'G', 'B'],
  dualband: ['HO', 'SO'],
  other: ['UV/IR Cut', 'Custom'],
} as const;

export type FilterCategory = keyof typeof FILTER_CATEGORIES;
