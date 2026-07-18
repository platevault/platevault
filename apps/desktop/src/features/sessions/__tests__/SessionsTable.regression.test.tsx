// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * SessionsTable regression tests:
 *
 * #654 — same-night, metadata-less sessions (no `target`) must render
 * DISTINGUISHABLE Target-cell labels, not N identical `Session — {date}` rows.
 * #798 — the "Integration" column must show TOTAL integration time
 * (frames × exposure), not the raw per-frame exposure string.
 * #889 — a session on a non-active source renders a connectivity chip.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { InventorySession, InventorySource } from '@/bindings/index';
import { SessionsTable, DEFAULT_SESSION_SORT } from '../SessionsTable';

function makeSession(overrides: Partial<InventorySession>): InventorySession {
  return {
    id: 'sess-1',
    name: 'Session — 2026-07-11',
    sourceId: 'root-1',
    frames: 4,
    type: 'light',
    target: null,
    filter: null,
    exposure: null,
    camera: null,
    gain: null,
    binning: null,
    setTemp: null,
    capturedOn: '2026-07-11',
    provenance: null,
    linked: null,
    relativePath: null,
    notes: null,
    ...overrides,
  } as InventorySession;
}

const noop = () => undefined;

function renderTable(sources: InventorySource[]) {
  return render(
    <SessionsTable
      sources={sources}
      selected={null}
      onSelect={noop}
      sort={DEFAULT_SESSION_SORT}
      onSort={noop}
      dims={[]}
    />,
  );
}

describe('SessionsTable — display-name discriminator (#654)', () => {
  it('renders distinguishable labels for same-night, metadata-less sessions', () => {
    const source: InventorySource = {
      id: 'root-1',
      path: '/lib',
      kind: 'local_disk',
      state: 'active',
      sessions: [
        makeSession({ id: 'a', frames: 4 }),
        makeSession({ id: 'b', frames: 14 }),
        makeSession({ id: 'c', frames: 4, relativePath: 'raw/2026-07-11/c' }),
      ],
    } as InventorySource;
    renderTable([source]);

    const a = screen.getByTestId('sessions-row-a').textContent;
    const b = screen.getByTestId('sessions-row-b').textContent;
    const c = screen.getByTestId('sessions-row-c').textContent;
    // All three had identical `name`/`target`/frame-count ties (a vs c) in the
    // real repro — the discriminator must still separate every pair.
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
    // The folder-name discriminator is human-readable when available.
    expect(c).toContain('c');
  });
});

describe('SessionsTable — Integration column shows TOTAL time (#798)', () => {
  it('shows frames × exposure, not the raw per-frame exposure', () => {
    const source: InventorySource = {
      id: 'root-1',
      path: '/lib',
      kind: 'local_disk',
      state: 'active',
      sessions: [
        makeSession({
          id: 'x',
          target: 'M31',
          exposure: '300s',
          frames: 10,
        }),
      ],
    } as InventorySource;
    renderTable([source]);
    const row = screen.getByTestId('sessions-row-x');
    // 10 * 300s = 3000s = 50m — not the raw "300s" per-frame value.
    expect(row.textContent).toContain('50m');
    expect(row.textContent).not.toContain('300s');
  });
});

describe('SessionsTable — backing-source connectivity chip (#889)', () => {
  it('renders a connectivity chip for a session on a missing source', () => {
    const source: InventorySource = {
      id: 'root-1',
      path: '/lib',
      kind: 'local_disk',
      state: 'missing',
      sessions: [makeSession({ id: 'm', target: 'M31' })],
    } as InventorySource;
    renderTable([source]);
    expect(screen.getByTestId('sessions-row-connectivity-m')).toHaveTextContent(
      'Source missing',
    );
  });

  it('renders no connectivity chip for a session on an active source', () => {
    const source: InventorySource = {
      id: 'root-1',
      path: '/lib',
      kind: 'local_disk',
      state: 'active',
      sessions: [makeSession({ id: 'ok', target: 'M31' })],
    } as InventorySource;
    renderTable([source]);
    expect(screen.queryByTestId('sessions-row-connectivity-ok')).toBeNull();
  });
});
