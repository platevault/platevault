// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Cleanup settings pane — per-type action overrides (spec 051 US3, T025).
 *
 * The per-type cleanup action table used to persist via `localStorage`
 * (`alm.cleanup.type_actions.v2`). It now persists through the same
 * database-backed `settings.get('cleanup')` / `save('cleanup', ...)` path as
 * the rest of this pane's fields, so overrides are audited (FR-007).
 *
 * Covers:
 *   1. Loads a persisted `cleanupTypeOverrides` map on mount and reflects it
 *      in the per-type table (not the fixture default).
 *   2. Changing a row's action calls `save('cleanup', { cleanupTypeOverrides })`
 *      with the full row-id-keyed map, merging the change into the previously
 *      loaded overrides.
 *   3. A reload (re-mount with `getSettings` returning the saved map) shows
 *      the override, not the fixture default.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn().mockResolvedValue({ values: {} }),
}));
vi.mock('./settingsIpc', () => ({
  getSettings: mockGetSettings,
}));

import { Cleanup } from './Cleanup';

// Row id 2 = "Raw dark frames", fixture default action "Archive" (see
// data/fixtures/settings.ts).
const DARK_FRAMES_ROW = 'Raw dark frames';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({ values: {} });
});

describe('Cleanup — per-type action overrides (spec 051 US3)', () => {
  it('loads a persisted cleanupTypeOverrides map and reflects it in the table, not the fixture default', async () => {
    mockGetSettings.mockResolvedValue({
      values: { cleanupTypeOverrides: { '2': 'Keep' } },
    });
    render(<Cleanup save={vi.fn()} />);

    const row = await screen.findByRole('row', {
      name: new RegExp(DARK_FRAMES_ROW),
    });
    await waitFor(() => {
      expect(row.querySelector('.alm-seg__btn--active')).toHaveTextContent(
        'Keep',
      );
    });
  });

  it('defaults to the fixture action when no override is persisted', async () => {
    render(<Cleanup save={vi.fn()} />);

    const row = await screen.findByRole('row', {
      name: new RegExp(DARK_FRAMES_ROW),
    });
    await waitFor(() => {
      expect(row.querySelector('.alm-seg__btn--active')).toHaveTextContent(
        'Archive',
      );
    });
  });

  it("changing a row's action calls save('cleanup', { cleanupTypeOverrides }) with the full row-id-keyed map", async () => {
    const save = vi.fn();
    render(<Cleanup save={save} />);

    const row = await screen.findByRole('row', {
      name: new RegExp(DARK_FRAMES_ROW),
    });
    const keepBtn = within(row).getByRole('button', { name: 'Keep' });

    fireEvent.click(keepBtn);

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        'cleanup',
        expect.objectContaining({
          cleanupTypeOverrides: expect.objectContaining({ '2': 'Keep' }),
        }),
      );
    });
  });

  it('a user edit before the mount fetch resolves is not clobbered by the stale response', async () => {
    // Mount-time `getSettings('cleanup')` is left unresolved until after the
    // user has already edited a row — reproduces the real race (mock IPC's
    // randomized latency letting the fetch resolve after a fast click).
    let resolveGet:
      | ((value: { values: Record<string, unknown> }) => void)
      | undefined;
    mockGetSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    render(<Cleanup save={vi.fn()} />);

    const row = await screen.findByRole('row', {
      name: new RegExp(DARK_FRAMES_ROW),
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Keep' }));
    await waitFor(() => {
      expect(row.querySelector('.alm-seg__btn--active')).toHaveTextContent(
        'Keep',
      );
    });

    // The stale fetch now resolves with the (pre-edit) default — it must be
    // ignored, not applied on top of the user's edit.
    resolveGet?.({ values: {} });

    // Give the resolved promise's `.then` a tick to run before asserting it
    // did NOT revert the row.
    await new Promise((r) => setTimeout(r, 0));
    expect(row.querySelector('.alm-seg__btn--active')).toHaveTextContent(
      'Keep',
    );
  });
});
