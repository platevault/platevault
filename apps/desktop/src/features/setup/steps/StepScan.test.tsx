/// <reference types="@testing-library/jest-dom" />
/**
 * StepScan tests — first-run wizard "Scan" step (spec 038).
 *
 * Covers: scanning/done/empty/error states and the Finish flow.
 * Mocks inboxScanFolder + inboxClassify at the @/api/commands layer
 * (same pattern as SetupWizard.test.tsx).
 */

import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockInboxScanFolder, mockInboxClassify } = vi.hoisted(() => ({
  mockInboxScanFolder: vi.fn(),
  mockInboxClassify: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  inboxScanFolder: mockInboxScanFolder,
  inboxClassify: mockInboxClassify,
}));

// ── Component under test ─────────────────────────────────────────────────────

import { StepScan } from './StepScan';
import type { StepScanProps } from './StepScan';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SOURCES = [
  { path: '/astro/lights', kind: 'light_frames' as const, scanDepth: 'recursive' as const },
  { path: '/astro/projects', kind: 'project' as const, scanDepth: 'recursive' as const },
];

const FLUSH_RESULT = {
  results: [
    { kind: 'light_frames' as const, path: '/astro/lights', success: true },
    { kind: 'project' as const, path: '/astro/projects', success: true },
  ],
  allSucceeded: true,
};

const SCAN_RESPONSE_WITH_ITEMS = {
  rootId: 'root-001',
  items: [
    {
      inboxItemId: 'item-001',
      relativePath: '2025-10-10/NGC7000',
      fileCount: 18,
      lane: 'fits',
      state: 'classified',
      contentSignature: 'sig-abc',
    },
  ],
};

const CLASSIFY_RESPONSE = {
  inboxItemId: 'item-001',
  type: 'mixed',
  frameType: null,
  contentSignature: 'sig-abc',
  breakdown: [
    { kind: 'light', count: 16, destinationPreview: 'NGC7000/light/', sampleFiles: [] },
    { kind: 'dark', count: 2, destinationPreview: 'NGC7000/dark/', sampleFiles: [] },
  ],
  unclassifiedFiles: [],
  sampleFiles: [],
  computedAt: '2025-10-10T22:00:00Z',
};

const SCAN_RESPONSE_EMPTY = {
  rootId: 'root-002',
  items: [],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderStep(overrides: Partial<StepScanProps> = {}) {
  const onFinish = overrides.onFinish ?? vi.fn().mockResolvedValue(undefined);
  return render(
    <StepScan
      sources={SOURCES}
      flushResult={FLUSH_RESULT}
      onFinish={onFinish}
      isFinishing={false}
      onBack={vi.fn()}
      {...overrides}
    />,
  );
}

/** Click the source header button to expand its accordion panel. */
function expandSource(path: string) {
  const sourceEl = screen.getByTestId(`scan-source-${path}`);
  const header = sourceEl.querySelector('[role="button"]') as HTMLElement;
  fireEvent.click(header);
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockInboxScanFolder.mockReset();
  mockInboxClassify.mockReset();
});

