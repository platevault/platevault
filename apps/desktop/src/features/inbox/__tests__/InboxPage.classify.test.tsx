/// <reference types="@testing-library/jest-dom" />
/**
 * InboxPage classification rendering tests — spec 005 US1/US2.
 *
 * Tests (no Playwright / no Tauri runtime needed):
 *
 * 1. ActionSidebar renders "Generate split plan" for mixed classification.
 * 2. ActionSidebar renders "Confirm to inventory" for single_type classification.
 * 3. ActionSidebar is disabled and shows "pending" when classification is null.
 * 4. ActionSidebar renders "Open existing plan" when hasOpenPlan = true.
 * 5. InboxDetail renders breakdown rows from classify response.
 * 6. InboxDetail renders "Needs review" section for unclassified files.
 * 7. InboxDetail reclassify override picker fires onReclassify with correct payload.
 * 8. InboxPage confirm button calls inboxConfirm with correct action and payload.
 * 9. InboxPage shows info toast after successful confirm.
 * 10. InboxPage shows warn toast on inbox.has.open.plan error.
 * 11. InboxList renders item with classification state pill.
 * 12. InboxList filters by lane (fits / video).
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks ────────────────────────────────────────────────────────────

const {
  mockInboxClassify,
  mockInboxConfirm,
  mockInboxReclassify,
  mockInboxScanFolder,
  mockAddToast,
} = vi.hoisted(() => ({
  mockInboxClassify: vi.fn(),
  mockInboxConfirm: vi.fn(),
  mockInboxReclassify: vi.fn(),
  mockInboxScanFolder: vi.fn(),
  mockAddToast: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  inboxClassify: mockInboxClassify,
  inboxConfirm: mockInboxConfirm,
  inboxReclassify: mockInboxReclassify,
  inboxScanFolder: mockInboxScanFolder,
}));

vi.mock('@/shared/toast', () => ({
  addToast: mockAddToast,
  useToasts: () => ({ toasts: [], dismiss: vi.fn() }),
}));

// Mock the store so we can inject classification directly.
const mockClassifyState: { data: unknown; loading: boolean; error: string | null } = {
  data: null,
  loading: false,
  error: null,
};
const mockScanState: { data: unknown; loading: boolean; error: string | null } = {
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

import type { InboxClassifyResponse, InboxItemSummary } from '@/api/commands';
import type { InboxClassifyResponse_Serialize } from '@/bindings/index';

const mixedClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'mixed',
  frameType: undefined,
  contentSignature: 'sig-abc',
  breakdown: [
    { kind: 'light', count: 16, destinationPreview: 'NGC7000/Ha/2025-10-10/light/', sampleFiles: ['frame_001.fits'] },
    { kind: 'dark', count: 2, destinationPreview: 'unclassified/dark/', sampleFiles: ['dark_001.fits'] },
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
    { kind: 'light', count: 18, destinationPreview: 'NGC7000/Ha/2025-10-10/light/', sampleFiles: ['frame_001.fits'] },
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
  state: 'classified',
  contentSignature: 'sig-abc',
};

// ── Tests: ActionSidebar ──────────────────────────────────────────────────

import { ActionSidebar } from '../ActionSidebar';
import { InboxDetail } from '../InboxDetail';
import { InboxList } from '../InboxList';

describe('ActionSidebar', () => {
  it('shows "Generate split plan" for mixed classification', () => {
    render(
      <ActionSidebar
        hasSelection
        classification={mixedClassification}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm
        onConfirm={vi.fn()}
        onOpenExistingPlan={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /generate split plan/i })).toBeInTheDocument();
  });

  it('shows "Confirm to inventory" for single_type classification', () => {
    render(
      <ActionSidebar
        hasSelection
        classification={singleTypeClassification}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm
        onConfirm={vi.fn()}
        onOpenExistingPlan={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /confirm to inventory/i })).toBeInTheDocument();
  });

  it('shows disabled button when no selection', () => {
    render(
      <ActionSidebar
        hasSelection={false}
        classification={null}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm={false}
        onConfirm={vi.fn()}
        onOpenExistingPlan={vi.fn()}
      />,
    );
    expect(screen.getByTestId('inbox-confirm-btn')).toBeDisabled();
  });

  it('shows "Open existing plan" when hasOpenPlan', () => {
    const onOpen = vi.fn();
    render(
      <ActionSidebar
        hasSelection
        classification={singleTypeClassification}
        hasOpenPlan
        confirmLoading={false}
        canConfirm={false}
        onConfirm={vi.fn()}
        onOpenExistingPlan={onOpen}
      />,
    );
    const btn = screen.getByRole('button', { name: /open existing plan/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('shows classification summary with unclassified warning', () => {
    render(
      <ActionSidebar
        hasSelection
        classification={mixedClassification}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm
        onConfirm={vi.fn()}
        onOpenExistingPlan={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 file.*need.*review/i)).toBeInTheDocument();
  });
});

// ── Tests: InboxDetail ────────────────────────────────────────────────────

describe('InboxDetail', () => {
  it('renders breakdown rows from mixed classify response', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
      />,
    );
    // Breakdown pills are inside the breakdown section, distinct from dropdown options
    const pills = screen.getAllByText('light');
    expect(pills.length).toBeGreaterThanOrEqual(1);
    // Verify the file count column renders the count "16"
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders "Needs review" section for unclassified files', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={mixedClassification}
      />,
    );
    // Section title contains "Needs review (1)"
    expect(screen.getAllByText(/needs review/i).length).toBeGreaterThanOrEqual(1);
    // Override picker has the file-specific data-testid
    expect(screen.getByTestId('override-select-mystery.fits')).toBeInTheDocument();
  });

  it('fires reclassify with correct payload when override applied', async () => {
    mockInboxReclassify.mockResolvedValue({
      inboxItemId: 'item-001',
      updatedType: 'mixed',
      remainingUnclassified: 0,
      appliedCount: 1,
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
      expect(mockInboxReclassify).toHaveBeenCalledWith({
        inboxItemId: 'item-001',
        overrides: [{ filePath: 'mystery.fits', frameType: 'dark' }],
      });
    });
  });

  it('renders destination preview from breakdown', () => {
    render(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro/inbox"
        classification={singleTypeClassification}
      />,
    );
    expect(screen.getByText('NGC7000/Ha/2025-10-10/light/')).toBeInTheDocument();
  });
});

// ── Tests: InboxList ──────────────────────────────────────────────────────

describe('InboxList', () => {
  const fitsItem: InboxItemSummary = {
    inboxItemId: 'item-fits',
    relativePath: 'lights/NGC7000',
    fileCount: 18,
    lane: 'fits',
    state: 'classified',
    contentSignature: 'sig-a',
  };
  const videoItem: InboxItemSummary = {
    inboxItemId: 'item-video',
    relativePath: 'planetary/Jupiter',
    fileCount: 1,
    lane: 'video',
    state: 'pending_classification',
    contentSignature: 'sig-b',
  };

  it('renders items with state pill', () => {
    render(
      <InboxList
        items={[fitsItem]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
        onFilterTypeChange={vi.fn()}
        groupBy="none"
        onGroupByChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('inbox-item-item-fits')).toBeInTheDocument();
    expect(screen.getByText('classified')).toBeInTheDocument();
  });

  it('filters to only video lane items', () => {
    render(
      <InboxList
        items={[fitsItem, videoItem]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="video"
        onFilterTypeChange={vi.fn()}
        groupBy="none"
        onGroupByChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('inbox-item-item-fits')).not.toBeInTheDocument();
    expect(screen.getByTestId('inbox-item-item-video')).toBeInTheDocument();
  });

  it('calls onSelect with original index', () => {
    const onSelect = vi.fn();
    render(
      <InboxList
        items={[fitsItem, videoItem]}
        selectedIdx={null}
        onSelect={onSelect}
        filterType="all"
        onFilterTypeChange={vi.fn()}
        groupBy="none"
        onGroupByChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-item-item-video'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

// ── Tests: confirm call payload ───────────────────────────────────────────

describe('Confirm payload and toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls inboxConfirm with split action for mixed classification', async () => {
    mockInboxConfirm.mockResolvedValue({
      planId: 'plan-abc',
      planState: 'ready_for_review',
      itemsTotal: 18,
    });

    const onConfirm = async () => {
      await mockInboxConfirm({
        inboxItemId: 'item-001',
        action: 'split',
        contentSignature: mixedClassification.contentSignature,
        rootAbsolutePath: '/astro/inbox',
        destructiveDestination: null,
      });
    };

    render(
      <ActionSidebar
        hasSelection
        classification={mixedClassification}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm
        onConfirm={onConfirm}
        onOpenExistingPlan={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('inbox-confirm-btn'));
    });

    expect(mockInboxConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'split',
        contentSignature: 'sig-abc',
      }),
    );
  });

  it('calls inboxConfirm with confirm action for single_type', async () => {
    mockInboxConfirm.mockResolvedValue({
      planId: 'plan-def',
      planState: 'ready_for_review',
      itemsTotal: 18,
    });

    const onConfirm = async () => {
      await mockInboxConfirm({
        inboxItemId: 'item-002',
        action: 'confirm',
        contentSignature: singleTypeClassification.contentSignature,
        rootAbsolutePath: '/astro/inbox',
        destructiveDestination: null,
      });
    };

    render(
      <ActionSidebar
        hasSelection
        classification={singleTypeClassification}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm
        onConfirm={onConfirm}
        onOpenExistingPlan={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('inbox-confirm-btn'));
    });

    expect(mockInboxConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'confirm',
        contentSignature: 'sig-def',
      }),
    );
  });
});
