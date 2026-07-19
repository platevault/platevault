// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Issue #715 (spec 004 FR-005/SC-002): Inbox items had no Reveal-in-OS action
 * anywhere on the surface. InboxDetail now wires the shared `revealInOs`
 * helper (same one ProjectDetail/ArchivePage/SessionDetail use) behind the
 * platform-native `revealLabel()` button.
 *
 * `@/shared/native/reveal` is mocked directly (not the underlying
 * `commands.nativeReveal` IPC binding) — that helper already owns the
 * mock-stub-vs-real-Tauri branch (`isTauri()`) and is exercised by its own
 * unit coverage; these tests assert InboxDetail's own responsibility: which
 * path/context it passes in, and how it reacts to success/failure.
 *
 * Tests:
 * 1. The Reveal button renders with the shared platform-native label.
 * 2. Clicking it calls `revealInOs` with the root+relativePath joined into a
 *    single absolute path and `entityKind: 'inbox_item'`.
 * 3. A reveal failure surfaces an error toast carrying a "Copy path" action
 *    (#717 FR-010: `copyToClipboard` was exported with zero call sites).
 * 4. Invoking that action copies the resolved path and confirms via toast.
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

const mockRevealInOs = vi.fn();
const mockCopyToClipboard = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/shared/native/reveal', () => ({
  revealInOs: (...args: unknown[]) => mockRevealInOs(...args),
  copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
}));

vi.mock('@/shared/toast', () => ({
  addToast: (...args: unknown[]) => mockAddToast(...args),
}));

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

// frameType deliberately non-"light": a light classification mounts
// `ConeSearchSuggestions`, which makes its own unrelated IPC call — avoiding
// it here keeps this file scoped to the Reveal action alone.
const sampleClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'single_type',
  frameType: 'dark',
  contentSignature: 'sig-002',
  breakdown: [
    { kind: 'dark', count: 4, destinationPreview: null, sampleFiles: [] },
  ],
  unclassifiedFiles: [],
  sampleFiles: [],
  computedAt: '2025-11-01T20:00:00Z',
};

type ItemProp = Parameters<typeof InboxDetail>[0]['item'];
type ClassProp = Parameters<typeof InboxDetail>[0]['classification'];

describe('InboxDetail — #715 Reveal-in-OS action', () => {
  beforeEach(() => {
    mockRevealInOs.mockReset();
    mockCopyToClipboard.mockReset();
    mockAddToast.mockReset();
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

  it('clicking Reveal calls revealInOs with the joined absolute path and inbox_item context', async () => {
    mockRevealInOs.mockResolvedValue({ revealed: true, selection: 'target' });
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/mnt/library/inbox"
        classification={sampleClassification as unknown as ClassProp}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-reveal-btn'));

    await waitFor(() => expect(mockRevealInOs).toHaveBeenCalledTimes(1));
    const [path, ctx] = mockRevealInOs.mock.calls[0] as [
      string,
      { entityKind: string; entityId: string },
    ];
    expect(path).toBe('/mnt/library/inbox/2025-11-01/NGC891');
    expect(ctx.entityKind).toBe('inbox_item');
    expect(ctx.entityId).toBe('item-001');
  });

  it('surfaces a reveal failure as an error toast with a Copy-path action', async () => {
    mockRevealInOs.mockRejectedValue(new Error('boom'));
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/mnt/library/inbox"
        classification={sampleClassification as unknown as ClassProp}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-reveal-btn'));

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledTimes(1));
    const [toastArg] = mockAddToast.mock.calls[0] as [
      { message: string; variant: string; action?: { label: string } },
    ];
    expect(toastArg.message).toBe('Could not open the location.');
    expect(toastArg.variant).toBe('error');
    expect(toastArg.action?.label).toBe('Copy path');
  });

  it('the Copy-path action copies the resolved absolute path', async () => {
    mockRevealInOs.mockRejectedValue(new Error('boom'));
    mockCopyToClipboard.mockResolvedValue(true);

    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/mnt/library/inbox"
        classification={sampleClassification as unknown as ClassProp}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-reveal-btn'));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledTimes(1));

    const [toastArg] = mockAddToast.mock.calls[0] as [
      { action?: { onClick: () => void } },
    ];
    toastArg.action?.onClick();

    await waitFor(() =>
      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        '/mnt/library/inbox/2025-11-01/NGC891',
      ),
    );
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledTimes(2));
    expect(mockAddToast.mock.calls[1][0]).toMatchObject({
      message: 'Path copied to clipboard.',
      variant: 'info',
    });
  });
});
