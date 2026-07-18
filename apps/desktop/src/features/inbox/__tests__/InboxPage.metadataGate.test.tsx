// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Issue #643 — Inbox per-file metadata intermittently never loads; the
 * Confirm gate must fail SAFE (disabled) while metadata is loading or
 * errored, not silently enable Confirm on an item the backend would refuse.
 *
 * Root cause: `InboxPage` only destructured `data` from `useInboxItemMetadata`
 * and computed `hasMissingRequiredMeta` over the (empty) fallback array while
 * the query was still pending/failed — `canConfirm` then judged an empty
 * file list as "nothing missing" and enabled Confirm.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
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

const {
  mockRootsList,
  mockInboxList,
  mockInboxPlanListOpen,
  mockInboxClassify,
  mockInboxItemMetadata,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockInboxList: vi.fn(),
  mockInboxPlanListOpen: vi.fn(),
  mockInboxClassify: vi.fn(),
  mockInboxItemMetadata: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inboxList: mockInboxList,
    inboxPlanListOpen: mockInboxPlanListOpen,
    inboxClassify: mockInboxClassify,
    inboxItemMetadata: mockInboxItemMetadata,
  },
}));

// Selection is by item id (issue #644) — the fixture list below has exactly
// one item, so its id always resolves to it.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ selected: 'item-001', type: undefined }),
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

const item = {
  inboxItemId: 'item-001',
  groupId: 'item-001',
  groupKey: '',
  rootId: 'root-001',
  rootAbsolutePath: '/astro/inbox',
  relativePath: 'lights/NGC7000',
  fileCount: 1,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-a',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
  organizationState: 'unorganized',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRootsList.mockResolvedValue(ok([]));
  mockInboxList.mockResolvedValue(
    ok({ items: [item], capped: false, limit: 500 }),
  );
  mockInboxPlanListOpen.mockResolvedValue(ok({ plans: [], totalActions: 0 }));
  mockInboxClassify.mockResolvedValue(
    ok({ type: 'single_type', frameType: 'light', unclassifiedFiles: [] }),
  );
});

import { InboxPage } from '../InboxPage';

describe('InboxPage confirm gate vs. per-file metadata load state (#643)', () => {
  it('keeps Confirm disabled while metadata is still loading (never resolves)', async () => {
    // Simulate the stuck-fetch repro: the metadata promise never settles.
    mockInboxItemMetadata.mockReturnValue(new Promise(() => {}));
    render(<InboxPage />);

    await waitFor(() => expect(mockInboxClassify).toHaveBeenCalled());

    const confirmBtn = await screen.findByTestId('inbox-confirm-btn');
    expect(confirmBtn).toBeDisabled();
  });

  it('keeps Confirm disabled when the metadata fetch errors', async () => {
    mockInboxItemMetadata.mockRejectedValue(new Error('boom'));
    render(<InboxPage />);

    await waitFor(() => expect(mockInboxClassify).toHaveBeenCalled());

    const confirmBtn = await screen.findByTestId('inbox-confirm-btn');
    await waitFor(() => expect(confirmBtn).toBeDisabled());
  });

  it('enables Confirm once metadata resolves with no missing attributes', async () => {
    mockInboxItemMetadata.mockResolvedValue(
      ok({
        inboxItemId: 'item-001',
        files: [
          {
            relativeFilePath: 'lights/NGC7000/frame_001.fits',
            missingPathAttributes: [],
            missingMandatory: [],
          },
        ],
      }),
    );
    render(<InboxPage />);

    await waitFor(() => expect(mockInboxClassify).toHaveBeenCalled());

    const confirmBtn = await screen.findByTestId('inbox-confirm-btn');
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
  });
});
