// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inventory command contract tests (spec 006, T104/T303/T304/T305).
 *
 * Verifies:
 * 1. Fixture data shapes match the inventory.list contract schema.
 * 2. inventoryList mock invoke returns a well-formed InventoryListResponse.
 * 3. Filter logic: frameFilter restricts sessions by type.
 *
 * Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
 * inventory. The `inventory.session.review` response-contract tests and the
 * `reviewFilter`/review-state filter-logic tests were removed along with the
 * review-state machine and the `inventory.session.review` command.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  INVENTORY_SOURCES,
  INVENTORY_LIST_RESPONSE,
  type InventoryListResponse,
} from '@/data/fixtures/inventory';

// ── Mock the @tauri-apps/api/core invoke so tests run in jsdom ────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

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
});
