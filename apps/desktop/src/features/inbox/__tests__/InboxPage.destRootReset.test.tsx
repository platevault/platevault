// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Issue #648 — the page-level `selectedDestRootId` survived a selection
 * change: picking a calibration root for a bias item, then selecting a light
 * item (whose applicable roots are the "raw" category), left the select
 * showing "Auto" (the stale id isn't among the new item's options, so the DOM
 * falls back to the first option) while the held state still pointed at the
 * invalid calibration root id — a confirm from there would send that hidden
 * stale root and the backend would reject it.
 *
 * Root cause: `InboxPage.tsx`'s `selectedDestRootId` `useState` was never
 * reset when `selectedItem` changed.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageStatusProvider } from '@/app/PageStatusContext';

const {
  mockRootsList,
  mockInboxList,
  mockInboxPlanListOpen,
  mockInboxClassify,
  mockInboxItemMetadata,
  mockInboxConfirm,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockInboxList: vi.fn(),
  mockInboxPlanListOpen: vi.fn(),
  mockInboxClassify: vi.fn(),
  mockInboxItemMetadata: vi.fn(),
  mockInboxConfirm: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inboxList: mockInboxList,
    inboxPlanListOpen: mockInboxPlanListOpen,
    inboxClassify: mockInboxClassify,
    inboxItemMetadata: mockInboxItemMetadata,
    inboxConfirm: mockInboxConfirm,
  },
}));

// Mutable selection the mocked router reads on every render, so a rerender
// with a new value simulates the user picking a different list row.
let currentSelected = 'item-bias';
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ selected: currentSelected, type: undefined }),
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

const biasItem = {
  inboxItemId: 'item-bias',
  groupId: 'item-bias',
  groupKey: '',
  rootId: 'root-inbox',
  rootAbsolutePath: '/astro/inbox',
  relativePath: 'calib/bias',
  fileCount: 2,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-bias',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
  organizationState: 'unorganized',
};

const lightItem = {
  ...biasItem,
  inboxItemId: 'item-light',
  relativePath: 'lights/NGC7000',
  contentSignature: 'sig-light',
};

beforeEach(() => {
  vi.clearAllMocks();
  currentSelected = 'item-bias';
  mockRootsList.mockResolvedValue(
    ok([
      {
        id: 'root-cal-1',
        path: '/lib/CalibrationA',
        category: 'calibration',
        online: true,
        fileCount: 0,
        active: true,
      },
      {
        id: 'root-cal-2',
        path: '/lib/CalibrationB',
        category: 'calibration',
        online: true,
        fileCount: 0,
        active: true,
      },
      {
        id: 'root-raw-1',
        path: '/lib/RawA',
        category: 'raw',
        online: true,
        fileCount: 0,
        active: true,
      },
      {
        id: 'root-raw-2',
        path: '/lib/RawB',
        category: 'raw',
        online: true,
        fileCount: 0,
        active: true,
      },
    ]),
  );
  mockInboxList.mockResolvedValue(
    ok({ items: [biasItem, lightItem], capped: false, limit: 500 }),
  );
  mockInboxPlanListOpen.mockResolvedValue(ok({ plans: [], totalActions: 0 }));
  mockInboxClassify.mockImplementation(async (args: { inboxItemId: string }) =>
    ok(
      args.inboxItemId === 'item-bias'
        ? { type: 'single_type', frameType: 'bias', unclassifiedFiles: [] }
        : { type: 'single_type', frameType: 'light', unclassifiedFiles: [] },
    ),
  );
  mockInboxItemMetadata.mockResolvedValue(ok({ files: [] }));
  mockInboxConfirm.mockResolvedValue(
    ok({ itemsTotal: 1, destinations: [], planId: 'plan-1' }),
  );
});

import { InboxPage } from '../InboxPage';

describe('Inbox destination-root pick does not leak across items (#648)', () => {
  it('does not send a stale destination root after switching to a different item', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <PageStatusProvider>
          <InboxPage />
        </PageStatusProvider>
      </QueryClientProvider>
    );
    const { rerender } = rtlRender(tree);

    // Pick the calibration root for the bias item.
    const select = (await screen.findByTestId(
      'inbox-dest-root-select',
    )) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'root-cal-1' } });
    expect(select.value).toBe('root-cal-1');

    // Switch to the light item — a different applicable-root category
    // (calibration roots aren't among ITS options). The DOM select then
    // shows "Auto" regardless (its stale value has no matching <option>),
    // so the real assertion is on the CONFIRM PAYLOAD, not the rendered
    // select value — the bug was the underlying React state staying
    // 'root-cal-1' and being silently SENT despite the picker visibly
    // reading "Auto".
    currentSelected = 'item-light';
    rerender(
      <QueryClientProvider client={queryClient}>
        <PageStatusProvider>
          <InboxPage />
        </PageStatusProvider>
      </QueryClientProvider>,
    );
    await screen.findByTestId('inbox-dest-root-select');

    fireEvent.click(screen.getByTestId('inbox-confirm-btn'));

    await vi.waitFor(() => expect(mockInboxConfirm).toHaveBeenCalled());
    const payload = mockInboxConfirm.mock.calls[0][0];
    expect(payload.rootId).not.toBe('root-cal-1');
    expect(payload.inboxItemId).toBe('item-light');
  });
});
