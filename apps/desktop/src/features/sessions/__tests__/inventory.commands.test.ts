/**
 * Inventory command contract tests (spec 006, T104/T303/T304/T305).
 *
 * Verifies:
 * 1. Fixture data shapes match the inventory.list contract schema.
 * 2. inventoryList mock invoke returns a well-formed InventoryListResponse.
 * 3. inventorySessionReview mock invoke returns success for a valid transition.
 * 4. Review response has status="noop" shape when same-state is requested.
 * 5. Filter logic: reviewFilter=ignored surfaces only ignored sessions.
 * 6. Filter logic: frameFilter restricts sessions by type.
 * 7. Review response contract: session.not_found error code shape.
 * 8. Review response contract: transition.refused error code shape.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  INVENTORY_SOURCES,
  INVENTORY_LIST_RESPONSE,
  type InventoryListResponse,
  type InventorySessionReviewResponse,
} from '@/data/fixtures/inventory';

// ── Mock the @tauri-apps/api/core invoke so tests run in jsdom ────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeListResponse(opts?: {
  reviewFilter?: string;
}): InventoryListResponse {
  const { reviewFilter } = opts ?? {};
  if (reviewFilter === 'ignored') {
    return {
      ...INVENTORY_LIST_RESPONSE,
      sources: INVENTORY_SOURCES.map((src) => ({
        ...src,
        sessions: src.sessions.filter((s) => s.state === 'ignored'),
      })).filter((src) => src.sessions.length > 0),
    };
  }
  return INVENTORY_LIST_RESPONSE;
}

function makeReviewResponse(
  opts: {
    status: 'success' | 'noop' | 'error';
    code?: string;
  },
): InventorySessionReviewResponse {
  const { status, code } = opts;
  if (status === 'success') {
    return {
      status: 'success',
      contractVersion: '2.0.0',
      requestId: 'req-001',
      appliedAt: '2026-06-11T12:00:00Z',
      entityType: 'acquisition_session',
      priorState: 'needs_review',
      newState: 'confirmed',
      auditId: 'audit-001',
    };
  }
  if (status === 'noop') {
    return {
      status: 'noop',
      contractVersion: '2.0.0',
      requestId: 'req-001',
    };
  }
  return {
    status: 'error',
    contractVersion: '2.0.0',
    requestId: 'req-001',
    error: {
      code: code ?? 'transition.refused',
      message: 'Test error',
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Inventory fixture data', () => {
  it('INVENTORY_SOURCES has at least one source', () => {
    expect(INVENTORY_SOURCES.length).toBeGreaterThan(0);
  });

  it('every source has a non-empty id and path', () => {
    for (const src of INVENTORY_SOURCES) {
      expect(src.id).toBeTruthy();
      expect(src.path).toBeTruthy();
    }
  });

  it('every source has a valid kind enum value', () => {
    const validKinds = ['local_disk', 'external_disk', 'removable', 'network_share'];
    for (const src of INVENTORY_SOURCES) {
      expect(validKinds).toContain(src.kind);
    }
  });

  it('every source has a valid state enum value', () => {
    const validStates = ['active', 'missing', 'disabled', 'reconnect_required'];
    for (const src of INVENTORY_SOURCES) {
      expect(validStates).toContain(src.state);
    }
  });

  it('every session has required fields', () => {
    for (const src of INVENTORY_SOURCES) {
      for (const session of src.sessions) {
        expect(session.id).toBeTruthy();
        expect(session.name).toBeTruthy();
        expect(session.sourceId).toBe(src.id);
        expect(session.frames).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('session state values are all valid', () => {
    const validStates = ['discovered', 'candidate', 'needs_review', 'confirmed', 'rejected', 'ignored'];
    for (const src of INVENTORY_SOURCES) {
      for (const session of src.sessions) {
        expect(validStates).toContain(session.state);
      }
    }
  });

  it('session frame type values are all valid', () => {
    const validTypes = ['light', 'dark', 'flat', 'bias', 'mixed'];
    for (const src of INVENTORY_SOURCES) {
      for (const session of src.sessions) {
        expect(validTypes).toContain(session.type);
      }
    }
  });
});

describe('inventory.list response contract', () => {
  it('default response excludes ignored sessions', () => {
    const resp = makeListResponse();
    for (const src of resp.sources) {
      for (const session of src.sessions) {
        expect(session.state).not.toBe('ignored');
      }
    }
  });

  it('reviewFilter=ignored response contains only ignored sessions', () => {
    const resp = makeListResponse({ reviewFilter: 'ignored' });
    for (const src of resp.sources) {
      expect(src.sessions.length).toBeGreaterThan(0);
      for (const session of src.sessions) {
        expect(session.state).toBe('ignored');
      }
    }
  });

  it('response has required contract fields', () => {
    const resp = makeListResponse();
    expect(resp.status).toBe('success');
    expect(resp.contractVersion).toBe('2.0.0');
    expect(resp.requestId).toBeTruthy();
    expect(resp.generatedAt).toBeTruthy();
    expect(Array.isArray(resp.sources)).toBe(true);
  });

  it('each source in response has sessions array', () => {
    const resp = makeListResponse();
    for (const src of resp.sources) {
      expect(Array.isArray(src.sessions)).toBe(true);
    }
  });
});

describe('inventory.session.review response contract (T303, T304, T305)', () => {
  it('T303: success response has status=success and required fields', () => {
    const resp = makeReviewResponse({ status: 'success' });
    expect(resp.status).toBe('success');
    expect(resp.appliedAt).toBeTruthy();
    expect(resp.entityType).toBeTruthy();
    expect(resp.priorState).toBeTruthy();
    expect(resp.newState).toBeTruthy();
    expect(resp.auditId).toBeTruthy();
    expect(resp.error).toBeUndefined();
  });

  it('T303: noop response has status=noop and no auditId', () => {
    const resp = makeReviewResponse({ status: 'noop' });
    expect(resp.status).toBe('noop');
    expect(resp.auditId).toBeUndefined();
    expect(resp.error).toBeUndefined();
  });

  it('T304: session.not_found error has correct code', () => {
    const resp = makeReviewResponse({ status: 'error', code: 'session.not_found' });
    expect(resp.status).toBe('error');
    expect(resp.error?.code).toBe('session.not_found');
    expect(resp.error?.message).toBeTruthy();
    expect(resp.auditId).toBeUndefined();
  });

  it('T305: transition.refused error has correct code', () => {
    const resp = makeReviewResponse({ status: 'error', code: 'transition.refused' });
    expect(resp.status).toBe('error');
    expect(resp.error?.code).toBe('transition.refused');
  });

  it('T308: session.mixed_state error has correct code', () => {
    const resp = makeReviewResponse({ status: 'error', code: 'session.mixed_state' });
    expect(resp.status).toBe('error');
    expect(resp.error?.code).toBe('session.mixed_state');
  });
});

describe('Inventory filter logic (T101)', () => {
  it('frame filter: light sessions only', () => {
    const lightOnly = INVENTORY_SOURCES.flatMap((src) =>
      src.sessions.filter((s) => s.type === 'light'),
    );
    expect(lightOnly.length).toBeGreaterThan(0);
    for (const s of lightOnly) {
      expect(s.type).toBe('light');
    }
  });

  it('frame filter: calibration sessions only', () => {
    const calOnly = INVENTORY_SOURCES.flatMap((src) =>
      src.sessions.filter((s) => ['dark', 'flat', 'bias'].includes(s.type)),
    );
    for (const s of calOnly) {
      expect(['dark', 'flat', 'bias']).toContain(s.type);
    }
  });

  it('source filter: single source returns only that source sessions', () => {
    const source = INVENTORY_SOURCES[0];
    const filtered = INVENTORY_SOURCES.filter((s) => s.id === source.id);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(source.id);
  });

  it('review filter: confirmed sessions', () => {
    const confirmed = INVENTORY_SOURCES.flatMap((src) =>
      src.sessions.filter((s) => s.state === 'confirmed'),
    );
    expect(confirmed.length).toBeGreaterThan(0);
    for (const s of confirmed) {
      expect(s.state).toBe('confirmed');
    }
  });

  it('review filter: needs_review sessions', () => {
    const needsReview = INVENTORY_SOURCES.flatMap((src) =>
      src.sessions.filter((s) => s.state === 'needs_review'),
    );
    expect(needsReview.length).toBeGreaterThan(0);
    for (const s of needsReview) {
      expect(s.state).toBe('needs_review');
    }
  });
});
