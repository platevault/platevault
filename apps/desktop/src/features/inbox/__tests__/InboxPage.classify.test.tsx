// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * InboxPage classification rendering tests — spec 005 US1/US2.
 *
 * Tests (no Playwright / no Tauri runtime needed):
 *
 * (spec 041: the ActionSidebar was removed; Confirm now lives in the top action
 * bar. The confirm-payload + toast wiring is exercised via a small ConfirmStub.)
 *
 * 1. InboxDetail renders breakdown rows from classify response.
 * 2. InboxDetail renders "Needs review" section for unclassified files.
 * 3. InboxDetail reclassify override picker fires onReclassify with correct payload.
 * 4. inboxConfirm is called with the correct payload (no `action` field —
 *    spec 041 FR-050/T072) and destructiveDestination.
 * 5. The plan-created toast always fires after confirm (masters produce a plan too).
 * 6. InboxList renders item with classification state pill / filters by lane.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render as rtlRender,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// InboxDetail uses the TanStack-Query-backed `useInboxReclassify` hook (spec 042),
// so every render must be wrapped in a QueryClientProvider.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ── Hoist mocks ────────────────────────────────────────────────────────────

const {
  mockInboxClassify,
  mockInboxConfirm,
  mockInboxReclassifyV2,
  mockInboxPropertyRegistry,
  mockInboxScanFolder,
  mockAddToast,
} = vi.hoisted(() => ({
  mockInboxClassify: vi.fn(),
  mockInboxConfirm: vi.fn(),
  mockInboxReclassifyV2: vi.fn(),
  mockInboxPropertyRegistry: vi.fn().mockResolvedValue({
    status: 'ok',
    data: [],
  }),
  mockInboxScanFolder: vi.fn(),
  mockAddToast: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    inboxClassify: mockInboxClassify,
    inboxConfirm: mockInboxConfirm,
    inboxReclassifyV2: mockInboxReclassifyV2,
    inboxPropertyRegistry: mockInboxPropertyRegistry,
    inboxScanFolder: mockInboxScanFolder,
  },
}));

vi.mock('@/shared/toast', () => ({
  addToast: mockAddToast,
  useToasts: () => ({ toasts: [], dismiss: vi.fn() }),
}));

// Mock the store so we can inject classification directly.
const mockClassifyState: {
  data: unknown;
  loading: boolean;
  error: string | null;
} = {
  data: null,
  loading: false,
  error: null,
};
const mockScanState: { data: unknown; loading: boolean; error: string | null } =
  {
    data: null,
    loading: false,
    error: null,
  };

vi.mock('../store', async (importOriginal) => {
  const original = await importOriginal<typeof import('../store')>();
  return {
    ...original,
    useInboxClassification: vi.fn(() => mockClassifyState),
    useInboxScan: vi.fn(() => mockScanState),
  };
});

vi.stubEnv('VITE_USE_MOCKS', 'true');

// ── Fixtures ──────────────────────────────────────────────────────────────

import type { InboxItemSummary, InboxListItem } from '@/bindings/index';
import type { InboxClassifyResponse } from '@/bindings/aliases';

const mixedClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'mixed',
  frameType: undefined,
  contentSignature: 'sig-abc',
  breakdown: [
    {
      kind: 'light',
      count: 16,
      destinationPreview: 'NGC7000/Ha/2025-10-10/light/',
      sampleFiles: ['frame_001.fits'],
    },
    {
      kind: 'dark',
      count: 2,
      destinationPreview: 'unclassified/dark/',
      sampleFiles: ['dark_001.fits'],
    },
  ],
  unclassifiedFiles: ['mystery.fits'],
  sampleFiles: ['frame_001.fits'],
  computedAt: '2025-10-10T22:00:00Z',
};

const singleTypeClassification: InboxClassifyResponse = {
  inboxItemId: 'item-002',
  type: 'single_type',
  frameType: 'light',
  contentSignature: 'sig-def',
  breakdown: [
    {
      kind: 'light',
      count: 18,
      destinationPreview: 'NGC7000/Ha/2025-10-10/light/',
      sampleFiles: ['frame_001.fits'],
    },
  ],
  unclassifiedFiles: [],
  sampleFiles: ['frame_001.fits'],
  computedAt: '2025-10-10T22:00:00Z',
};

const sampleItem: InboxItemSummary = {
  inboxItemId: 'item-001',
  relativePath: '2025-10-10/NGC7000',
  fileCount: 18,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-abc',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
};

// ── Tests: ActionSidebar ──────────────────────────────────────────────────

