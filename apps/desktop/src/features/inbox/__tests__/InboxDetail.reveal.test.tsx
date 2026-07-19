// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Issue #715 (spec 004 FR-005/SC-002): Inbox items had no Reveal-in-OS action
 * anywhere on the surface. InboxDetail now wires the shared `revealInOs`
 * helper (same one ProjectDetail/ArchivePage/SessionDetail use) behind the
 * platform-native `revealLabel()` button.
 *
 * Tests:
 * 1. The Reveal button renders with the shared platform-native label.
 * 2. Clicking it calls `commands.nativeReveal` with the root+relativePath
 *    joined into a single absolute path and `entityKind: 'inbox_item'`.
 * 3. A reveal failure surfaces the inbox-scoped error banner (not a crash).
 */
import type React from 'react';
import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

import type {
  InboxItemSummary_Serialize as InboxItemSummary,
  InboxClassifyResponse_Serialize as InboxClassifyResponse,
} from '@/bindings';

import { InboxDetail } from '../InboxDetail';

const mockNativeReveal = vi.fn();

vi.mock('@/bindings/index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...mod,
    commands: {
      ...mod.commands,
      nativeReveal: async (...args: unknown[]) => await mockNativeReveal(...args),
    },
  };
});

const sampleItem: InboxItemSummary = {
  inboxItemId: 'item-001',
  relativePath: '2025-11-01/NGC891',
  fileCount: 4,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-002',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
};

const sampleClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'single_type',
  frameType: 'light',
  contentSignature: 'sig-002',
  breakdown: [
    { kind: 'light', count: 4, destinationPreview: null, sampleFiles: [] },
  ],
  unclassifiedFiles: [],
  sampleFiles: [],
  computedAt: '2025-11-01T20:00:00Z',
};

type ItemProp = Parameters<typeof InboxDetail>[0]['item'];
type ClassProp = Parameters<typeof InboxDetail>[0]['classification'];

describe('InboxDetail — #715 Reveal-in-OS action', () => {
  beforeEach(() => {
    mockNativeReveal.mockReset();
  });

  it('renders the Reveal button with the shared platform-native label', () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/mnt/library/inbox"
        classification={sampleClassification as unknown as ClassProp}
      />,
    );
    // jsdom reports no platform → the Linux-generic label (matches the
    // ProjectDetail/SessionDetail convention for the same helper).
    expect(screen.getByTestId('inbox-reveal-btn')).toHaveTextContent(
      'Show in file manager',
    );
  });

  it('clicking Reveal calls native.reveal with the joined absolute path and inbox_item context', async () => {
    mockNativeReveal.mockResolvedValue({
      status: 'ok',
      data: { revealed: true, selection: 'target' },
    });
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/mnt/library/inbox"
        classification={sampleClassification as unknown as ClassProp}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-reveal-btn'));

    await waitFor(() => expect(mockNativeReveal).toHaveBeenCalledTimes(1));
    const [request] = mockNativeReveal.mock.calls[0] as [
      { path: string; entityKind: string; entityId: string },
    ];
    expect(request.path).toBe('/mnt/library/inbox/2025-11-01/NGC891');
    expect(request.entityKind).toBe('inbox_item');
    expect(request.entityId).toBe('item-001');
  });

  it('surfaces a reveal failure as an inline error banner', async () => {
    mockNativeReveal.mockResolvedValue({
      status: 'error',
      error: { code: 'os.command_failed', message: 'boom' },
    });
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/mnt/library/inbox"
        classification={sampleClassification as unknown as ClassProp}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-reveal-btn'));

    expect(await screen.findByTestId('inbox-reveal-error')).toHaveTextContent(
      'Could not open the location.',
    );
  });
});
