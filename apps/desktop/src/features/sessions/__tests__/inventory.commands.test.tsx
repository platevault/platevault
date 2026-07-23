// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inventory command contract tests (spec 006, T104/T303/T304/T305).
 *
 * Verifies:
 * 1. Fixture data shapes match the inventory.list contract schema.
 * 2. inventoryList mock invoke returns a well-formed InventoryListResponse.
 * 3. sourceFilter is threaded from useInventorySources into the real
 *    inventoryList request payload.
 *
 * Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
 * inventory. The `inventory.session.review` response-contract tests and the
 * `reviewFilter`/review-state filter-logic tests were removed along with the
 * review-state machine and the `inventory.session.review` command.
 *
 * The former "frame filter: light/calibration sessions only" tests here
 * inline-filtered the fixture array directly (`INVENTORY_SOURCES.flatMap(...)`)
 * without calling any production code. They're deleted rather than fixed:
 * `frameFilter` is still declared in `InventoryFilters` (store.ts) and the
 * route search-param schema (router.tsx), but `SessionsPage.tsx` only ever
 * destructures/forwards `sourceFilter` from `useSearch()` — frame-type
 * filtering has no live frontend code path to test (the legacy UI filter was
 * removed; see this suite's sibling SessionsPage.inventory.test.tsx header
 * comment: "The legacy frame-type filter was removed").
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  INVENTORY_SOURCES,
  INVENTORY_LIST_RESPONSE,
  type InventoryListResponse,
} from '@/data/fixtures/inventory';

// ── Mock the @tauri-apps/api/core invoke so tests run in jsdom ────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const { mockInventoryList } = vi.hoisted(() => ({
  mockInventoryList: vi.fn(),
}));

vi.mock('@/bindings/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...actual,
    commands: { ...actual.commands, inventoryList: mockInventoryList },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeListResponse(): InventoryListResponse {
  return INVENTORY_LIST_RESPONSE;
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
    const validKinds = [
      'local_disk',
      'external_disk',
      'removable',
      'network_share',
    ];
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

  it('session frame type values are all valid', () => {
    const validTypes = ['light', 'dark', 'flat', 'bias'];
    for (const src of INVENTORY_SOURCES) {
      for (const session of src.sessions) {
        expect(validTypes).toContain(session.type);
      }
    }
  });
});

describe('inventory.list response contract', () => {
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

// spec 041 FR-051 (T076): the inventory.session.review response contract
// tests are removed along with the review-session use case and its
// InventorySessionReviewResponse DTO.
describe('Inventory filter logic (T101)', () => {
  beforeEach(() => {
    mockInventoryList.mockReset();
    mockInventoryList.mockResolvedValue({
      status: 'ok',
      data: INVENTORY_LIST_RESPONSE,
    });
  });

  it('source filter: useInventorySources threads sourceFilter into the real inventoryList request', async () => {
    // Exercises the actual production wiring (store.ts's makeRequest +
    // useInventorySources), not an inline Array.filter over the fixture —
    // the real per-source filtering happens server-side, so the only
    // frontend-testable behavior is that the chosen source id reaches the
    // request payload unchanged.
    const source = INVENTORY_SOURCES[0];
    const { useInventorySources } = await import('../store');

    renderHook(() => useInventorySources({ sourceFilter: source.id }), {
      wrapper,
    });

    await waitFor(() => expect(mockInventoryList).toHaveBeenCalledTimes(1));
    const request = mockInventoryList.mock.calls[0]?.[0] as {
      filters?: { sourceFilter?: string };
    };
    expect(request.filters?.sourceFilter).toBe(source.id);
  });

  it('no filters: useInventorySources omits the filters key entirely', async () => {
    const { useInventorySources } = await import('../store');

    renderHook(() => useInventorySources(), { wrapper });

    await waitFor(() => expect(mockInventoryList).toHaveBeenCalledTimes(1));
    const request = mockInventoryList.mock.calls[0]?.[0] as {
      filters?: unknown;
    };
    expect(request.filters).toBeUndefined();
  });
});
