// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * InboxPage render-loop regression test (#557).
 *
 * The real app wraps every route in `PageStatusProvider` (see `Shell.tsx`).
 * `InboxPage` calls `useSetPageStatus(<span>...</span>)` with a JSX literal
 * built fresh on every render. A React element literal has a new identity on
 * every call even when its content is unchanged, so passing it directly (no
 * `useMemo`) as `useSetPageStatus`'s effect dependency makes the effect fire
 * on every render, call `setNode`, re-render the `PageStatusProvider` subtree
 * (which includes `InboxPage`), and repeat — "Maximum update depth exceeded".
 * This mirrors the reported console flood on `#/inbox` (issue #557); other
 * pages never call `useSetPageStatus`, so they're unaffected.
 *
 * This test mounts `InboxPage` inside the REAL `PageStatusProvider` (unlike
 * other Inbox tests that mock only `./store`) because the loop only manifests
 * when `setNode` actually triggers a state update — the context's default
 * no-op `setNode` would mask the bug entirely.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageStatusProvider } from '@/app/PageStatusContext';

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <PageStatusProvider>{ui}</PageStatusProvider>
    </QueryClientProvider>,
  );
}

// ── Mocks ─────────────────────────────────────────────────────────────────

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

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ selected: undefined, type: undefined }),
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

beforeEach(() => {
  vi.clearAllMocks();
  mockRootsList.mockResolvedValue(ok([]));
  mockInboxList.mockResolvedValue(ok({ items: [], capped: false, limit: 500 }));
  mockInboxPlanListOpen.mockResolvedValue(ok({ plans: [], totalActions: 0 }));
});

import { InboxPage } from '../InboxPage';

describe('InboxPage render loop (#557)', () => {
  it('does not exceed React\'s update-depth limit when mounted under the real PageStatusProvider', async () => {
    // A React error boundary can't catch "Maximum update depth exceeded" from
    // inside a render-phase effect loop in jsdom the same way the browser
    // does, but the loop DOES throw synchronously out of the render() call
    // (or floods console.error) before the fix — so we assert BOTH: render
    // completes, and no update-depth error was logged.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<InboxPage />)).not.toThrow();

    // Let any pending microtasks/effects settle.
    await waitFor(() => expect(mockInboxList).toHaveBeenCalled());

    const loopErrors = errorSpy.mock.calls.filter((args) =>
      args.some(
        (a) =>
          typeof a === 'string' && a.includes('Maximum update depth exceeded'),
      ),
    );
    expect(loopErrors).toHaveLength(0);
    errorSpy.mockRestore();
  });
});