describe('StepScan', () => {
  describe('scanning state', () => {
    it('shows source paths in pending state on initial render', () => {
      // Return a promise that never resolves so we can observe pending state
      mockInboxScanFolder.mockReturnValue(new Promise(() => {}));
      mockInboxClassify.mockReturnValue(new Promise(() => {}));

      renderStep();

      expect(screen.getByTestId('step-scan')).toBeInTheDocument();
      // Both source paths should be visible
      expect(screen.getByTestId('scan-source-/astro/lights')).toBeInTheDocument();
      expect(screen.getByTestId('scan-source-/astro/projects')).toBeInTheDocument();
    });

    it('calls inboxScanFolder for each source on mount', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep();

      await waitFor(() => {
        expect(mockInboxScanFolder).toHaveBeenCalledTimes(2);
      });

      expect(mockInboxScanFolder).toHaveBeenCalledWith(
        expect.objectContaining({ rootAbsolutePath: '/astro/lights' }),
      );
      expect(mockInboxScanFolder).toHaveBeenCalledWith(
        expect.objectContaining({ rootAbsolutePath: '/astro/projects' }),
      );
    });

    it('calls inboxClassify for each discovered item', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep();

      await waitFor(() => {
        expect(mockInboxClassify).toHaveBeenCalledWith(
          expect.objectContaining({ inboxItemId: 'item-001' }),
        );
      });
    });
  });

  describe('accordion — collapsed by default', () => {
    it('table rows are hidden by default before the accordion is expanded', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep({ sources: [SOURCES[0]] });

      // Wait for scan to finish — compact count summary appears in the header
      await waitFor(() => {
        expect(within(screen.getByTestId('scan-source-/astro/lights')).getByText(/1 folder/)).toBeInTheDocument();
      });

      // Table row must NOT be visible — accordion is still collapsed
      expect(screen.queryByTestId('scan-item-item-001')).not.toBeInTheDocument();
    });

    it('reveals table rows after clicking the source header', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(within(screen.getByTestId('scan-source-/astro/lights')).getByText(/1 folder/)).toBeInTheDocument();
      });

      expandSource('/astro/lights');

      expect(screen.getByTestId('scan-item-item-001')).toBeInTheDocument();
    });

    it('shows ▸ when collapsed and ▾ when expanded', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(within(screen.getByTestId('scan-source-/astro/lights')).getByText(/1 folder/)).toBeInTheDocument();
      });

      const sourceEl = screen.getByTestId('scan-source-/astro/lights');
      expect(sourceEl).toHaveTextContent('▸');
      expect(sourceEl).not.toHaveTextContent('▾');

      expandSource('/astro/lights');

      expect(sourceEl).toHaveTextContent('▾');
      expect(sourceEl).not.toHaveTextContent('▸');
    });

    it('collapses again on second click', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(within(screen.getByTestId('scan-source-/astro/lights')).getByText(/1 folder/)).toBeInTheDocument();
      });

      expandSource('/astro/lights');
      expect(screen.getByTestId('scan-item-item-001')).toBeInTheDocument();

      expandSource('/astro/lights');
      expect(screen.queryByTestId('scan-item-item-001')).not.toBeInTheDocument();
    });

    it('does not show a chevron while source is still scanning', () => {
      mockInboxScanFolder.mockReturnValue(new Promise(() => {}));

      renderStep({ sources: [SOURCES[0]] });

      const sourceEl = screen.getByTestId('scan-source-/astro/lights');
      expect(sourceEl.querySelector('[role="button"]')).not.toBeInTheDocument();
      expect(sourceEl).not.toHaveTextContent('▸');
    });
  });

  describe('done state with detections', () => {
    it('shows detected items and frame-type breakdown when scan completes (after expanding)', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep({ sources: [SOURCES[0]] });

      // Wait for scan to complete
      await waitFor(() => {
        expect(within(screen.getByTestId('scan-source-/astro/lights')).getByText(/1 folder/)).toBeInTheDocument();
      });

      // Must expand the accordion to see the detail panel
      expandSource('/astro/lights');

      expect(screen.getByTestId('scan-item-item-001')).toBeInTheDocument();
      // Item path visible
      expect(screen.getByText('2025-10-10/NGC7000')).toBeInTheDocument();
      // Breakdown kinds visible (light=16, dark=2)
      expect(screen.getByText('16 light')).toBeInTheDocument();
      expect(screen.getByText('2 dark')).toBeInTheDocument();
    });

    it('shows the scan summary when all sources are done', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep();

      await waitFor(() => {
        expect(screen.getByTestId('scan-summary')).toBeInTheDocument();
      });
    });

    it('enables the Finish button once all sources are done', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep();

      await waitFor(() => {
        const finishBtn = screen.getByTestId('finish-button');
        expect(finishBtn).not.toBeDisabled();
      });
    });

    it('calls onFinish when Finish is clicked', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      const onFinish = vi.fn().mockResolvedValue(undefined);
      renderStep({ sources: [SOURCES[0]], onFinish });

      await waitFor(() => {
        expect(screen.getByTestId('finish-button')).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('finish-button'));
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    });
  });

  describe('empty state', () => {
    it('shows empty-state message when no items are detected', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_EMPTY);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE); // not called for empty

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(screen.getByTestId('scan-empty')).toBeInTheDocument();
      });
    });

    it('does not show scan-item rows when empty', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_EMPTY);

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        // Should have finished without items
        expect(screen.queryByTestId('scan-item-item-001')).not.toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    it('shows error state for a failing source', async () => {
      mockInboxScanFolder.mockRejectedValue(new Error('disk read error'));

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(screen.getByText(/disk read error/i)).toBeInTheDocument();
      });
    });

    it('completes other sources even when one fails (FR-005)', async () => {
      // First source fails, second succeeds
      mockInboxScanFolder
        .mockRejectedValueOnce(new Error('disk read error'))
        .mockResolvedValueOnce(SCAN_RESPONSE_WITH_ITEMS);
      mockInboxClassify.mockResolvedValue(CLASSIFY_RESPONSE);

      renderStep();

      // Error for first source
      await waitFor(() => {
        expect(screen.getByText(/disk read error/i)).toBeInTheDocument();
      });

      // Second source completes — wait for compact count summary, then expand
      await waitFor(() => {
        expect(within(screen.getByTestId('scan-source-/astro/projects')).getByText(/1 folder/)).toBeInTheDocument();
      });

      expandSource('/astro/projects');
      expect(screen.getByTestId('scan-item-item-001')).toBeInTheDocument();
    });

    it('enables Finish even when a source has errored (FR-005)', async () => {
      mockInboxScanFolder
        .mockRejectedValueOnce(new Error('disk read error'))
        .mockResolvedValueOnce(SCAN_RESPONSE_EMPTY);

      renderStep();

      await waitFor(() => {
        const finishBtn = screen.getByTestId('finish-button');
        expect(finishBtn).not.toBeDisabled();
      });
    });
  });

  describe('Finish button state', () => {
    it('keeps Finish disabled while scans are still running', () => {
      // Never-resolving promise keeps sources in scanning state
      mockInboxScanFolder.mockReturnValue(new Promise(() => {}));

      renderStep();

      const finishBtn = screen.getByTestId('finish-button');
      expect(finishBtn).toBeDisabled();
    });

    it('shows "Finishing…" label when isFinishing is true', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_EMPTY);

      renderStep({ isFinishing: true });

      // Even before scan completes the label reflects the prop
      expect(screen.getByTestId('finish-button')).toHaveTextContent('Finishing…');
    });
  });

  describe('no-sources edge case', () => {
    it('renders empty-sources message when sources list is empty', () => {
      renderStep({ sources: [] });

      expect(screen.getByText(/no sources registered/i)).toBeInTheDocument();
    });
  });

  describe('re-entry guard', () => {
    it('does not re-trigger scans when re-rendered with the same props', async () => {
      mockInboxScanFolder.mockResolvedValue(SCAN_RESPONSE_EMPTY);

      const { rerender } = renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(mockInboxScanFolder).toHaveBeenCalledTimes(1);
      });

      // Re-render with same props (simulates parent state update)
      rerender(
        <StepScan
          sources={[SOURCES[0]]}
          flushResult={FLUSH_RESULT}
          onFinish={vi.fn().mockResolvedValue(undefined)}
          isFinishing={false}
          onBack={vi.fn()}
        />,
      );

      // Should still be 1 — the ref guard prevents double scan
      await new Promise((r) => setTimeout(r, 10));
      expect(mockInboxScanFolder).toHaveBeenCalledTimes(1);
    });
  });
});
