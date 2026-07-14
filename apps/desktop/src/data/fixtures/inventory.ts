// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Static fixture data for the Inventory ledger (spec 006).
 *
 * Types mirror the `inventory.list` contract from
 * `specs/006-inventory-library-lifecycle/contracts/inventory.list.json`.
 * These are used by the mock invoke path (VITE_USE_MOCKS=true) and vitest.
 *
 * Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
 * inventory. The review-state machine (`SessionState`, `InventorySession.state`,
 * `InventoryListRequest.filters.reviewFilter`) and the
 * `InventorySessionReviewRequest`/`InventorySessionReviewResponse` DTOs were
 * removed along with the `inventory.session.review` command they backed.
 */

// ── Contract DTOs (local inline until bindings are regenerated) ───────────────

// `mixed` removed 2026-07-03 (spec 006 iteration): Inbox single-type ingest
// (spec 041) splits mixed folders at ingest, so an inventory item is never mixed.
export type FrameType = 'light' | 'dark' | 'flat' | 'bias';
export type SourceKind =
  | 'local_disk'
  | 'external_disk'
  | 'removable'
  | 'network_share';
export type SourceState =
  | 'active'
  | 'missing'
  | 'disabled'
  | 'reconnect_required';

export interface ProvenanceSummary {
  target?: string;
  filter?: string;
  inferred?: string;
  confirmedBy?: string;
}

export interface LinkedProjectRef {
  id: string;
  name: string;
}

export interface LinkedRefs {
  projects?: LinkedProjectRef[];
  session?: string;
  calibration?: string;
}

export interface InventorySession {
  id: string;
  name: string;
  sourceId: string;
  frames: number;
  type: FrameType;
  target: string | null;
  filter: string | null;
  exposure: string | null;
  camera?: string;
  gain?: string;
  binning?: string;
  setTemp?: string;
  capturedOn?: string;
  provenance?: ProvenanceSummary;
  linked?: LinkedRefs;
}

export interface InventorySource {
  id: string;
  path: string;
  kind: SourceKind;
  state: SourceState;
  sessions: InventorySession[];
}

export interface InventoryListRequest {
  contractVersion: string;
  requestId: string;
  filters?: {
    sourceFilter?: string;
    frameFilter?: FrameType;
  };
}

export interface InventoryListResponse {
  status: 'success' | 'error';
  contractVersion: string;
  requestId: string;
  generatedAt: string;
  sources: InventorySource[];
}

// ── Fixture constant UUIDs ────────────────────────────────────────────────────

const ROOT_LOCAL = '550e8400-e29b-41d4-a716-000000000001';
const ROOT_EXTERNAL = '550e8400-e29b-41d4-a716-000000000002';

const PROJECT_NGC7000_NB = '550e8400-e29b-41d4-a716-446655440301';
const PROJECT_M31_LRGB = '550e8400-e29b-41d4-a716-446655440302';

// ── Fixture sessions ──────────────────────────────────────────────────────────

const LOCAL_SESSIONS: InventorySession[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'NGC 7000 · Ha — 2026-04-12',
    sourceId: ROOT_LOCAL,
    frames: 54,
    type: 'light',
    target: 'NGC 7000',
    filter: 'Ha',
    exposure: '300s',
    camera: 'ASI2600MM Pro',
    gain: '100',
    binning: '1×1',
    setTemp: '-10°C',
    capturedOn: '2026-04-12',
    provenance: { target: 'NGC 7000', filter: 'Ha', confirmedBy: 'user' },
    linked: {
      projects: [
        { id: PROJECT_NGC7000_NB, name: 'NGC 7000 · HOO' },
        {
          id: '550e8400-e29b-41d4-a716-446655440303',
          name: 'NGC 7000 · SHO mosaic',
        },
      ],
    },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'NGC 7000 · OIII — 2026-04-15',
    sourceId: ROOT_LOCAL,
    frames: 22,
    type: 'light',
    target: 'NGC 7000',
    filter: 'OIII',
    exposure: '600s',
    camera: 'ASI2600MM Pro',
    gain: '100',
    binning: '1×1',
    setTemp: '-10°C',
    capturedOn: '2026-04-15',
    provenance: { target: 'NGC 7000', filter: 'OIII', confirmedBy: 'user' },
    linked: { projects: [{ id: PROJECT_NGC7000_NB, name: 'NGC 7000 · HOO' }] },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    name: 'IC 1396 · SII — 2026-04-14',
    sourceId: ROOT_LOCAL,
    frames: 18,
    type: 'light',
    target: 'IC 1396',
    filter: 'SII',
    // 360 s exposure; GAIN=125 (narrowband mode), OFFSET=20, BIN=1×1, SET-TEMP=0°C
    // from real Poseidon-C PRO / NINA 3.1.2 header (IMAGETYP=LIGHT, XBINNING=1)
    exposure: '360s',
    camera: 'Poseidon-C PRO',
    gain: '125',
    binning: '1×1',
    setTemp: '0°C',
    capturedOn: '2026-04-14',
    provenance: { target: 'IC 1396', inferred: 'from FITS OBJECT' },
    linked: undefined,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440006',
    name: 'M31 · L — 2026-03-28',
    sourceId: ROOT_LOCAL,
    frames: 120,
    type: 'light',
    target: 'M31',
    filter: 'L',
    // 195 s exposure; GAIN=0 (low-noise LUM mode), OFFSET=20, BIN=1×1, SET-TEMP=0°C
    // from real Poseidon-C PRO / NINA 3.1.2 header (IMAGETYP=LIGHT, XBINNING=1)
    exposure: '195s',
    camera: 'Poseidon-C PRO',
    gain: '0',
    binning: '1×1',
    setTemp: '0°C',
    capturedOn: '2026-03-28',
    provenance: {
      target: 'M31',
      filter: 'L',
      inferred: 'filter origin inferred',
    },
    linked: undefined,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440007',
    name: 'M31 · B — 2026-03-10',
    sourceId: ROOT_LOCAL,
    frames: 35,
    type: 'light',
    target: 'M31',
    filter: 'B',
    // 100 s exposure; GAIN=0, OFFSET=20, BIN=1×1, SET-TEMP=0°C
    // from real Poseidon-C PRO / NINA 3.1.2 header (IMAGETYP=LIGHT, XBINNING=1)
    exposure: '100s',
    camera: 'Poseidon-C PRO',
    gain: '0',
    binning: '1×1',
    setTemp: '0°C',
    capturedOn: '2026-03-10',
    linked: undefined,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440008',
    name: 'M42 · OIII — 2026-02-11',
    sourceId: ROOT_LOCAL,
    frames: 28,
    type: 'light',
    target: 'M42',
    filter: 'OIII',
    // 171 s exposure; GAIN=125 (narrowband mode), OFFSET=20, BIN=1×1, SET-TEMP=0°C
    // from real Poseidon-C PRO / NINA 3.1.2 header (IMAGETYP=LIGHT, XBINNING=1)
    exposure: '171s',
    camera: 'Poseidon-C PRO',
    gain: '125',
    binning: '1×1',
    setTemp: '0°C',
    capturedOn: '2026-02-11',
    linked: undefined,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440009',
    name: 'M42 · Ha — 2026-02-10',
    sourceId: ROOT_LOCAL,
    frames: 45,
    type: 'light',
    target: 'M42',
    filter: 'Ha',
    // 300 s exposure; GAIN=125 (narrowband mode), OFFSET=20, BIN=1×1, SET-TEMP=0°C
    // from real Poseidon-C PRO / NINA 3.1.2 header (IMAGETYP=LIGHT, XBINNING=1)
    exposure: '300s',
    camera: 'Poseidon-C PRO',
    gain: '125',
    binning: '1×1',
    setTemp: '0°C',
    capturedOn: '2026-02-10',
    linked: undefined,
  },
];

