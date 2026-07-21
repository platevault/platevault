// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Issue #943 / spec 008 US7 (FR-019/FR-020/FR-022, SC-008) — the attribution
 * pick reaches `inbox.confirm`.
 *
 * The candidates used to exist only on the `inbox.confirm` RESPONSE, while
 * `chosenAttribution` was only accepted on the confirm REQUEST — and a second
 * confirm on the same item is rejected by the open-plan guard. So the pick was
 * unreachable. These tests pin the read-only `inbox.attribution.suggest`
 * pre-confirm gate that breaks that cycle:
 *
 * 1. Confirming a light item with candidates does NOT confirm outright — it
 *    surfaces the picker (FR-020: suggest, never auto-merge).
 * 2. The user's pick rides a SINGLE `inbox.confirm` as `chosenAttribution`.
 * 3. No candidates → confirm proceeds unchanged (no picker in the way).
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
  mockInboxAttributionSuggest,
  mockProjectsList,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockInboxList: vi.fn(),
  mockInboxPlanListOpen: vi.fn(),
  mockInboxClassify: vi.fn(),
  mockInboxItemMetadata: vi.fn(),
  mockInboxConfirm: vi.fn(),
  mockInboxAttributionSuggest: vi.fn(),
  mockProjectsList: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inboxList: mockInboxList,
    inboxPlanListOpen: mockInboxPlanListOpen,
    inboxClassify: mockInboxClassify,
    inboxItemMetadata: mockInboxItemMetadata,
    inboxConfirm: mockInboxConfirm,
    inboxAttributionSuggest: mockInboxAttributionSuggest,
    projectsList: mockProjectsList,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ selected: 'item-light', type: undefined }),
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

const lightItem = {
  inboxItemId: 'item-light',
  groupId: 'item-light',
  groupKey: '',
  rootId: 'root-inbox',
  rootAbsolutePath: '/astro/inbox',
  relativePath: 'lights/NGC7000',
  fileCount: 12,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-light',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
  organizationState: 'unorganized',
};

const candidates = [
  {
    kind: 'add_to_framing',
    projectId: 'proj-001',
    framingId: 'framing-001',
    targetId: 'target-ngc7000',
    matchScore: 0.94,
    reopen: false,
    opticMismatch: false,
  },
  {
    kind: 'new_project',
    projectId: null,
    framingId: null,
    targetId: null,
    matchScore: 0,
    reopen: false,
    opticMismatch: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockRootsList.mockResolvedValue(
    ok([
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
    ok({ items: [lightItem], capped: false, limit: 500 }),
  );
  mockInboxPlanListOpen.mockResolvedValue(ok({ plans: [], totalActions: 0 }));
  mockInboxClassify.mockResolvedValue(
    ok({ type: 'single_type', frameType: 'light', unclassifiedFiles: [] }),
  );
  mockInboxItemMetadata.mockResolvedValue(ok({ files: [] }));
  mockInboxConfirm.mockResolvedValue(
    ok({ itemsTotal: 12, destinations: [], planId: 'plan-1' }),
  );
  mockInboxAttributionSuggest.mockResolvedValue(ok(candidates));
  mockProjectsList.mockResolvedValue(
    ok([{ id: 'proj-001', name: 'NGC 7000 — HaOIII' }]),
  );
});

import { InboxPage } from '../InboxPage';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <PageStatusProvider>
        <InboxPage />
      </PageStatusProvider>
    </QueryClientProvider>,
  );
}

describe('Inbox attribution pick reaches confirm (#943, SC-008)', () => {
  it('surfaces the picker instead of confirming when candidates exist', async () => {
    renderPage();
    await screen.findByTestId('inbox-dest-root-select');
    fireEvent.click(await screen.findByTestId('inbox-confirm-btn'));

    await screen.findByTestId('inbox-attribution-picker');
    // FR-020: nothing is merged, and no plan is created, until the user picks.
    expect(mockInboxAttributionSuggest).toHaveBeenCalledWith('item-light');
    expect(mockInboxConfirm).not.toHaveBeenCalled();
  });

  it('sends the picked candidate as chosenAttribution on a single confirm', async () => {
    renderPage();
    await screen.findByTestId('inbox-dest-root-select');
    fireEvent.click(await screen.findByTestId('inbox-confirm-btn'));
    await screen.findByTestId('inbox-attribution-picker');

    // Pick the top-ranked framing match by its resolved project name.
    // The project name resolves via a separate projects.list query.
    fireEvent.click(await screen.findByText(/NGC 7000 — HaOIII/));
    fireEvent.click(screen.getByTestId('inbox-attribution-confirm'));

    await vi.waitFor(() => expect(mockInboxConfirm).toHaveBeenCalledTimes(1));
    expect(mockInboxConfirm.mock.calls[0][0]).toMatchObject({
      inboxItemId: 'item-light',
      chosenAttribution: {
        kind: 'add_to_framing',
        projectId: 'proj-001',
        framingId: 'framing-001',
      },
    });
  });

  it('confirms directly when there is nothing to attribute', async () => {
    mockInboxAttributionSuggest.mockResolvedValue(ok([]));
    renderPage();
    await screen.findByTestId('inbox-dest-root-select');
    fireEvent.click(await screen.findByTestId('inbox-confirm-btn'));

    await vi.waitFor(() => expect(mockInboxConfirm).toHaveBeenCalledTimes(1));
    // The store normalises an absent pick to an explicit null.
    expect(mockInboxConfirm.mock.calls[0][0].chosenAttribution).toBeNull();
    expect(screen.queryByTestId('inbox-attribution-picker')).toBeNull();
  });
});
