// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for the Advanced settings pane's first-run setup restart control
 * (spec 003 US3 regression fix).
 *
 * `firstrun.restart` was fully wired on the backend (see
 * `apps/desktop/src-tauri/src/commands/firstrun.rs`) but had no UI caller.
 * These tests cover the distinctly-labeled control: it must gate behind a
 * confirm step, call `restartFirstRun()`, prefill the wizard's working
 * buffer, clear the `setupCompleted` cache, and navigate to `/setup`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Advanced } from './Advanced';
import type { FirstRunRestartResponse } from './settingsIpc';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

const { mockGetSettings, mockRestartFirstRun } = vi.hoisted(() => ({
  mockGetSettings: vi.fn().mockResolvedValue({ values: {} }),
  mockRestartFirstRun: vi.fn(),
}));
vi.mock('./settingsIpc', () => ({
  getSettings: mockGetSettings,
  restartFirstRun: mockRestartFirstRun,
}));

const { mockSetPreference } = vi.hoisted(() => ({
  mockSetPreference: vi.fn(),
}));
vi.mock('@/data/preferences', () => ({
  setPreference: mockSetPreference,
}));

const { mockResetWizardStateWithSources } = vi.hoisted(() => ({
  mockResetWizardStateWithSources: vi.fn(),
}));
vi.mock('@/features/setup/sources-store', () => ({
  resetWizardStateWithSources: mockResetWizardStateWithSources,
}));

// Update section (#845/#869/#873/#888) — mocked so each test controls the
// phase directly instead of exercising the real Tauri updater plugin.
const {
  mockGetUpdateSnapshot,
  mockSubscribeUpdate,
  mockCheckForUpdate,
  mockRestartPendingUpdate,
  mockGetRunningVersion,
} = vi.hoisted(() => ({
  mockGetUpdateSnapshot: vi.fn().mockReturnValue({ phase: 'idle' }),
  mockSubscribeUpdate: vi.fn().mockReturnValue(() => {}),
  mockCheckForUpdate: vi.fn().mockResolvedValue(undefined),
  mockRestartPendingUpdate: vi.fn().mockResolvedValue(undefined),
  mockGetRunningVersion: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/data/updateSubscription', () => ({
  getUpdateSnapshot: mockGetUpdateSnapshot,
  subscribeUpdate: mockSubscribeUpdate,
  checkForUpdate: mockCheckForUpdate,
  restartPendingUpdate: mockRestartPendingUpdate,
  getRunningVersion: mockGetRunningVersion,
}));

function makeResponse(
  overrides: Partial<FirstRunRestartResponse> = {},
): FirstRunRestartResponse {
  return {
    restartedAt: '2026-07-03T00:00:00Z',
    prefilledSources: [
      {
        sourceId: 'src-1',
        kind: 'light_frames',
        path: '/astro/lights',
        createdAt: '2026-01-01T00:00:00Z',
        organizationState: 'organized',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({ values: {} });
  mockNavigate.mockResolvedValue(undefined);
  mockGetUpdateSnapshot.mockReturnValue({ phase: 'idle' });
  mockSubscribeUpdate.mockReturnValue(() => {});
  mockGetRunningVersion.mockResolvedValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Advanced — first-run setup restart control (spec 003 US3)', () => {
  it('renders a distinctly-labeled first-run restart control', async () => {
    render(<Advanced save={vi.fn()} />);

    expect(
      await screen.findByTestId('firstrun-restart-btn'),
    ).toBeInTheDocument();
  });

  it('requires a confirm step before calling restartFirstRun', async () => {
    render(<Advanced save={vi.fn()} />);

    const trigger = await screen.findByTestId('firstrun-restart-btn');
    fireEvent.click(trigger);

    expect(mockRestartFirstRun).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId('firstrun-restart-confirm-btn'),
    ).toBeInTheDocument();
  });

  it('cancels back to the initial control without calling restartFirstRun', async () => {
    render(<Advanced save={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('firstrun-restart-btn'));
    const cancelBtn = await screen.findByText(/cancel/i);
    fireEvent.click(cancelBtn);

    expect(mockRestartFirstRun).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('firstrun-restart-btn')).toBeInTheDocument();
    });
  });

  it('on confirm, calls restartFirstRun, prefills the wizard buffer, clears the completion cache, and navigates to /setup', async () => {
    mockRestartFirstRun.mockResolvedValue(makeResponse());
    render(<Advanced save={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('firstrun-restart-btn'));
    fireEvent.click(await screen.findByTestId('firstrun-restart-confirm-btn'));

    await waitFor(() => {
      expect(mockRestartFirstRun).toHaveBeenCalledTimes(1);
    });

    expect(mockResetWizardStateWithSources).toHaveBeenCalledWith([
      {
        path: '/astro/lights',
        kind: 'light_frames',
        organizationState: 'organized',
      },
    ]);
    expect(mockSetPreference).toHaveBeenCalledWith('setupCompleted', false);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/setup' });
  });

  it('shows an inline error and stays on the pane when restartFirstRun fails', async () => {
    mockRestartFirstRun.mockRejectedValue(new Error('database unavailable'));
    render(<Advanced save={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('firstrun-restart-btn'));
    fireEvent.click(await screen.findByTestId('firstrun-restart-confirm-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'database unavailable',
      );
    });
    expect(mockResetWizardStateWithSources).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
