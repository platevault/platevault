/**
 * Static fixture data for the Inventory ledger (spec 006).
 *
 * Types mirror the `inventory.list` contract from
 * `specs/006-inventory-library-lifecycle/contracts/inventory.list.json`.
 * These are used by the mock invoke path (VITE_USE_MOCKS=true) and vitest.
 */

// ── Contract DTOs (local inline until bindings are regenerated) ───────────────

export type SessionState =
  | 'discovered'
  | 'candidate'
  | 'needs_review'
  | 'confirmed'
  | 'rejected'
  | 'ignored';

export type FrameType = 'light' | 'dark' | 'flat' | 'bias' | 'mixed';
export type SourceKind = 'local_disk' | 'external_disk' | 'removable' | 'network_share';
export type SourceState = 'active' | 'missing' | 'disabled' | 'reconnect_required';

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
  state: SessionState;
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
    reviewFilter?: string;
  };
}

export interface InventoryListResponse {
  status: 'success' | 'error';
  contractVersion: string;
  requestId: string;
  generatedAt: string;
  sources: InventorySource[];
}

export interface InventorySessionReviewRequest {
  contractVersion: string;
  requestId: string;
  sessionId: string;
  nextState: SessionState;
  actionLabel?: string;
  actor: 'user' | 'system';
}

export interface InventorySessionReviewResponse {
  status: 'success' | 'noop' | 'error';
  contractVersion: string;
  requestId: string;
  appliedAt?: string;
  entityType?: string;
  priorState?: SessionState;
  newState?: SessionState;
  auditId?: string;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
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
    state: 'confirmed',
    camera: 'ASI2600MM Pro',
    gain: '100',
    binning: '1×1',
    setTemp: '-10°C',
    capturedOn: '2026-04-12',
    provenance: { target: 'NGC 7000', filter: 'Ha', confirmedBy: 'user' },
    linked: {
      projects: [
        { id: PROJECT_NGC7000_NB, name: 'NGC 7000 · HOO' },
        { id: '550e8400-e29b-41d4-a716-446655440303', name: 'NGC 7000 · SHO mosaic' },
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
    state: 'confirmed',
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
    exposure: '360s',
    state: 'discovered',
    camera: 'ASI2600MM Pro',
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
    exposure: '195s',
    state: 'needs_review',
    capturedOn: '2026-03-28',
    provenance: { target: 'M31', filter: 'L', inferred: 'filter origin inferred' },
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
    exposure: '100s',
    state: 'ignored',
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
    exposure: '171s',
    state: 'rejected',
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
    exposure: '300s',
    state: 'needs_review',
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
    exposure: '101s',
    state: 'confirmed',
    camera: 'ASI533MC Pro',
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
    exposure: '300s',
    state: 'confirmed',
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
    exposure: '300s',
    state: 'confirmed',
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

/** Default mock response for inventory.list (excludes ignored sessions). */
export const INVENTORY_LIST_RESPONSE: InventoryListResponse = {
  status: 'success',
  contractVersion: '2.0.0',
  requestId: '00000000-0000-0000-0000-000000000001',
  generatedAt: '2026-06-11T00:00:00Z',
  sources: INVENTORY_SOURCES.map((src) => ({
    ...src,
    sessions: src.sessions.filter((s) => s.state !== 'ignored'),
  })),
};