import { InboxDetail } from '../InboxDetail';
import { InboxList } from '../InboxList';
import { useInboxConfirm } from '../store';

// Raw source of InboxPage.tsx (compile-time glob, mirrors anchors.test.ts's
// technique) so the toast-wiring test below reads the REAL `runConfirm`
// implementation rather than a hand-copied mirror.
const INBOX_PAGE_SOURCE = Object.values(
  import.meta.glob('../InboxPage.tsx', { as: 'raw', eager: true }),
)[0] as string;

function queryClientWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// ── Tests: InboxDetail ────────────────────────────────────────────────────

describe('InboxDetail', () => {
  it('renders "Needs review" section for unclassified files', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
      />,
    );
    // Section title contains "Needs review (1)"
    expect(screen.getAllByText(/needs review/i).length).toBeGreaterThanOrEqual(
      1,
    );
    // Override picker has the file-specific data-testid
    expect(
      screen.getByTestId('override-select-mystery.fits'),
    ).toBeInTheDocument();
  });

  it('fires reclassify_v2 with correct payload when override applied', async () => {
    mockInboxReclassifyV2.mockResolvedValue({
      status: 'ok',
      data: {
        sourceGroupId: 'item-001',
        subItems: [],
        needsReviewCount: 0,
      },
    });

    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
      />,
    );

    // Select a frame type for the unclassified file
    fireEvent.change(screen.getByTestId('override-select-mystery.fits'), {
      target: { value: 'dark' },
    });

    // Click the apply button
    const applyBtn = screen.getByRole('button', { name: /apply.*override/i });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(mockInboxReclassifyV2).toHaveBeenCalledWith({
        inboxItemId: 'item-001',
        overrides: [
          { filePath: 'mystery.fits', properties: { frameType: 'dark' } },
        ],
        bulk: [],
        // Required so reclassify hashes the real files instead of writing
        // folder_signature([]) — the empty-set constant that made the confirm
        // staleness guard compare equal unconditionally.
        rootAbsolutePath: '/astro/inbox',
      });
    });
  });

  it('renders detection facts in PropertyTable for single-type classify response', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
      />,
    );
    // Detection col should show the frame type from the classification
    const lights = screen.getAllByText('light');
    expect(lights.length).toBeGreaterThanOrEqual(1);
    // No breakdown table destination preview in the DOM
    expect(screen.queryByText('NGC7000/Ha/2025-10-10/light/')).toBeNull();
  });
});

// ── Tests: InboxList ──────────────────────────────────────────────────────

