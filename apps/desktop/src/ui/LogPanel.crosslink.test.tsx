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

vi.mock('@/api/commands', () => ({
  getSettings: vi.fn().mockResolvedValue({
    scope: 'advanced',
    values: { logLevel: 'info', rememberFollowLogs: false },
  }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  logExport: vi.fn().mockResolvedValue({ contractVersion: '1', requestId: 'r', filePath: '/tmp/x.json', count: 0 }),
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

  it('navigates to entity path when row has entityType + entityId', async () => {
    appendLog([{
      id: 'aud:10',
      contractVersion: '1',
      time: '2026-01-01T00:00:00Z',
      level: 'info',
      source: 'plan',
      message: 'Plan approved',
      entityType: 'plan',
      entityId: 'plan-abc',
    }]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Plan approved')).toBeInTheDocument();
    });

    const row = screen.getByRole('button', { name: /Plan approved.*navigate/ });
    fireEvent.click(row);

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/plans/plan-abc' });
  });

  it('navigates to audit timeline when row has requestId but no entity', async () => {
    appendLog([{
      id: 'aud:11',
      contractVersion: '1',
      time: '2026-01-01T00:00:00Z',
      level: 'info',
      source: 'workflow',
      message: 'Workflow completed',
      requestId: 'req-xyz',
    }]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Workflow completed')).toBeInTheDocument();
    });

    const row = screen.getByRole('button', { name: /Workflow completed.*navigate/ });
    fireEvent.click(row);

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/audit?requestId=req-xyz' });
  });

  it('plain row without entity or requestId is not a button', async () => {
    appendLog([{
      id: 'aud:12',
      contractVersion: '1',
      time: '2026-01-01T00:00:00Z',
      level: 'debug',
      source: 'audit',
      message: 'Cache hit',
    }]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Cache hit')).toBeInTheDocument();
    });

    // Should not have the navigate aria-label.
    expect(screen.queryByRole('button', { name: /Cache hit.*navigate/ })).toBeNull();
  });

  it('navigates to project path for project entities', async () => {
    appendLog([{
      id: 'aud:13',
      contractVersion: '1',
      time: '2026-01-01T00:00:00Z',
      level: 'info',
      source: 'project',
      message: 'Project created',
      entityType: 'project',
      entityId: 'proj-123',
    }]);

    renderPanel();
    expandPanel();

    await waitFor(() => {
      expect(screen.getByText('Project created')).toBeInTheDocument();
    });

    const row = screen.getByRole('button', { name: /Project created.*navigate/ });
    fireEvent.click(row);

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/projects/proj-123' });
  });
});
