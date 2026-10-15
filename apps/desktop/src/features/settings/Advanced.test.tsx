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
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery as render } from '@/test/renderWithQuery';
import { Advanced } from './Advanced';
import type { FirstRunRestartResponse } from './settingsIpc';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

const { mockGetSettingsTyped, mockRestartFirstRun } = vi.hoisted(() => ({
  mockGetSettingsTyped: vi.fn().mockResolvedValue({}),
  mockRestartFirstRun: vi.fn(),
}));
vi.mock('./settingsIpc', () => ({
  getSettingsTyped: mockGetSettingsTyped,
  restartFirstRun: mockRestartFirstRun,
}));

// `setPreference`/`resetPreferences` are spies for the first-run and reset
// controls; the rest of the store stays real, so the "Check for updates
// automatically" toggle persists through `usePreference` to jsdom
// localStorage. `actualReset` clears the real store between tests.
const prefs = vi.hoisted(() => ({
  mockSetPreference: vi.fn(),
  mockResetPreferences: vi.fn(),
  actualReset: (): void => {},
}));
const { mockSetPreference, mockResetPreferences } = prefs;
vi.mock('@/data/preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/preferences')>();
  prefs.actualReset = actual.resetPreferences;
  return {
    ...actual,
    setPreference: prefs.mockSetPreference,
    resetPreferences: prefs.mockResetPreferences,
  };
});

const { mockResetWizardStateWithSources } = vi.hoisted(() => ({
  mockResetWizardStateWithSources: vi.fn(),
}));
vi.mock('@/features/setup/sources-store', () => ({
  resetWizardStateWithSources: mockResetWizardStateWithSources,
}));

