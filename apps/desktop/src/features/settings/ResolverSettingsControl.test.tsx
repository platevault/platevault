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
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    // The toggle's aria-label now sits on the <input> itself (a11y: the
    // accessible name belongs on the interactive control), so getByLabelText
    // returns the checkbox directly.
    const checkbox = screen.getByLabelText(
      'Enable online SIMBAD resolution',
    ) as HTMLInputElement;
    expect(checkbox).toBeChecked();
  });

  it('persists the online toggle via updateResolverSettings', async () => {
    render(<ResolverSettingsControl />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    const toggle = screen.getByLabelText('Enable online SIMBAD resolution');
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ onlineEnabled: false }),
      }),
    );
  });

  it('hides endpoint/debounce/timeout fields in compact mode', async () => {
    render(<ResolverSettingsControl compact />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(
      screen.getByLabelText('Enable online SIMBAD resolution'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('SIMBAD endpoint')).toBeNull();
    expect(screen.queryByLabelText('Typeahead debounce (ms)')).toBeNull();
    expect(screen.queryByLabelText('Request timeout (s)')).toBeNull();
  });

  it('shows endpoint/debounce/timeout fields in full mode', async () => {
    render(<ResolverSettingsControl />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.getByLabelText('SIMBAD endpoint')).toBeInTheDocument();
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
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear resolve cache' }),
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
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear resolve cache' }),
    );

    expect(
      await screen.findByText('Could not clear the resolve cache: disk full'),
    ).toBeInTheDocument();
  });
});
