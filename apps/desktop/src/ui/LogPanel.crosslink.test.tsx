// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for LogPanel cross-link row behavior (spec 019, T017).
 *
 * Verifies that:
 * - A row with `entityType` + `entityId` calls navigate with the entity path.
 * - A row with only `requestId` calls navigate to the audit timeline.
 * - A plain row (no entity, no requestId) is not interactive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { appendLog, resetLogStore } from '@/data/logStore';
import { LogPanelProvider } from '@/app/LogPanelContext';
import { LogPanel } from '@/app/LogPanel';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        scope: 'advanced',
        values: { logLevel: 'info', rememberFollowLogs: false },
      },
    }),
    settingsUpdate: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    logExport: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        contractVersion: '2.0.0',
        requestId: 'r',
        filePath: '/tmp/x.json',
        count: 0,
        status: 'success',
      },
    }),
  },
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

// Helper to expand the panel.
function expandPanel() {
  // Find and click the trigger.
  const triggers = screen.getAllByRole('button');
  const trigger = triggers.find(
    (b) => b.getAttribute('aria-label') === 'Expand log panel',
  );
  if (trigger) fireEvent.click(trigger);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('LogPanel cross-link behavior (T017)', () => {
  beforeEach(() => {
    resetLogStore();
    vi.clearAllMocks();
    mockNavigate.mockReturnValue(Promise.resolve());
  });

  it('does not link plan entities — no /plans/:id route exists yet (#626)', async () => {
    appendLog([
      {
        id: 'aud:10',
        contractVersion: '1',
        time: '2026-01-01T00:00:00Z',
        level: 'info',
        source: 'plan',
        message: 'Plan approved',
        entityType: 'plan',
        entityId: 'plan-abc',
      },
    ]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Plan approved')).toBeInTheDocument();
    });

    // Subject-context text still renders (#583); it's just not clickable.
    expect(screen.getByText('plan · plan-abc')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Plan approved.*navigate/ }),
    ).toBeNull();
  });

  it('navigates to the Settings audit pane when row has requestId but no entity', async () => {
    appendLog([
      {
        id: 'aud:11',
        contractVersion: '1',
        time: '2026-01-01T00:00:00Z',
        level: 'info',
        source: 'workflow',
        message: 'Workflow completed',
        requestId: 'req-xyz',
      },
    ]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Workflow completed')).toBeInTheDocument();
    });

    const row = screen.getByRole('button', {
      name: /Workflow completed.*navigate/,
    });
    fireEvent.click(row);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/settings/audit?requestId=req-xyz',
    });
  });

  it('navigates to the settings/catalogs pane for catalog entities (#626)', async () => {
    appendLog([
      {
        id: 'aud:14',
        contractVersion: '1',
        time: '2026-01-01T00:00:00Z',
        level: 'info',
        source: 'catalog',
        message: 'Catalog downloaded',
        entityType: 'catalog',
        entityId: 'gaia',
      },
    ]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Catalog downloaded')).toBeInTheDocument();
    });

    const row = screen.getByRole('button', {
      name: /Catalog downloaded.*navigate/,
    });
    fireEvent.click(row);

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/settings/catalogs' });
  });

  it('navigates to settings/audit for unknown entity types (#626)', async () => {
    appendLog([
      {
        id: 'aud:15',
        contractVersion: '1',
        time: '2026-01-01T00:00:00Z',
        level: 'info',
        source: 'settings',
        message: 'Setting changed',
        entityType: 'settings',
        entityId: 'advanced',
      },
    ]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Setting changed')).toBeInTheDocument();
    });

    const row = screen.getByRole('button', {
      name: /Setting changed.*navigate/,
    });
    fireEvent.click(row);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/settings/audit?entityType=settings&entityId=advanced',
    });
  });

  it('plain row without entity or requestId is not a button', async () => {
    appendLog([
      {
        id: 'aud:12',
        contractVersion: '1',
        time: '2026-01-01T00:00:00Z',
        level: 'debug',
        source: 'audit',
        message: 'Cache hit',
      },
    ]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Cache hit')).toBeInTheDocument();
    });

    // Should not have the navigate aria-label.
    expect(
      screen.queryByRole('button', { name: /Cache hit.*navigate/ }),
    ).toBeNull();
  });

  it('navigates to project path for project entities', async () => {
    appendLog([
      {
        id: 'aud:13',
        contractVersion: '1',
        time: '2026-01-01T00:00:00Z',
        level: 'info',
        source: 'project',
        message: 'Project created',
        entityType: 'project',
        entityId: 'proj-123',
      },
    ]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Project created')).toBeInTheDocument();
    });

    const row = screen.getByRole('button', {
      name: /Project created.*navigate/,
    });
    fireEvent.click(row);

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/projects/proj-123' });
  });
});
