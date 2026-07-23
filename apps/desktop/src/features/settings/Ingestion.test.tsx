// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Ingestion settings pane tests — spec 030, package P12 (real persistence).
 *
 * Covers:
 *   1. Loads persisted settings on mount and reflects them in the controls.
 *   2. Toggling a control persists the full settings document (including
 *      fields this pane doesn't render) via ingestion.settings.update.
 *   3. The hashing-mode selector persists "off" (a state the previous stub
 *      UI could select but never actually persist).
 *   4. "Restore defaults" persists the in-code defaults and re-hydrates.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockUpdate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    ingestionSettingsGet: mockGet,
    ingestionSettingsUpdate: mockUpdate,
  },
}));

import { Ingestion } from './Ingestion';

// Every field differs from Ingestion.tsx's in-code DEFAULTS. That is
// load-bearing, not cosmetic: an identical fixture (the state before #1095's
// follow-up) makes the assertions below indistinguishable from the component's
// own defaults, so they pass whether or not the fetch ever resolves. Values are
// plausible non-defaults — keep them differing from DEFAULTS when either side
// changes.
const SETTINGS = {
  watcherEnabled: false,
  scanOnStartup: false,
  followSymlinks: true,
  followJunctions: true,
  hashingMode: 'eager',
  metadataExtraction: false,
  exposureGroupingToleranceS: 10,
  temperatureGroupingToleranceC: 3,
  defaultFilter: 'Ha',
};

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockGet.mockResolvedValue({ status: 'ok', data: SETTINGS });
  mockUpdate.mockImplementation((request: unknown) =>
    Promise.resolve({ status: 'ok', data: request }),
  );
});

describe('Ingestion', () => {
  it('loads persisted settings and reflects them in the controls', async () => {
    render(<Ingestion save={vi.fn()} />);

    // findBy on a hydrated *value*, not waitFor(mockGet called) + sync getBy —
    // the call firing does not mean its promise resolved, and now that the
    // fixture differs from DEFAULTS a sync assertion races hydration. The pane
    // applies the whole document in one setSettings(loaded), so gating on this
    // one control proves the other three have landed too.
    await screen.findByRole('checkbox', {
      name: 'Follow symbolic links',
      checked: true,
    });

    expect(screen.getByLabelText('Scan on startup')).not.toBeChecked();
    expect(screen.getByLabelText('Follow NTFS junctions')).toBeChecked();
    expect(screen.getByLabelText('Hashing mode')).toHaveValue('eager');
  });

  it('persists a toggle change via ingestion.settings.update, preserving unrendered fields', async () => {
    render(<Ingestion save={vi.fn()} />);

    // Click only once the fetched state is in the control: clicking the
    // pre-hydration default would toggle the wrong starting value and would
    // persist DEFAULTS' unrendered fields, which the fixture no longer matches.
    const toggle = await screen.findByRole('checkbox', {
      name: 'Follow symbolic links',
      checked: true,
    });
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        followSymlinks: false,
        // Unrendered fields must round-trip untouched.
        watcherEnabled: SETTINGS.watcherEnabled,
        metadataExtraction: SETTINGS.metadataExtraction,
        exposureGroupingToleranceS: SETTINGS.exposureGroupingToleranceS,
        temperatureGroupingToleranceC: SETTINGS.temperatureGroupingToleranceC,
        defaultFilter: SETTINGS.defaultFilter,
      }),
    );
  });

  // Issue #878: only followSymlinks has a pipeline consumer. The other three
  // controls must not present themselves as working settings.
  it.each([['Scan on startup'], ['Follow NTFS junctions'], ['Hashing mode']])(
    '%s is disabled because no pipeline reads it',
    async (label) => {
      render(<Ingestion save={vi.fn()} />);

      await screen.findByRole('checkbox', {
        name: 'Follow symbolic links',
        checked: true,
      });

      expect(screen.getByLabelText(label)).toBeDisabled();
    },
  );

  it('a slow initial fetch does not clobber an edit made before it resolves', async () => {
    // Reproduces a real race, not just CI flakiness: the mount-time
    // ingestionSettingsGet() fetch can still be in flight when the user's
    // first edit fires. If the late resolution unconditionally overwrites
    // state, the user's edit reverts.
    let resolveGet!: (value: { status: 'ok'; data: typeof SETTINGS }) => void;
    mockGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    render(<Ingestion save={vi.fn()} />);

    // Edit fires before the mount fetch has resolved.
    const select = screen.getByLabelText('Hashing mode');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'off' } });
      await Promise.resolve();
    });
    expect(select).toHaveValue('off');

    // Now let the slow initial fetch resolve with the stale "eager" value —
    // it must differ from the user's edit or this proves nothing.
    await act(async () => {
      resolveGet({ status: 'ok', data: SETTINGS });
      await Promise.resolve();
    });

    // The user's edit must survive — the late fetch must not stomp it.
    expect(select).toHaveValue('off');
  });

  it('a slow initial fetch does not clobber an edit made before it resolves', async () => {
    // Reproduces a real race, not just CI flakiness: the mount-time
    // ingestionSettingsGet() fetch can still be in flight when the user's
    // first edit fires. If the late resolution unconditionally overwrites
    // state, the user's edit reverts.
    let resolveGet!: (value: { status: 'ok'; data: typeof SETTINGS }) => void;
    mockGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    render(<Ingestion save={vi.fn()} />);

    // Edit fires before the mount fetch has resolved.
    const select = screen.getByLabelText('Hashing mode');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'eager' } });
      await Promise.resolve();
    });
    expect(select).toHaveValue('eager');

    // Now let the slow initial fetch resolve with the stale "lazy" value.
    await act(async () => {
      resolveGet({ status: 'ok', data: SETTINGS });
      await Promise.resolve();
    });

    // The user's edit must survive — the late fetch must not stomp it.
    expect(select).toHaveValue('eager');
  });

  it('restore defaults persists in-code defaults and re-hydrates the controls', async () => {
    render(<Ingestion save={vi.fn()} />);
    // Wait for the fetched (non-default) value to be applied, not merely for
    // the get call to fire — asserting right after the call races hydration.
    await screen.findByRole('checkbox', {
      name: 'Follow symbolic links',
      checked: true,
    });

    const restoreBtn = screen.getByText('Restore defaults');
    await act(async () => {
      fireEvent.click(restoreBtn);
      await Promise.resolve();
    });

    await screen.findByRole('checkbox', {
      name: 'Follow symbolic links',
      checked: false,
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ followSymlinks: false, hashingMode: 'lazy' }),
    );
  });
});
