/// <reference types="@testing-library/jest-dom" />
/**
 * ResolverSettingsControl tests — spec 035 T031.
 *
 * Covers:
 *   1. Loads current settings and reflects the online toggle state.
 *   2. Toggling online resolution persists via target.resolution.settings.update.
 *   3. compact mode hides the endpoint / debounce / timeout fields.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockUpdate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    targetResolutionSettings: mockGet,
    targetResolutionSettingsUpdate: mockUpdate,
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
});

describe('ResolverSettingsControl', () => {
  it('loads settings and reflects the online toggle as checked', async () => {
    render(<ResolverSettingsControl />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    // The toggle's aria-label now sits on the <input> itself (a11y: the
    // accessible name belongs on the interactive control), so getByLabelText
    // returns the checkbox directly.
    const checkbox = screen.getByLabelText('Enable online SIMBAD resolution') as HTMLInputElement;
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
      expect.objectContaining({ settings: expect.objectContaining({ onlineEnabled: false }) }),
    );
  });

  it('hides endpoint/debounce/timeout fields in compact mode', async () => {
    render(<ResolverSettingsControl compact />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.getByLabelText('Enable online SIMBAD resolution')).toBeInTheDocument();
    expect(screen.queryByLabelText('SIMBAD endpoint')).toBeNull();
    expect(screen.queryByLabelText('Typeahead debounce (ms)')).toBeNull();
    expect(screen.queryByLabelText('Request timeout (s)')).toBeNull();
  });

  it('shows endpoint/debounce/timeout fields in full mode', async () => {
    render(<ResolverSettingsControl />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.getByLabelText('SIMBAD endpoint')).toBeInTheDocument();
    expect(screen.getByLabelText('Typeahead debounce (ms)')).toBeInTheDocument();
    expect(screen.getByLabelText('Request timeout (s)')).toBeInTheDocument();
  });
});