// Update section (#845/#873, astro-plan-5wcib) — the actions are mocked so
// each test controls the phase directly instead of reaching the backend
// updater; the pure `canInstall` stays real.
const {
  mockGetUpdateSnapshot,
  mockSubscribeUpdate,
  mockCheckForUpdate,
  mockInstallUpdateNow,
  mockInstallUpdateOnQuit,
  mockGetRunningVersion,
} = vi.hoisted(() => ({
  mockGetUpdateSnapshot: vi.fn().mockReturnValue({ phase: 'idle' }),
  mockSubscribeUpdate: vi.fn().mockReturnValue(() => {}),
  mockCheckForUpdate: vi.fn().mockResolvedValue(undefined),
  mockInstallUpdateNow: vi.fn().mockResolvedValue(undefined),
  mockInstallUpdateOnQuit: vi.fn().mockResolvedValue(undefined),
  mockGetRunningVersion: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/data/updateSubscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/updateSubscription')>()),
  getUpdateSnapshot: mockGetUpdateSnapshot,
  subscribeUpdate: mockSubscribeUpdate,
  checkForUpdate: mockCheckForUpdate,
  installUpdateNow: mockInstallUpdateNow,
  installUpdateOnQuit: mockInstallUpdateOnQuit,
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
  mockGetSettingsTyped.mockResolvedValue({});
  mockNavigate.mockResolvedValue(undefined);
  mockGetUpdateSnapshot.mockReturnValue({ phase: 'idle' });
  mockSubscribeUpdate.mockReturnValue(() => {});
  mockGetRunningVersion.mockResolvedValue(null);
  prefs.actualReset();
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

    // All three run only after `await restartFirstRun()` RESOLVES
    // (Advanced.tsx:154-169); the waitFor above proves only that the IPC was
    // dispatched. Asserting them synchronously fails with "Number of calls: 0"
    // whenever the response lands a tick late (#1083).
    await waitFor(() => {
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
// ── Software Update section (#845 version display, astro-plan-mkkgi
// install-on-choice, #869 relaunch-after-install, #873 failed-check states) ──

describe('Advanced — Software Update section', () => {
  it('shows the running app version when available (#845)', async () => {
    mockGetRunningVersion.mockResolvedValue('0.5.0');
    render(<Advanced save={vi.fn()} />);

    expect(
      await screen.findByTestId('update-running-version'),
    ).toHaveTextContent('0.5.0');
  });

  it('hides the running-version row when unavailable (mock/browser dev)', async () => {
    mockGetRunningVersion.mockResolvedValue(null);
    render(<Advanced save={vi.fn()} />);

    await screen.findByTestId('update-status');
    expect(
      screen.queryByTestId('update-running-version'),
    ).not.toBeInTheDocument();
  });

  it('shows "up to date" with a manual check, and no retry or install controls', async () => {
    mockGetUpdateSnapshot.mockReturnValue({ phase: 'up-to-date' });
    render(<Advanced save={vi.fn()} />);

    expect(await screen.findByTestId('update-status')).toHaveTextContent(
      /latest version/i,
    );
    expect(screen.getByTestId('update-check-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('update-retry-btn')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('update-install-now-btn'),
    ).not.toBeInTheDocument();
  });

  it('says no check has run yet when idle, instead of "up to date"', async () => {
    render(<Advanced save={vi.fn()} />);

    const status = await screen.findByTestId('update-status');
    expect(status).toHaveTextContent(/hasn't checked/i);
    expect(status).not.toHaveTextContent(/latest version/i);
  });

  it('turns "Check for updates automatically" on by default', async () => {
    render(<Advanced save={vi.fn()} />);

    expect(
      await screen.findByLabelText('Check for updates automatically'),
    ).toBeChecked();
  });

  it('keeps "Check for updates automatically" off across a reload', async () => {
    render(<Advanced save={vi.fn()} />);
    const toggle = await screen.findByLabelText(
      'Check for updates automatically',
    );

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).not.toBeChecked());
    // A reload starts a fresh module instance that reads localStorage.
    vi.resetModules();
    const reloaded =
      await vi.importActual<typeof import('@/data/preferences')>(
        '@/data/preferences',
      );
    expect(reloaded.getPreferences().checkUpdatesAutomatically).toBe(false);
  });

  it('checks for updates on request while the automatic check is off', async () => {
    render(<Advanced save={vi.fn()} />);
    fireEvent.click(
      await screen.findByLabelText('Check for updates automatically'),
    );

    fireEvent.click(screen.getByTestId('update-check-btn'));

    expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows a distinct check-failed state with a retry action, not "up to date" (#873)', async () => {
    mockGetUpdateSnapshot.mockReturnValue({
      phase: 'check-failed',
      error: 'network unreachable',
    });
    render(<Advanced save={vi.fn()} />);

    const status = await screen.findByTestId('update-status');
    expect(status).toHaveTextContent(/couldn't check/i);
    expect(status).not.toHaveTextContent(/latest version/i);

    fireEvent.click(await screen.findByTestId('update-retry-btn'));
    expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
  });

  it('offers Install now and Install on quit for an available update, without starting either', async () => {
    mockGetUpdateSnapshot.mockReturnValue({
      phase: 'available',
      version: '0.6.0',
    });
    render(<Advanced save={vi.fn()} />);

    expect(await screen.findByTestId('update-status')).toHaveTextContent(
      /0\.6\.0 is available/,
    );
    expect(mockInstallUpdateNow).not.toHaveBeenCalled();
    expect(mockInstallUpdateOnQuit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('update-install-now-btn'));
    expect(mockInstallUpdateNow).toHaveBeenCalledTimes(1);
    const onQuit = screen.getByTestId('update-install-on-quit-btn');
    await waitFor(() => expect(onQuit).toBeEnabled());
    fireEvent.click(onQuit);
    expect(mockInstallUpdateOnQuit).toHaveBeenCalledTimes(1);
  });

  it('reads "will install when you quit" once queued, offering only Install now', async () => {
    mockGetUpdateSnapshot.mockReturnValue({
      phase: 'install-on-quit',
      version: '0.6.0',
    });
    render(<Advanced save={vi.fn()} />);

    expect(await screen.findByTestId('update-status')).toHaveTextContent(
      /install when you quit/i,
    );
    expect(screen.getByTestId('update-install-now-btn')).toBeInTheDocument();
    expect(
      screen.queryByTestId('update-install-on-quit-btn'),
    ).not.toBeInTheDocument();
  });
});

// ── Database info + Danger zone (#601/#602) ─────────────────────────────────
//
// Both controls used to be console.log no-ops (#601) and the Database panel
// hardcoded fabricated size/schema/record stats plus a pre-rename path
// (#602). Export database has no real backend yet — it must render as
// honestly disabled, not a live-looking no-op. Reset preferences has a real,
// local-only implementation (`resetPreferences()`) and is wired for real.

describe('Advanced — Database info panel (#602)', () => {
  it('shows only the real, static Engine fact — no fabricated size/schema/record counts', async () => {
    render(<Advanced save={vi.fn()} />);

    expect(await screen.findByText('SQLite')).toBeInTheDocument();
    expect(screen.queryByText('24.8 MB')).not.toBeInTheDocument();
    expect(screen.queryByText('v1.0')).not.toBeInTheDocument();
    expect(screen.queryByText(/142,318 files/)).not.toBeInTheDocument();
    expect(
      screen.queryByText('~/.alm/astro-library.db'),
    ).not.toBeInTheDocument();
  });

  it('renders "Export database" disabled with an explanatory title, not a silent no-op', async () => {
    render(<Advanced save={vi.fn()} />);

    const exportBtn = await screen.findByText('Export database');
    expect(exportBtn.closest('button')).toBeDisabled();
    expect(exportBtn.closest('button')).toHaveAttribute(
      'title',
      "Database export isn't implemented yet",
    );
  });
});

describe('Advanced — Reset preferences (#601)', () => {
  it('requires a confirm step before calling resetPreferences', async () => {
    render(<Advanced save={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('reset-preferences-btn'));

    expect(mockResetPreferences).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId('reset-preferences-confirm-btn'),
    ).toBeInTheDocument();
  });

  it('on confirm, calls the real resetPreferences() and shows a success message', async () => {
    render(<Advanced save={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('reset-preferences-btn'));
    fireEvent.click(await screen.findByTestId('reset-preferences-confirm-btn'));

    await waitFor(() => {
      expect(mockResetPreferences).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByTestId('reset-preferences-done'),
    ).toBeInTheDocument();
  });
});
