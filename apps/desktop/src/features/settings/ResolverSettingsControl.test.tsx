// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ResolverSettingsControl tests — spec 035 T031.
 *
 * Covers:
 *   1. Loads current settings and reflects the online toggle state.
 *   2. Toggling online resolution persists via target.resolution.settings.update.
 *   3. compact mode hides the endpoint / debounce / timeout fields.
 *   4. "Clear resolve cache" reports the background re-warm (#695) rather
 *      than a synchronous count.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockUpdate, mockCacheClear } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockCacheClear: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    targetResolutionSettings: mockGet,
    targetResolutionSettingsUpdate: mockUpdate,
    targetCacheClear: mockCacheClear,
  },
}));

import { ResolverSettingsControl } from './ResolverSettingsControl';

const SETTINGS = {
  onlineEnabled: true,
  simbadEndpoint: 'https://simbad.example/tap',
  debounceMs: 300,
  requestTimeoutSecs: 10,
};

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockCacheClear.mockReset();
  mockGet.mockResolvedValue({
    status: 'ok',
    data: { contractVersion: '1.0', requestId: 'r', settings: SETTINGS },
  });
  mockUpdate.mockImplementation((req: { settings: unknown }) =>
    Promise.resolve({
      status: 'ok',
      data: { contractVersion: '1.0', requestId: 'r', settings: req.settings },
    }),
  );
  mockCacheClear.mockResolvedValue({
    status: 'ok',
    data: { rewarmedCount: 0 },
  });
});

describe('ResolverSettingsControl', () => {
  it('loads settings and reflects the online toggle as checked', async () => {
    render(<ResolverSettingsControl />);
    // findBy (not waitFor(mockGet called) + sync getBy): the mock being
    // *called* races the `.then()` that flips `loaded` and swaps the
    // skeleton for the real control — findBy polls until the labeled
    // control actually exists, which is the state under test.
    const checkbox = (await screen.findByLabelText(
      'Enable online SIMBAD resolution',
    )) as HTMLInputElement;
    expect(checkbox).toBeChecked();
  });

  // issue #584: don't paint the toggle as ON (in-code default) before the
  // persisted (OFF) value has loaded — regression test for the render-
  // before-lookup flash.
  it('does not render the toggle checked before persisted settings load', async () => {
    let resolveGet!: (v: unknown) => void;
    mockGet.mockReset();
    mockGet.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    render(<ResolverSettingsControl />);

    expect(
      screen.queryByLabelText('Enable online SIMBAD resolution'),
    ).toBeNull();
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();

    await act(async () => {
      resolveGet({
        status: 'ok',
        data: {
          contractVersion: '1.0',
          requestId: 'r',
          settings: { ...SETTINGS, onlineEnabled: false },
        },
      });
      await Promise.resolve();
    });

    const checkbox = (await screen.findByLabelText(
      'Enable online SIMBAD resolution',
    )) as HTMLInputElement;
    expect(checkbox).not.toBeChecked();
  });

  it('persists the online toggle via updateResolverSettings', async () => {
    render(<ResolverSettingsControl />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    // findBy, not getBy: the waitFor above only proves mockGet was CALLED,
    // not that its promise resolved — `loaded` flips in a .finally() after
    // that, so a sync getBy races the loading skeleton on slow runners and
    // fails with "Unable to find a label" (observed on windows-latest). The
    // sibling compact-mode test below already carries this same fix.
    const toggle = await screen.findByLabelText(
      'Enable online SIMBAD resolution',
    );

    // fireEvent already batches inside `act()`; `persist()`'s own
    // `await updateResolverSettings(...)` then `setSettings(...)` chain
    // resolves over more than one microtask, which a single manual
    // `await Promise.resolve()` doesn't reliably flush (source of the CI
    // act() warnings) — waitFor polls (each poll act()-wrapped) until the
    // full persist cycle actually lands, deterministically either way.
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ onlineEnabled: false }),
        }),
      ),
    );
  });

  it('hides endpoint/debounce/timeout fields in compact mode', async () => {
    render(<ResolverSettingsControl compact />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    // findBy: `loaded` flips in a .finally() after mockGet resolves, so a
    // sync getBy races the skeleton on slow CI runners (macOS/Windows).
    expect(
      await screen.findByLabelText('Enable online SIMBAD resolution'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('SIMBAD endpoint')).toBeNull();
    expect(screen.queryByLabelText('Typeahead debounce (ms)')).toBeNull();
    expect(screen.queryByLabelText('Request timeout (s)')).toBeNull();
  });

  it('shows endpoint/debounce/timeout fields in full mode', async () => {
    render(<ResolverSettingsControl />);
    expect(await screen.findByLabelText('SIMBAD endpoint')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Typeahead debounce (ms)'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Request timeout (s)')).toBeInTheDocument();
  });

  // spec 052 fix #695: the backend now returns as soon as the cache is wiped
  // and re-warms it in the background, so the success copy no longer claims
  // a synchronous count.
  it('reports the background re-warm (not a count) after clearing the cache', async () => {
    render(<ResolverSettingsControl />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear resolve cache' }),
    );

    await waitFor(() => expect(mockCacheClear).toHaveBeenCalled());
    expect(
      await screen.findByText(
        'Resolve cache cleared — re-warming in the background.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/entries\.$/)).toBeNull();
  });

  it('reports the cache-clear error when the command fails', async () => {
    mockCacheClear.mockRejectedValue(new Error('disk full'));
    render(<ResolverSettingsControl />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear resolve cache' }),
    );

    expect(
      await screen.findByText('Could not clear the resolve cache: disk full'),
    ).toBeInTheDocument();
  });

  // #822 regression: a mount-race clobber, same class as Framing's (4c39ec12)
  // — the mount-time `target.resolution.settings` fetch can resolve in the
  // gap between an onChange (uncommitted local state) and the later blur
  // commit, reverting the typed value back to the fetched default before the
  // blur ever fires — and the blur then persists that clobbered value.
  it('does not let the mount-time fetch clobber an in-progress debounce edit, and blur persists the typed value', async () => {
    let resolveGet!: (v: unknown) => void;
    mockGet.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );
    mockUpdate.mockImplementation((req: { settings: unknown }) =>
      Promise.resolve({
        status: 'ok',
        data: {
          contractVersion: '1.0',
          requestId: 'r',
          settings: req.settings,
        },
      }),
    );

    render(<ResolverSettingsControl />);

    const input = (await screen.findByLabelText(
      'Typeahead debounce (ms)',
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500' } });
    expect(input).toHaveValue(500);

    // The stale mount fetch now resolves with the pre-edit default — it must
    // not clobber the uncommitted edit.
    await act(async () => {
      resolveGet({
        status: 'ok',
        data: { contractVersion: '1.0', requestId: 'r', settings: SETTINGS },
      });
      await Promise.resolve();
    });
    expect(input).toHaveValue(500);

    fireEvent.blur(input);
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ debounceMs: 500 }),
        }),
      ),
    );
    expect(input).toHaveValue(500);
  });
});
