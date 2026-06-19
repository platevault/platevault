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

vi.mock('@/api/commands', () => ({
  getResolverSettings: mockGet,
  updateResolverSettings: mockUpdate,
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
  mockGet.mockResolvedValue({ contractVersion: '1.0', requestId: 'r', settings: SETTINGS });
  mockUpdate.mockImplementation((settings: unknown) =>
    Promise.resolve({ contractVersion: '1.0', requestId: 'r', settings }),
  );
});

describe('ResolverSettingsControl', () => {
  it('loads settings and reflects the online toggle as checked', async () => {
    render(<ResolverSettingsControl />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    const label = screen.getByLabelText('Enable online SIMBAD resolution');
    const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
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
      expect.objectContaining({ onlineEnabled: false }),
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
