// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LogPanel expand/collapse persistence (#842).
 *
 * Split into its own file (rather than living in LogPanel.test.tsx /
 * LogPanel.followScroll.test.tsx) to avoid colliding with g-audit-log's
 * concurrent edits to those same test files' end-of-file sections.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { appendLog, resetLogStore } from '@/data/logStore';
import {
  LogPanelProvider,
  LOG_PANEL_EXPANDED_LS_KEY,
  _logPanelExpandedStateForTest,
} from '@/app/LogPanelContext';
import { LogPanel } from '@/app/LogPanel';
import { __resetScopeRegistryForTest } from '@/data/persisted-state';

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/data/logSubscription', () => ({
  startLogSubscription: vi.fn().mockResolvedValue(undefined),
}));

function renderPanel() {
  return render(
    <LogPanelProvider>
      <LogPanel />
    </LogPanelProvider>,
  );
}

// Helper to find the Collapsible trigger button regardless of open/closed label.
function getTrigger() {
  const triggers = screen.getAllByRole('button');
  const trigger = triggers.find((b) =>
    ['Expand log panel', 'Collapse log panel'].includes(
      b.getAttribute('aria-label') ?? '',
    ),
  );
  if (!trigger) throw new Error('log panel trigger not found');
  return trigger;
}

function seedEntries() {
  appendLog([
    {
      id: 'aud:1',
      contractVersion: '1',
      time: '2026-01-01T00:00:00Z',
      level: 'info',
      source: 'audit',
      message: 'All good',
    },
  ]);
}

describe('LogPanel expanded persists across restart (#842)', () => {
  beforeEach(() => {
    resetLogStore();
    vi.clearAllMocks();
    localStorage.clear();
    // Reset the persisted-state module singleton so each test starts fresh.
    __resetScopeRegistryForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    __resetScopeRegistryForTest();
  });

  it('persists expand to localStorage and restores it on remount', async () => {
    seedEntries();
    const { unmount } = renderPanel();

    expect(getTrigger()).toHaveAttribute('aria-label', 'Expand log panel');
    fireEvent.click(getTrigger());
    await waitFor(() => {
      expect(getTrigger()).toHaveAttribute('aria-label', 'Collapse log panel');
    });
    expect(localStorage.getItem(LOG_PANEL_EXPANDED_LS_KEY)).toBe('true');

    // Simulate an app restart: unmount (provider state is discarded) and
    // mount a fresh provider — it must read the persisted flag instead of
    // defaulting to collapsed.
    unmount();
    renderPanel();
    expect(getTrigger()).toHaveAttribute('aria-label', 'Collapse log panel');
  });

  it('persists collapse back to localStorage', async () => {
    // Seed the initial expanded state via the module singleton (equivalent to
    // what the old localStorage.setItem('alm-log-panel-expanded', 'true') did).
    _logPanelExpandedStateForTest.set(true);
    seedEntries();
    renderPanel();

    expect(getTrigger()).toHaveAttribute('aria-label', 'Collapse log panel');
    fireEvent.click(getTrigger());
    await waitFor(() => {
      expect(getTrigger()).toHaveAttribute('aria-label', 'Expand log panel');
    });
    expect(localStorage.getItem(LOG_PANEL_EXPANDED_LS_KEY)).toBe('false');
  });
});
