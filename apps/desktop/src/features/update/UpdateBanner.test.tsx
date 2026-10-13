// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * UpdateBanner — the in-app update notice (astro-plan-mkkgi). The check only
 * reports; the banner offers Install now / Install on quit and starts
 * neither on its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpdateBanner } from './UpdateBanner';

const { mockGetUpdateSnapshot, mockInstallUpdateNow, mockInstallUpdateOnQuit } =
  vi.hoisted(() => ({
    mockGetUpdateSnapshot: vi.fn(),
    mockInstallUpdateNow: vi.fn().mockResolvedValue(undefined),
    mockInstallUpdateOnQuit: vi.fn().mockResolvedValue(undefined),
  }));
vi.mock('@/data/updateSubscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/updateSubscription')>()),
  getUpdateSnapshot: mockGetUpdateSnapshot,
  subscribeUpdate: () => () => {},
  installUpdateNow: mockInstallUpdateNow,
  installUpdateOnQuit: mockInstallUpdateOnQuit,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UpdateBanner', () => {
  it('renders nothing while up to date or after a failed check', () => {
    mockGetUpdateSnapshot.mockReturnValue({ phase: 'up-to-date' });
    const { rerender } = render(<UpdateBanner />);
    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();

    mockGetUpdateSnapshot.mockReturnValue({
      phase: 'check-failed',
      error: 'offline',
    });
    rerender(<UpdateBanner />);
    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();
  });

  it('shows the version, notes and both install choices without starting either', () => {
    mockGetUpdateSnapshot.mockReturnValue({
      phase: 'available',
      version: '0.7.0',
      body: 'Faster imports',
    });
    render(<UpdateBanner />);

    expect(screen.getByTestId('update-banner-status')).toHaveTextContent(
      '0.7.0',
    );
    expect(screen.getByTestId('update-banner-notes')).toHaveTextContent(
      'Faster imports',
    );
    expect(mockInstallUpdateNow).not.toHaveBeenCalled();
    expect(mockInstallUpdateOnQuit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('update-banner-install-on-quit-btn'));
    expect(mockInstallUpdateOnQuit).toHaveBeenCalledTimes(1);
    expect(mockInstallUpdateNow).not.toHaveBeenCalled();
  });

  it('Later hides the notice for that version without installing', () => {
    mockGetUpdateSnapshot.mockReturnValue({
      phase: 'available',
      version: '0.7.0',
    });
    render(<UpdateBanner />);

    fireEvent.click(screen.getByTestId('update-banner-later-btn'));

    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument();
    expect(mockInstallUpdateNow).not.toHaveBeenCalled();
    expect(mockInstallUpdateOnQuit).not.toHaveBeenCalled();
  });
});