const EXTERNAL_SESSIONS: InventorySession[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
    name: 'M31 · R — 2026-03-30',
    sourceId: ROOT_EXTERNAL,
    frames: 40,
    type: 'light',
    target: 'M31',
    filter: 'R',
    // 101 s exposure; GAIN=0, OFFSET=20, BIN=1×1, SET-TEMP=0°C
    // from real Poseidon-C PRO / NINA 3.1.2 header (IMAGETYP=LIGHT, XBINNING=1)
    exposure: '101s',
    camera: 'Poseidon-C PRO',
    gain: '0',
    binning: '1×1',
    setTemp: '0°C',
    capturedOn: '2026-03-30',
    provenance: { target: 'M31', filter: 'R', confirmedBy: 'user' },
    linked: { projects: [{ id: PROJECT_M31_LRGB, name: 'M31 · LRGB' }] },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440010',
    name: 'NGC 2244 · Ha — 2026-01-20',
    sourceId: ROOT_EXTERNAL,
    frames: 62,
    type: 'light',
    target: 'NGC 2244',
    filter: 'Ha',
    // 300 s exposure; GAIN=0, OFFSET=50, BIN=1×1, SET-TEMP=0°C
    // from real ZWO ASI2600MM Pro / NINA 3.2.0 header (IMAGETYP=LIGHT, XBINNING=1, FILTER=OIII)
    exposure: '300s',
    camera: 'ZWO ASI2600MM Pro',
    gain: '0',
    binning: '1×1',
    setTemp: '0°C',
    capturedOn: '2026-01-20',
    linked: undefined,
  },
  // Calibration set on external drive
  {
    id: '550e8400-e29b-41d4-a716-446655440020',
    name: 'dark calibration — 2026-04-01',
    sourceId: ROOT_EXTERNAL,
    frames: 20,
    type: 'dark',
    target: null,
    filter: null,
    // 300 s exposure; GAIN=60, BIN=1×1 — from real DWARFIII master dark filename
    // dark_exp_300.000000_gain_60_bin_1_44C_stack_10.fits
    exposure: '300s',
    camera: 'DWARFIII',
    gain: '60',
    binning: '1×1',
    setTemp: '−44°C',
    capturedOn: '2026-04-01',
    linked: undefined,
  },
];

// ── Exported fixture data ─────────────────────────────────────────────────────

export const INVENTORY_SOURCES: InventorySource[] = [
  {
    id: ROOT_LOCAL,
    path: '/home/user/astrophotos',
    kind: 'local_disk',
    state: 'active',
    sessions: LOCAL_SESSIONS,
  },
  {
    id: ROOT_EXTERNAL,
    path: '/media/ExternalSSD/astrophotos',
    kind: 'external_disk',
    state: 'active',
    sessions: EXTERNAL_SESSIONS,
  },
];

/** Default mock response for inventory.list. */
export const INVENTORY_LIST_RESPONSE: InventoryListResponse = {
  status: 'success',
  contractVersion: '2.0.0',
  requestId: '00000000-0000-0000-0000-000000000001',
  generatedAt: '2026-06-11T00:00:00Z',
  sources: INVENTORY_SOURCES,
};
