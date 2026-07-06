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

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

const SETTINGS = {
  watcherEnabled: true,
  scanOnStartup: true,
  followSymlinks: false,
  followJunctions: false,
  hashingMode: 'lazy',
  metadataExtraction: true,
  exposureGroupingToleranceS: 2,
  temperatureGroupingToleranceC: 5,
  defaultFilter: null,
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
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    expect(screen.getByLabelText('Scan on startup')).toBeChecked();
    expect(screen.getByLabelText('Follow symbolic links')).not.toBeChecked();
    expect(screen.getByLabelText('Follow NTFS junctions')).not.toBeChecked();
    expect(screen.getByLabelText('Hashing mode')).toHaveValue('lazy');
  });

  it('persists a toggle change via ingestion.settings.update, preserving unrendered fields', async () => {
    render(<Ingestion save={vi.fn()} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    const toggle = screen.getByLabelText('Follow symbolic links');
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        followSymlinks: true,
        // Unrendered fields must round-trip untouched.
        watcherEnabled: SETTINGS.watcherEnabled,
        metadataExtraction: SETTINGS.metadataExtraction,
        exposureGroupingToleranceS: SETTINGS.exposureGroupingToleranceS,
        temperatureGroupingToleranceC: SETTINGS.temperatureGroupingToleranceC,
        defaultFilter: SETTINGS.defaultFilter,
      }),
    );
  });

  it('persists "off" for the hashing mode selector', async () => {
    render(<Ingestion save={vi.fn()} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    const select = screen.getByLabelText('Hashing mode');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'off' } });
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ hashingMode: 'off' }));
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
    mockGet.mockResolvedValueOnce({
      status: 'ok',
      data: { ...SETTINGS, followSymlinks: true, hashingMode: 'eager' },
    });
    render(<Ingestion save={vi.fn()} />);
    // Wait for the fetched (non-default) value to be applied, not merely for
    // the get call to fire — asserting right after the call races hydration.
    await waitFor(() => expect(screen.getByLabelText('Follow symbolic links')).toBeChecked());

    const restoreBtn = screen.getByText('Restore defaults');
    await act(async () => {
      fireEvent.click(restoreBtn);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByLabelText('Follow symbolic links')).not.toBeChecked());
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ followSymlinks: false, hashingMode: 'lazy' }),
    );
  });
});
