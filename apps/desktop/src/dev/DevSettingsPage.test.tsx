// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DevSettingsPage vitest unit tests (spec 021 T032).
 *
 * Tests:
 * - Renders the current devMode state read from settings.get('advanced').
 * - Toggling the switch calls settings.update with the new value.
 * - Not present in the command palette's DEV_PAGES (URL-only reachability),
 *   verified separately in commandPalette.devMode.test.ts.
 * - The route is only registered in dev-tools builds (verified in
 *   devSurface.release.test.ts alongside devContractsRoute).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DevSettingsPage } from './DevSettingsPage';
import { assertDefined } from '@/test/assertDefined';

const { mockSettingsGet, mockSettingsUpdate } = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockSettingsUpdate: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: (...a: unknown[]) =>
      Promise.resolve(mockSettingsGet(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
    settingsUpdate: (...a: unknown[]) =>
      Promise.resolve(mockSettingsUpdate(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSettingsGet.mockResolvedValue({
    scope: 'advanced',
    values: { devMode: false },
  });
  mockSettingsUpdate.mockResolvedValue(undefined);
});

describe('DevSettingsPage (T032)', () => {
  it('reads the current devMode value on mount', async () => {
    render(<DevSettingsPage />);
    await waitFor(() => {
      expect(mockSettingsGet).toHaveBeenCalledWith('advanced');
    });
    const toggle = await screen.findByTestId('dev-mode-toggle');
    expect(toggle.querySelector('input')).not.toBeChecked();
  });

  it('renders the toggle as checked when devMode is already on', async () => {
    mockSettingsGet.mockResolvedValue({
      scope: 'advanced',
      values: { devMode: true },
    });
    render(<DevSettingsPage />);
    const toggle = await screen.findByTestId('dev-mode-toggle');
    await waitFor(() => expect(toggle.querySelector('input')).toBeChecked());
  });

  it('calls settings.update with devMode=true when toggled on', async () => {
    render(<DevSettingsPage />);
    const toggle = await screen.findByTestId('dev-mode-toggle');
    const input = assertDefined(
      toggle.querySelector('input'),
      'dev-mode-toggle input',
    );
    fireEvent.click(input);
    await waitFor(() => {
      expect(mockSettingsUpdate).toHaveBeenCalledWith('advanced', {
        devMode: true,
      });
    });
  });

  it('shows a restart hint once devMode is on', async () => {
    mockSettingsGet.mockResolvedValue({
      scope: 'advanced',
      values: { devMode: true },
    });
    render(<DevSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText(/restart/i)).toBeTruthy();
    });
  });

  it('surfaces an error message when settings.update fails', async () => {
    mockSettingsUpdate.mockRejectedValue(new Error('db unavailable'));
    render(<DevSettingsPage />);
    const toggle = await screen.findByTestId('dev-mode-toggle');
    const input = assertDefined(
      toggle.querySelector('input'),
      'dev-mode-toggle input',
    );
    fireEvent.click(input);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });
});
