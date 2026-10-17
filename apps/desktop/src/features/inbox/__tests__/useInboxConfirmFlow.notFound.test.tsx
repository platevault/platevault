// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useInboxConfirmFlow — confirming an item that no longer exists
 * (bd astro-plan-3pvvc).
 *
 * Confirm answers `inbox.item.not_found` when the item is gone: another scan
 * removed it, or confirm itself removed a row stored under an old path that
 * names a different frame. The user sees the catalogue message for that code,
 * and the list reloads so the row disappears.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxListItem } from '@/bindings/index';

const { mockInboxConfirm, mockAttributionSuggest, mockAddToast } = vi.hoisted(
  () => ({
    mockInboxConfirm: vi.fn(),
    mockAttributionSuggest: vi.fn(),
    mockAddToast: vi.fn(),
  }),
);

vi.mock('@/bindings/index', () => ({
  commands: {
    inboxConfirm: mockInboxConfirm,
    inboxAttributionSuggest: mockAttributionSuggest,
  },
}));

vi.mock('@/shared/toast', () => ({
  addToast: mockAddToast,
  useToasts: () => ({ toasts: [], dismiss: vi.fn() }),
}));

import { useInboxConfirmFlow } from '../useInboxConfirmFlow';

const item = {
  inboxItemId: 'old-master',
  relativePath: 'a/b.fits',
  fileCount: 1,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-old',
  isMaster: true,
  masterFrameType: 'dark',
  masterFilter: null,
  masterExposureS: 300,
  rootAbsolutePath: '/lib/root',
  organizationState: 'unorganized',
  groupId: 'old-master',
  groupKey: '',
} as InboxListItem;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockInboxConfirm.mockReset();
  mockAttributionSuggest.mockReset();
  mockAddToast.mockReset();
  mockAttributionSuggest.mockResolvedValue({ status: 'ok', data: [] });
});

describe('useInboxConfirmFlow — item not found', () => {
  it('shows the not-found message and reloads the list', async () => {
    mockInboxConfirm.mockResolvedValue({
      status: 'error',
      error: {
        code: 'inbox.item.not_found',
        message:
          'InboxItem old-master was stored under an old path that names a different frame; it has been removed',
      },
    });
    const refreshAll = vi.fn();

    const { result } = renderHook(
      () =>
        useInboxConfirmFlow({
          selectedItem: item,
          selectedRootPath: '/lib/root',
          classification: {
            contentSignature: 'sig-old',
            type: 'single_type',
            breakdown: [{ kind: 'dark', count: 1 }],
          },
          fileMetadataLoading: false,
          fileMetadataError: null,
          hasMissingRequiredMeta: false,
          items: [item],
          refreshAll,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(mockInboxConfirm).toHaveBeenCalledTimes(1);
    expect(mockAddToast).toHaveBeenCalledTimes(1);
    expect(mockAddToast).toHaveBeenCalledWith({
      message: 'That inbox item could not be found.',
      variant: 'warn',
    });
    expect(refreshAll).toHaveBeenCalledTimes(1);
  });
});
