/// <reference types="@testing-library/jest-dom" />
/**
 * SourceViewsSection tests — spec 026 T016 stale badge + broken-reference
 * detail (T014/T015 sweep data, already fresh from `preparedview.list` on
 * load) and T019 audit-history wiring.
 *
 * `ViewAuditHistory` has its own dedicated test file; here it's mocked so
 * these tests stay scoped to SourceViewsSection's own rendering logic.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn(),
}));

vi.mock('./source-views', async () => {
  const actual = await vi.importActual<typeof import('./source-views')>('./source-views');
  return {
    ...actual,
    listPreparedViews: mockList,
  };
});

vi.mock('./ViewAuditHistory', () => ({
  ViewAuditHistory: ({ viewId }: { viewId: string }) => (
    <div data-testid={`mock-history-${viewId}`} />
  ),
}));

vi.mock('./GenerateSourceViewDialog', () => ({
  GenerateSourceViewDialog: () => null,
}));

import { SourceViewsSection } from './SourceViewsSection';
import type { PreparedViewSummary } from './source-views';

beforeEach(() => {
  vi.resetAllMocks();
});

const staleView: PreparedViewSummary = {
  id: 'view-stale',
  projectId: 'proj-1',
  kind: 'symlink',
  state: 'stale',
  createdAt: '2026-01-01T00:00:00Z',
  itemCount: 2,
  items: [
    {
      id: 'item-ok',
      inventoryItemId: 'inv-ok',
      viewRelativePath: '/dest/ok.fits',
      materialization: 'symlink',
      lastObservedState: 'present',
    },
    {
      id: 'item-broken',
      inventoryItemId: 'inv-broken',
      viewRelativePath: '/dest/broken.fits',
      materialization: 'symlink',
      lastObservedState: 'missing',
    },
  ],
};

const currentView: PreparedViewSummary = {
  id: 'view-current',
  projectId: 'proj-1',
  kind: 'symlink',
  state: 'current',
  createdAt: '2026-01-01T00:00:00Z',
  itemCount: 1,
  items: [
    {
      id: 'item-clean',
      inventoryItemId: 'inv-clean',
      viewRelativePath: '/dest/clean.fits',
      materialization: 'symlink',
      lastObservedState: 'present',
    },
  ],
};

describe('SourceViewsSection', () => {
  it('shows the stale badge and per-item broken-reference detail from sweep data', async () => {
    mockList.mockResolvedValueOnce({ views: [staleView] });

    render(<SourceViewsSection projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('source-view-row-view-stale')).toBeInTheDocument();
    });

    expect(screen.getByText('Stale')).toBeInTheDocument();

    // Broken-reference detail rides the sweep's last_observed_state — no
    // Verify click required.
    expect(screen.getByTestId('source-view-item-observed-item-broken')).toHaveTextContent(
      'missing',
    );
    expect(screen.queryByTestId('source-view-item-observed-item-ok')).not.toBeInTheDocument();

    // Persisted stale-item summary banner.
    const summary = screen.getByTestId('stale-summary-view-stale');
    expect(summary).toHaveTextContent('1 item(s) need attention');
  });

  it('does not show broken-reference detail or the stale summary for a current view', async () => {
    mockList.mockResolvedValueOnce({ views: [currentView] });

    render(<SourceViewsSection projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('source-view-row-view-current')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('source-view-item-observed-item-clean')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-summary-view-current')).not.toBeInTheDocument();
  });

  it('renders the audit-history surface for each view (T019)', async () => {
    mockList.mockResolvedValueOnce({ views: [currentView] });

    render(<SourceViewsSection projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-history-view-current')).toBeInTheDocument();
    });
  });

  it('offers Regenerate for a sweep-observed missing view', async () => {
    mockList.mockResolvedValueOnce({
      views: [{ ...staleView, id: 'view-missing', state: 'missing' }],
    });

    render(<SourceViewsSection projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('regenerate-view-view-missing')).toBeInTheDocument();
    });
  });
});
