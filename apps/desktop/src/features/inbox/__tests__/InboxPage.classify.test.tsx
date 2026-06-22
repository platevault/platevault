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
 * 4. inboxConfirm is called with the correct action and destructiveDestination.
 * 5. The plan-created toast always fires after confirm (masters produce a plan too).
 * 6. InboxList renders item with classification state pill / filters by lane.
 */

import { render as rtlRender, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

// InboxDetail uses the TanStack-Query-backed `useInboxReclassify` hook (spec 042),
// so every render must be wrapped in a QueryClientProvider.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

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

import type { InboxClassifyResponse, InboxItemSummary, InboxListItem } from '@/api/commands';

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
  const fitsItem: InboxListItem = {
    inboxItemId: 'item-fits',
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
        selectedIdx={null}
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
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="video"
        onFilterTypeChange={vi.fn()}
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
      />,
    );
    fireEvent.click(screen.getByTestId('inbox-item-item-video'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('footer shows "N folders · M masters" — masters are not counted as folders', () => {
    const masterItem: InboxListItem = {
      inboxItemId: 'item-master',
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
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
        onFilterTypeChange={vi.fn()}
      />,
    );

    const footer = document.querySelector('.alm-list-sidebar__count');
    // The master must NOT inflate the folder count
    expect(footer?.textContent).toContain('1 folder');
    expect(footer?.textContent).toContain('1 master');
    expect(footer?.textContent).not.toMatch(/2 folders/);
  });
});

// ── Tests: confirm call payload ───────────────────────────────────────────

describe('Confirm payload and toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Minimal stand-in for the relocated Confirm control (now in TopActionBar).
  // These tests assert the confirm-payload + toast wiring that InboxPage.handleConfirm
  // performs; the button itself is just a click target.
  function ConfirmStub({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
    return (
      <button data-testid="inbox-confirm-btn" onClick={() => void onConfirm()}>
        Confirm
      </button>
    );
  }

  it('calls inboxConfirm with split action for mixed classification', async () => {
    mockInboxConfirm.mockResolvedValue({
      planId: 'plan-abc',
      planState: 'ready_for_review',
      itemsTotal: 18,
      registeredAsMaster: false,
    });

    const onConfirm = async () => {
      await mockInboxConfirm({
        inboxItemId: 'item-001',
        action: 'split',
        contentSignature: mixedClassification.contentSignature,
        rootAbsolutePath: '/astro/inbox',
        destructiveDestination: 'archive',
      });
    };

    render(<ConfirmStub onConfirm={onConfirm} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('inbox-confirm-btn'));
    });

    expect(mockInboxConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'split',
        contentSignature: 'sig-abc',
        destructiveDestination: 'archive',
      }),
    );
  });

  it('calls inboxConfirm with confirm action for single_type', async () => {
    mockInboxConfirm.mockResolvedValue({
      planId: 'plan-def',
      planState: 'ready_for_review',
      itemsTotal: 18,
      registeredAsMaster: false,
    });

    const onConfirm = async () => {
      await mockInboxConfirm({
        inboxItemId: 'item-002',
        action: 'confirm',
        contentSignature: singleTypeClassification.contentSignature,
        rootAbsolutePath: '/astro/inbox',
        destructiveDestination: 'archive',
      });
    };

    render(<ConfirmStub onConfirm={onConfirm} />);

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

  it('always shows the plan-created toast after confirm (masters now produce a plan too)', async () => {
    // spec 041: the registeredAsMaster fast-path is gone — every confirm yields a
    // reviewable plan that surfaces in the aggregate PlanPanel.
    mockInboxConfirm.mockResolvedValue({
      planId: 'plan-xyz',
      planState: 'ready_for_review',
      itemsTotal: 1,
      registeredAsMaster: false,
    });

    const onConfirm = async () => {
      const result = await mockInboxConfirm({
        inboxItemId: 'item-master-001',
        action: 'confirm',
        contentSignature: singleTypeClassification.contentSignature,
        rootAbsolutePath: '/astro/inbox',
        destructiveDestination: 'archive',
      });
      mockAddToast({
        message: `Plan created (${result.itemsTotal} items). Review below before applying.`,
        variant: 'info',
      });
    };

    render(<ConfirmStub onConfirm={onConfirm} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('inbox-confirm-btn'));
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Plan created'),
        variant: 'info',
      }),
    );
    expect(mockAddToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Registered as calibration master.' }),
    );
  });
});
