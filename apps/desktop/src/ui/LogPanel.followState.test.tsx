/**
 * Tests for LogPanel follow-state wiring (spec 019, T010).
 *
 * Verifies that:
 * - `rememberFollowLogs` is read from settings on `LogPanelProvider` mount.
 * - Toggling follow calls `updateSettings` with the new value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { LogPanelProvider, useLogPanel } from '@/app/LogPanelContext';

// ── Mock Tauri commands ────────────────────────────────────────────────────────

const mockGetSettings = vi.fn().mockResolvedValue({
  scope: 'advanced',
  values: { logLevel: 'info', rememberFollowLogs: true },
});
const mockUpdateSettings = vi.fn().mockResolvedValue(undefined);

vi.mock('@/api/commands', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));

// ── Test helper component ─────────────────────────────────────────────────────

function FollowStateDisplay() {
  const { followLogs, setFollowLogs } = useLogPanel();
  return (
    <div>
      <span data-testid="follow-state">{followLogs ? 'on' : 'off'}</span>
      <button onClick={() => setFollowLogs(!followLogs)}>toggle</button>
    </div>
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('LogPanel follow state (T010)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads rememberFollowLogs from settings on mount', async () => {
    mockGetSettings.mockResolvedValue({
      scope: 'advanced',
      values: { logLevel: 'info', rememberFollowLogs: true },
    });

    const { getByTestId } = render(
      <LogPanelProvider>
        <FollowStateDisplay />
      </LogPanelProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('follow-state').textContent).toBe('on');
    });
    expect(mockGetSettings).toHaveBeenCalledWith({ scope: 'advanced' });
  });

  it('defaults to follow=false when settings returns false', async () => {
    mockGetSettings.mockResolvedValue({
      scope: 'advanced',
      values: { logLevel: 'info', rememberFollowLogs: false },
    });

    const { getByTestId } = render(
      <LogPanelProvider>
        <FollowStateDisplay />
      </LogPanelProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('follow-state').textContent).toBe('off');
    });
  });

  it('calls updateSettings when follow is toggled', async () => {
    mockGetSettings.mockResolvedValue({
      scope: 'advanced',
      values: { logLevel: 'info', rememberFollowLogs: false },
    });

    const { getByRole } = render(
      <LogPanelProvider>
        <FollowStateDisplay />
      </LogPanelProvider>,
    );

    // Wait for settings to load.
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());

    fireEvent.click(getByRole('button', { name: 'toggle' }));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        scope: 'advanced',
        values: { rememberFollowLogs: true },
      });
    });
  });

  it('updates local state immediately on toggle (optimistic)', async () => {
    mockGetSettings.mockResolvedValue({
      scope: 'advanced',
      values: { logLevel: 'info', rememberFollowLogs: false },
    });

    const { getByTestId, getByRole } = render(
      <LogPanelProvider>
        <FollowStateDisplay />
      </LogPanelProvider>,
    );

    await waitFor(() => expect(getByTestId('follow-state').textContent).toBe('off'));
    fireEvent.click(getByRole('button', { name: 'toggle' }));
    expect(getByTestId('follow-state').textContent).toBe('on');
  });
});
