// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * InboxPage stale-selection gating (#735 item 1).
 *
 * Page-level WIRING, deliberately not hook logic: `use-stale-selection.test.tsx`
 * feeds the hook explicit booleans, so it structurally cannot catch a page that
 * derives `found` from a query result that is still empty because the list IPC
 * has not resolved yet. On a cold reload that misreads a perfectly valid
 * `?selected=` as stale and rewrites the URL without it.
 *
 * The second case is the one that matters most here: InboxPage already carries
 * a deliberately BOUNDED gate for the reclassify handoff (see
 * `resolveReclassifyHandoff`), whose whole point is that the gate must not stay
 * open forever. Adding `listLoading` must not weaken that — once the list has
 * settled without the id, cleanup still fires.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const { mockRootsList, mockInboxList, mockInboxPlanListOpen } = vi.hoisted(
  () => ({
    mockRootsList: vi.fn(),
    mockInboxList: vi.fn(),
    mockInboxPlanListOpen: vi.fn(),
  }),
);

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inboxList: mockInboxList,
    inboxPlanListOpen: mockInboxPlanListOpen,
  },
}));

const mockNavigate = vi.fn();
const mockSelectedId = { current: undefined as string | undefined };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: mockSelectedId.current, type: undefined }),
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectedId.current = undefined;
  mockRootsList.mockResolvedValue(ok([]));
  mockInboxList.mockResolvedValue(ok({ items: [], capped: false, limit: 500 }));
  mockInboxPlanListOpen.mockResolvedValue(ok({ plans: [], totalActions: 0 }));
});

import { InboxPage } from '../InboxPage';

describe('InboxPage stale-selection gating (#735)', () => {
  it('keeps a valid ?selected= while inbox.list is still in flight', () => {
    mockInboxList.mockReturnValue(new Promise(() => {}));
    mockSelectedId.current = 'item-1';

    render(<InboxPage />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('still clears a genuinely absent id once the list has settled', async () => {
    mockSelectedId.current = 'item-gone';

    render(<InboxPage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ replace: true }),
      ),
    );
  });
});