describe('InboxList', () => {
  const fitsItem: InboxListItem = {
    inboxItemId: 'item-fits',
    groupId: 'item-fits',
    groupKey: '',
    needsReview: false,
    rootId: 'root-001',
    rootAbsolutePath: '/astro/inbox',
    relativePath: 'lights/NGC7000',
    fileCount: 18,
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
  const videoItem: InboxListItem = {
    inboxItemId: 'item-video',
    groupId: 'item-video',
    groupKey: '',
    needsReview: false,
    rootId: 'root-001',
    rootAbsolutePath: '/astro/inbox',
    relativePath: 'planetary/Jupiter',
    fileCount: 1,
    lane: 'video',
    format: 'video',
    state: 'pending_classification',
    contentSignature: 'sig-b',
    isMaster: false,
    masterFrameType: null,
    masterFilter: null,
    masterExposureS: null,
    organizationState: 'unorganized',
  };

  it('renders items with state pill', () => {
    render(
      <InboxList
        items={[fitsItem]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
        onFilterTypeChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('inbox-item-item-fits')).toBeInTheDocument();
    expect(screen.getByText('classified')).toBeInTheDocument();
  });

  it('filters to only video lane items', () => {
    render(
      <InboxList
        items={[fitsItem, videoItem]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="video"
        onFilterTypeChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId('inbox-item-item-fits'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('inbox-item-item-video')).toBeInTheDocument();
  });

  it('calls onSelect with the item id (issue #644)', () => {
    const onSelect = vi.fn();
    render(
      <InboxList
        items={[fitsItem, videoItem]}
        selectedId={null}
        onSelect={onSelect}
        filterType="all"
        onFilterTypeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-item-item-video'));
    expect(onSelect).toHaveBeenCalledWith('item-video');
  });

  it('renders folder + master rows without a duplicate search box or footer count (#83)', () => {
    const masterItem: InboxListItem = {
      inboxItemId: 'item-master',
      groupId: 'item-master',
      groupKey: '',
      needsReview: false,
      rootId: 'root-001',
      rootAbsolutePath: '/astro/inbox',
      relativePath: 'masters/dark_master.fits',
      fileCount: 1,
      lane: 'fits',
      format: 'fits',
      state: 'pending_classification',
      contentSignature: 'sig-m',
      isMaster: true,
      masterFrameType: 'dark',
      masterFilter: null,
      masterExposureS: null,
      organizationState: 'unorganized',
    };

    render(
      <InboxList
        items={[fitsItem, masterItem]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
        onFilterTypeChange={vi.fn()}
      />,
    );

    // Both detections render as rows.
    expect(screen.getByTestId('inbox-item-item-fits')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-item-item-master')).toBeInTheDocument();

    // #83: the list no longer carries ListSidebar's own search box or footer
    // count — the single search lives in the top bar and the folder/master
    // counts live in the top-bar summary + status bar (computed by
    // deriveInboxStats, covered by inboxStatsFromItems.test.ts), not here.
    expect(document.querySelector('.pv-list-sidebar__count')).toBeNull();
    expect(document.querySelector('.pv-list-sidebar__search')).toBeNull();
    expect(screen.queryByPlaceholderText(/search inbox/i)).toBeNull();
  });
});

// ── Tests: confirm call payload ───────────────────────────────────────────

describe('Confirm payload and toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // spec 041 T071/T072 (FR-050): the backend "split" action for mixed
  // classifications is removed entirely — a mixed row is never confirmed at
  // all (InboxPage disables Confirm for it via `canConfirm`), so there is no
  // "split" payload to assert anymore. `mixedClassification` above documents
  // what that unreachable-for-confirm shape looks like.

  it('calls inboxConfirm without an action field for single_type', async () => {
    // Drives the REAL `useInboxConfirm` hook (store.ts) — the exact code
    // InboxPage.handleConfirm calls — instead of a disconnected stub that
    // called mockInboxConfirm directly. Catches a regression in the hook's
    // own payload assembly (e.g. a reintroduced `action` field).
    mockInboxConfirm.mockResolvedValue({
      status: 'ok',
      data: {
        planId: 'plan-def',
        planState: 'ready_for_review',
        itemsTotal: 18,
        registeredAsMaster: false,
        destinations: [],
      },
    });

    const { result } = renderHook(() => useInboxConfirm(), {
      wrapper: queryClientWrapper,
    });

    await act(async () => {
      await result.current.confirm({
        inboxItemId: 'item-002',
        contentSignature: singleTypeClassification.contentSignature,
        rootAbsolutePath: '/astro/inbox',
        destructiveDestination: 'archive',
      });
    });

    expect(mockInboxConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxItemId: 'item-002',
        contentSignature: 'sig-def',
        rootAbsolutePath: '/astro/inbox',
        destructiveDestination: 'archive',
      }),
    );
    expect(mockInboxConfirm.mock.calls[0]?.[0]).not.toHaveProperty('action');
  });

  // spec 041: the registeredAsMaster fast-path is gone — every confirm
  // yields a reviewable plan surfaced via an unconditional toast. Mounting
  // the full InboxPage to click its real Confirm button would exercise this
  // for real, but this suite intentionally avoids that (see
  // InboxPage.reclassifySelection.test.tsx's header comment: "no full-router
  // InboxPage render... per its own comment" — a full page tree here OOMs
  // the test worker). Instead this statically verifies the actual
  // `runConfirm` success block in InboxPage.tsx: the plan-created toast
  // fires unconditionally (no `if` between the confirm() call and the
  // addToast() call, and no remaining `registeredAsMaster` gate).
  it('runConfirm always toasts plan-created on success (masters now produce a plan too, no registeredAsMaster gate)', () => {
    const start = INBOX_PAGE_SOURCE.indexOf('const runConfirm = useCallback(');
    expect(start).toBeGreaterThan(-1);
    const tryStart = INBOX_PAGE_SOURCE.indexOf('try {', start);
    const catchStart = INBOX_PAGE_SOURCE.indexOf('} catch (e) {', tryStart);
    const successBlock = INBOX_PAGE_SOURCE.slice(tryStart, catchStart);

    const toastIdx = successBlock.indexOf('addToast(');
    expect(toastIdx).toBeGreaterThan(-1);
    expect(successBlock.slice(0, toastIdx)).not.toMatch(/\bif\s*\(/);
    expect(successBlock).toContain('inbox_toast_plan_created');
    // spec 041: the old registeredAsMaster fast-path (skip the toast for
    // masters) was removed entirely — it must not reappear as a new gate.
    expect(successBlock).not.toContain('registeredAsMaster');
  });
});
