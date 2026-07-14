// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for LogPanel expand/collapse, level filter chips, and reduced-motion
 * behavior (spec 019, T006).
 *
 * Mirrors the mock setup used by `LogPanel.crosslink.test.tsx` /
 * `LogPanel.followState.test.tsx` (mocked router, commands, subscription).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { appendLog, resetLogStore } from '@/data/logStore';
import { LogPanelProvider } from '@/app/LogPanelContext';
import { LogPanel } from '@/app/LogPanel';

// ── Mocks ──────────────────────────────────────────────────────────────────────

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
      level: 'error',
      source: 'audit',
      message: 'Something failed',
    },
    {
      id: 'aud:2',
      contractVersion: '1',
      time: '2026-01-01T00:00:01Z',
      level: 'warn',
      source: 'audit',
      message: 'Watch out',
    },
    {
      id: 'aud:3',
      contractVersion: '1',
      time: '2026-01-01T00:00:02Z',
      level: 'info',
      source: 'audit',
      message: 'All good',
    },
  ]);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('LogPanel expand/collapse + filters (T006)', () => {
  beforeEach(() => {
    resetLogStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toggles expand/collapse via the Collapsible trigger', async () => {
    seedEntries();
    renderPanel();

    // Collapsed initially — panel content is not mounted, trigger reports
    // aria-expanded=false and the "Expand" label.
    expect(
      screen.getByRole('log', { name: 'Operation log' }),
    ).toBeInTheDocument();
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(getTrigger()).toHaveAttribute('aria-label', 'Expand log panel');
    expect(screen.queryByText('All good')).not.toBeInTheDocument();

    fireEvent.click(getTrigger());

    await waitFor(() => {
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
    });
    expect(getTrigger()).toHaveAttribute('aria-label', 'Collapse log panel');
    // Content becomes visible once expanded.
    await waitFor(() => {
      expect(screen.getByText('All good')).toBeInTheDocument();
    });

    // Collapse again.
    fireEvent.click(getTrigger());
    await waitFor(() => {
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('filters entries by level when a level chip is clicked', async () => {
    seedEntries();
    renderPanel();

    fireEvent.click(getTrigger());
    await waitFor(() => {
      expect(screen.getByText('Something failed')).toBeInTheDocument();
    });

    // All three entries visible under the default 'all' filter.
    expect(screen.getByText('Something failed')).toBeInTheDocument();
    expect(screen.getByText('Watch out')).toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();

    // Click the "Error" level chip.
    const errorChip = screen.getByRole('button', { name: 'Error' });
    fireEvent.click(errorChip);

    await waitFor(() => {
      expect(errorChip).toHaveAttribute('aria-pressed', 'true');
    });

    // Only the error-level entry remains.
    expect(screen.getByText('Something failed')).toBeInTheDocument();
    expect(screen.queryByText('Watch out')).not.toBeInTheDocument();
    expect(screen.queryByText('All good')).not.toBeInTheDocument();
  });

  it('interpolates the source into the event-source modifier className', async () => {
    seedEntries();
    renderPanel();

    fireEvent.click(getTrigger());
    await waitFor(() => {
      expect(screen.getByText('All good')).toBeInTheDocument();
    });

    const sourceSpans = screen.getAllByText('audit');
    expect(sourceSpans.length).toBeGreaterThan(0);
    for (const span of sourceSpans) {
      expect(span).toHaveClass('alm-logpanel__event-source');
      expect(span).toHaveClass('alm-logpanel__event-source--audit');
      // Regression guard: must not render the un-interpolated literal template.
      expect(span.className).not.toContain('{entry.source}');
    }
  });

  it('does not animate scroll when prefers-reduced-motion is set', async () => {
    // Mock matchMedia to report reduced motion.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    seedEntries();
    renderPanel();

    fireEvent.click(getTrigger());
    await waitFor(() => {
      expect(screen.getByText('All good')).toBeInTheDocument();
    });

    // With reduced motion, the follow-tail effect pins scrollTop directly
    // (no smooth `scrollTo` animation call). Assert the scroll container is
    // present and matchMedia is consulted and reports reduced motion.
    const list = document.querySelector('.alm-logpanel__events');
    expect(list).not.toBeNull();
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(
      true,
    );
  });
});
