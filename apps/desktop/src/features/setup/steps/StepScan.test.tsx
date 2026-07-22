// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * StepScan tests — first-run wizard "Scan" step (spec 038).
 *
 * Covers: scanning/done/empty/error states and the onAllDoneChange callback
 * contract.  Mocks commands.inboxScanFolder + commands.inboxClassify at the
 * generated @/bindings/index layer (spec 037 caller migration; same pattern
 * as SetupWizard.test.tsx), with unwrap() as the throw-on-error passthrough.
 *
 * NOTE: Back and Finish buttons now live in the SetupWizard footer, not inside
 * StepScan.  Tests for those buttons are in SetupWizard.test.tsx.  This file
 * tests StepScan's visual states and the `onAllDoneChange` callback that the
 * footer relies on to enable/disable Finish.
 */

import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryClient } from '@/data/queryClient';
import { overwriteGetLocale } from '@/paraglide/runtime';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockInboxScanFolder, mockInboxClassify, mockRootsList } = vi.hoisted(
  () => ({
    mockInboxScanFolder: vi.fn(),
    mockInboxClassify: vi.fn(),
    mockRootsList: vi.fn(),
  }),
);

vi.mock('@/bindings/index', () => ({
  commands: {
    inboxScanFolder: mockInboxScanFolder,
    inboxClassify: mockInboxClassify,
    rootsList: mockRootsList,
  },
}));

// unwrap() is the real implementation (@/api/ipc) — it throws `result.error`
// on `{ status: 'error' }`, so a mocked rejection is expressed as a resolved
// error-status result rather than mockRejectedValue.

// ── Component under test ─────────────────────────────────────────────────────

import { StepScan } from './StepScan';
import type { StepScanProps } from './StepScan';
import { sourceKindLabel } from '../sources-store';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SOURCES = [
  {
    path: '/astro/lights',
    kind: 'light_frames' as const,
    organizationState: 'organized' as const,
  },
  {
    path: '/astro/projects',
    kind: 'project' as const,
    organizationState: 'organized' as const,
  },
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
      format: 'fits',
      state: 'classified',
      contentSignature: 'sig-abc',
      isMaster: false,
      masterFrameType: null,
      masterFilter: null,
      masterExposureS: null,
    },
  ],
};

const CLASSIFY_RESPONSE = {
  inboxItemId: 'item-001',
  type: 'mixed',
  frameType: null,
  contentSignature: 'sig-abc',
  breakdown: [
    {
      kind: 'light',
      count: 16,
      destinationPreview: 'NGC7000/light/',
      sampleFiles: [],
    },
    {
      kind: 'dark',
      count: 2,
      destinationPreview: 'NGC7000/dark/',
      sampleFiles: [],
    },
  ],
  unclassifiedFiles: [],
  sampleFiles: [],
  computedAt: '2025-10-10T22:00:00Z',
};

const SCAN_RESPONSE_EMPTY = {
  rootId: 'root-002',
  items: [],
};

// A folder with an unclassified file alongside a light/flat mix (issue #513
// evidence: headerless darks land in unclassifiedFiles, not the breakdown).
const SCAN_RESPONSE_WITH_UNCLASSIFIED = {
  rootId: 'root-004',
  items: [
    {
      inboxItemId: 'item-002',
      relativePath: '',
      fileCount: 3,
      lane: 'fits',
      format: 'fits',
      state: 'classified',
      contentSignature: 'sig-def',
      isMaster: false,
      masterFrameType: null,
      masterFilter: null,
      masterExposureS: null,
    },
  ],
};

const CLASSIFY_RESPONSE_WITH_UNCLASSIFIED = {
  inboxItemId: 'item-002',
  type: 'mixed',
  frameType: null,
  contentSignature: 'sig-def',
  breakdown: [
    { kind: 'flat', count: 1, sampleFiles: [] },
    { kind: 'light', count: 1, sampleFiles: [] },
  ],
  unclassifiedFiles: ['stack_9.fits'],
  sampleFiles: [],
  computedAt: '2025-10-10T22:00:00Z',
};

// A single detected calibration master file (spec 040 FR-005/FR-006): the item
// carries its own frame type / exposure rather than relying on the breakdown.
const SCAN_RESPONSE_WITH_MASTER = {
  rootId: 'root-003',
  items: [
    {
      inboxItemId: 'master-001',
      relativePath: 'masters/masterDark_300s.xisf',
      fileCount: 1,
      lane: 'xisf',
      format: 'xisf',
      state: 'classified',
      contentSignature: 'sig-master',
      isMaster: true,
      masterFrameType: 'dark',
      masterFilter: null,
      masterExposureS: 300,
    },
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderStep(overrides: Partial<StepScanProps> = {}) {
  const onAllDoneChange = overrides.onAllDoneChange ?? vi.fn();
  return render(
    <StepScan
      sources={SOURCES}
      flushResult={FLUSH_RESULT}
      onAllDoneChange={onAllDoneChange}
      {...overrides}
    />,
    { wrapper },
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
  overwriteGetLocale(() => 'en-GB');
  mockInboxScanFolder.mockReset();
  mockInboxClassify.mockReset();
  mockRootsList.mockReset();
  // Query cache is keyed per source path/rootId; several tests reuse the same
  // fixture paths with different mock responses, so a stale cache entry from
  // a prior test would otherwise leak in as fresh data.
  queryClient.clear();
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
      expect(
        screen.getByTestId('scan-source-/astro/lights'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('scan-source-/astro/projects'),
      ).toBeInTheDocument();
    });

    it('calls inboxScanFolder for each source on mount', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

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
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep();

      await waitFor(() => {
        expect(mockInboxClassify).toHaveBeenCalledWith(
          expect.objectContaining({ inboxItemId: 'item-001' }),
        );
      });
    });

    // A classify failure used to be swallowed entirely, leaving the row
    // indistinguishable from a folder that genuinely had nothing to report:
    // both rendered an em dash and both dropped out of the per-kind chips
    // while still counting toward the header's file total. That is the
    // reconciliation gap issue #513 closed for unmapped IMAGETYP, reopened
    // for the crash case.
    it('says so when classification failed, instead of showing an em dash', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockRejectedValue(new Error('classify exploded'));

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      expandSource('/astro/lights');

      const row = screen.getByTestId('scan-item-item-001');
      expect(
        within(row).getByText(/could not read types/i),
      ).toBeInTheDocument();
      expect(within(row).queryByText('—')).not.toBeInTheDocument();
    });
  });

  describe('accordion — collapsed by default', () => {
    it('table rows are hidden by default before the accordion is expanded', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep({ sources: [SOURCES[0]] });

      // Wait for scan to finish — compact count summary appears in the header
      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      // Table row must NOT be visible — accordion is still collapsed
      expect(
        screen.queryByTestId('scan-item-item-001'),
      ).not.toBeInTheDocument();
    });

    it('reveals table rows after clicking the source header', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      expandSource('/astro/lights');

      expect(screen.getByTestId('scan-item-item-001')).toBeInTheDocument();
    });

    it('shows ▸ when collapsed and ▾ when expanded', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      const sourceEl = screen.getByTestId('scan-source-/astro/lights');
      expect(sourceEl).toHaveTextContent('▸');
      expect(sourceEl).not.toHaveTextContent('▾');

      expandSource('/astro/lights');

      expect(sourceEl).toHaveTextContent('▾');
      expect(sourceEl).not.toHaveTextContent('▸');
    });

    it('collapses again on second click', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      expandSource('/astro/lights');
      expect(screen.getByTestId('scan-item-item-001')).toBeInTheDocument();

      expandSource('/astro/lights');
      expect(
        screen.queryByTestId('scan-item-item-001'),
      ).not.toBeInTheDocument();
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
    it.each([
      ['en-GB', 1, '1 unknown frame type (science)'],
      ['en-GB', 3, '3 unknown frame types (science)'],
      ['pt-BR', 1, '1 quadro de tipo desconhecido (science)'],
      ['pt-BR', 3, '3 quadros de tipo desconhecido (science)'],
    ] as const)(
      'renders unknown-kind count labels in %s for count %i',
      async (locale, count, expected) => {
        overwriteGetLocale(() => locale);
        mockInboxScanFolder.mockResolvedValue({
          status: 'ok',
          data: {
            ...SCAN_RESPONSE_WITH_ITEMS,
            items: [{ ...SCAN_RESPONSE_WITH_ITEMS.items[0], fileCount: count }],
          },
        });
        mockInboxClassify.mockResolvedValue({
          status: 'ok',
          data: {
            ...CLASSIFY_RESPONSE,
            breakdown: [
              {
                kind: 'science',
                count,
                destinationPreview: 'NGC7000/science/',
                sampleFiles: [],
              },
            ],
          },
        });

        renderStep({ sources: [SOURCES[0]] });

        await waitFor(() =>
          expect(
            within(screen.getByTestId('scan-source-/astro/lights')).getByText(
              /1 (folder|pasta)/,
            ),
          ).toBeInTheDocument(),
        );
        expandSource('/astro/lights');

        expect(screen.getAllByText(expected)).toHaveLength(2);
      },
    );

    it('shows detected items and frame-type breakdown when scan completes (after expanding)', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep({ sources: [SOURCES[0]] });

      // Wait for scan to complete
      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      // Must expand the accordion to see the detail panel
      expandSource('/astro/lights');

      expect(screen.getByTestId('scan-item-item-001')).toBeInTheDocument();
      // Item path visible
      expect(screen.getByText('2025-10-10/NGC7000')).toBeInTheDocument();
      // Breakdown kinds visible (light=16, dark=2)
      expect(screen.getByText('16 light frames')).toBeInTheDocument();
      expect(screen.getByText('2 dark frames')).toBeInTheDocument();
    });

    it('renders a Master pill and the frame type for individual masters (spec 040 FR-006)', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_MASTER,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      expandSource('/astro/lights');

      const row = screen.getByTestId('scan-item-master-001');
      // "Master" pill in the Folder/File cell
      expect(within(row).getByText('Master')).toBeInTheDocument();
      // Frame type + exposure in the Detected types cell (filter null → omitted).
      // Exposure now goes through the shared formatExposureSeconds (#811).
      expect(within(row).getByText('Master Dark · 300 s')).toBeInTheDocument();
    });

    it('reconciles the file count by surfacing unclassified files (issue #513)', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_UNCLASSIFIED,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE_WITH_UNCLASSIFIED,
      });

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      expandSource('/astro/lights');

      const row = screen.getByTestId('scan-item-item-002');
      // 1 flat + 1 light + 1 unknown = 3, matching fileCount.
      expect(
        within(row).getByText('1 flat frame, 1 light frame, 1 unknown'),
      ).toBeInTheDocument();
      expect(within(row).getByText('3')).toBeInTheDocument();
    });

    it('labels the root row instead of leaving the Folder/File cell blank (issue #513)', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_UNCLASSIFIED,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE_WITH_UNCLASSIFIED,
      });

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      expandSource('/astro/lights');

      const row = screen.getByTestId('scan-item-item-002');
      expect(within(row).getByText('(root)')).toBeInTheDocument();
    });

    it('surfaces masters and unclassified counts in the source header chips (issue #513)', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: {
          rootId: 'root-005',
          items: [
            ...SCAN_RESPONSE_WITH_MASTER.items,
            ...SCAN_RESPONSE_WITH_UNCLASSIFIED.items,
          ],
        },
      });
      mockInboxClassify.mockImplementation(({ inboxItemId }) =>
        Promise.resolve({
          status: 'ok',
          data:
            inboxItemId === 'item-002'
              ? CLASSIFY_RESPONSE_WITH_UNCLASSIFIED
              : CLASSIFY_RESPONSE,
        }),
      );

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/lights')).getByText(
            /2 folders/,
          ),
        ).toBeInTheDocument();
      });

      expandSource('/astro/lights');

      const sourceEl = screen.getByTestId('scan-source-/astro/lights');
      expect(within(sourceEl).getByText('1 master')).toBeInTheDocument();
      expect(within(sourceEl).getByText('1 unknown')).toBeInTheDocument();
    });

    it('shows the scan summary when all sources are done', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep();

      await waitFor(() => {
        expect(screen.getByTestId('scan-summary')).toBeInTheDocument();
      });
    });

    it('calls onAllDoneChange(true) once all sources finish', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      const onAllDoneChange = vi.fn();
      renderStep({ onAllDoneChange });

      await waitFor(() => {
        expect(onAllDoneChange).toHaveBeenCalledWith(true);
      });
    });
  });

  describe('empty state', () => {
    it('shows empty-state message when no items are detected', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_EMPTY,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      }); // not called for empty

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(screen.getByTestId('scan-empty')).toBeInTheDocument();
      });
    });

    it('does not show scan-item rows when empty', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_EMPTY,
      });

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        // Should have finished without items
        expect(
          screen.queryByTestId('scan-item-item-001'),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    it('shows error state for a failing source', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'error',
        error: new Error('disk read error'),
      });

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        const alert = within(
          screen.getByTestId('scan-source-/astro/lights'),
        ).getByRole('alert');
        expect(alert).toHaveTextContent('/astro/lights');
        expect(alert).toHaveTextContent(/disk read error/i);
      });
    });

    it('completes other sources even when one fails (FR-005)', async () => {
      // First source fails, second succeeds
      mockInboxScanFolder
        .mockResolvedValueOnce({
          status: 'error',
          error: new Error('disk read error'),
        })
        .mockResolvedValueOnce({
          status: 'ok',
          data: SCAN_RESPONSE_WITH_ITEMS,
        });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep();

      // Error for first source
      await waitFor(() => {
        expect(screen.getByText(/disk read error/i)).toBeInTheDocument();
      });

      // Second source completes — wait for compact count summary, then expand
      await waitFor(() => {
        expect(
          within(screen.getByTestId('scan-source-/astro/projects')).getByText(
            /1 folder/,
          ),
        ).toBeInTheDocument();
      });

      expandSource('/astro/projects');
      expect(screen.getByTestId('scan-item-item-001')).toBeInTheDocument();
    });

    it('calls onAllDoneChange(true) even when a source has errored (FR-005)', async () => {
      mockInboxScanFolder
        .mockResolvedValueOnce({
          status: 'error',
          error: new Error('disk read error'),
        })
        .mockResolvedValueOnce({ status: 'ok', data: SCAN_RESPONSE_EMPTY });

      const onAllDoneChange = vi.fn();
      renderStep({ onAllDoneChange });

      await waitFor(() => {
        expect(onAllDoneChange).toHaveBeenCalledWith(true);
      });
    });
  });

  describe('screen-reader status', () => {
    it('announces source and final scan status politely', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_WITH_ITEMS,
      });
      mockInboxClassify.mockResolvedValue({
        status: 'ok',
        data: CLASSIFY_RESPONSE,
      });

      renderStep({ sources: [SOURCES[0]] });

      const source = screen.getByTestId('scan-source-/astro/lights');
      await waitFor(() =>
        expect(within(source).getByRole('status')).toHaveTextContent('Done'),
      );
      expect(within(source).getByRole('status')).toHaveAttribute(
        'aria-live',
        'polite',
      );
      expect(screen.getByTestId('scan-summary')).toHaveAttribute(
        'aria-atomic',
        'true',
      );
    });

    it('uses a localized source label instead of formatting the enum', () => {
      mockInboxScanFolder.mockReturnValue(new Promise(() => {}));

      renderStep({ sources: [SOURCES[0]] });

      expect(screen.getByText('Light frames')).toBeInTheDocument();
      expect(screen.queryByText('light frames')).not.toBeInTheDocument();
    });

    it('keeps unknown source kinds diagnostic instead of reading prototype keys', () => {
      expect(sourceKindLabel('toString')).toBe('Unknown source (toString)');
    });
  });

  describe('onAllDoneChange callback', () => {
    it('does not call onAllDoneChange(true) while scans are still running', () => {
      // Never-resolving promise keeps sources in scanning state
      mockInboxScanFolder.mockReturnValue(new Promise(() => {}));

      const onAllDoneChange = vi.fn();
      renderStep({ onAllDoneChange });

      // May be called with false on initial render but must never be called with true
      expect(onAllDoneChange).not.toHaveBeenCalledWith(true);
    });
  });

  describe('no-sources edge case', () => {
    it('renders empty-sources message when sources list is empty', () => {
      renderStep({ sources: [] });

      expect(screen.getByText(/no sources registered/i)).toBeInTheDocument();
    });
  });

  describe('partial-retry: alreadyRegistered sources (issue #916)', () => {
    it('still scans a source that registered on an earlier attempt this session but was never actually scanned', async () => {
      mockRootsList.mockResolvedValue({
        status: 'ok',
        data: [
          {
            id: 'root-existing',
            path: '/astro/lights',
            category: 'raw',
            online: true,
            fileCount: 0,
            lastScanned: null,
            active: true,
          },
        ],
      });
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_EMPTY,
      });

      renderStep({
        sources: [SOURCES[0]],
        flushResult: {
          results: [
            {
              kind: 'light_frames',
              path: '/astro/lights',
              success: false,
              alreadyRegistered: true,
            },
          ],
          allSucceeded: true,
        },
      });

      await waitFor(() => {
        expect(mockInboxScanFolder).toHaveBeenCalledWith(
          expect.objectContaining({
            rootId: 'root-existing',
            rootAbsolutePath: '/astro/lights',
          }),
        );
      });
    });

    it('skips a source that genuinely already completed a scan in a prior session', async () => {
      mockRootsList.mockResolvedValue({
        status: 'ok',
        data: [
          {
            id: 'root-existing',
            path: '/astro/lights',
            category: 'raw',
            online: true,
            fileCount: 0,
            lastScanned: '2026-07-01T00:00:00Z',
            active: true,
          },
        ],
      });

      renderStep({
        sources: [SOURCES[0]],
        flushResult: {
          results: [
            {
              kind: 'light_frames',
              path: '/astro/lights',
              success: false,
              alreadyRegistered: true,
            },
          ],
          allSucceeded: true,
        },
      });

      await waitFor(() => {
        expect(screen.getByText(/no sources registered/i)).toBeInTheDocument();
      });
      expect(mockInboxScanFolder).not.toHaveBeenCalled();
    });

    it('does not call roots.list when no source is alreadyRegistered', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_EMPTY,
      });

      renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(mockInboxScanFolder).toHaveBeenCalledTimes(1);
      });
      expect(mockRootsList).not.toHaveBeenCalled();
    });

    it('surfaces (does not silently drop) an alreadyRegistered source when roots.list fails', async () => {
      mockRootsList.mockRejectedValue(new Error('network down'));

      renderStep({
        sources: [SOURCES[0]],
        flushResult: {
          results: [
            {
              kind: 'light_frames',
              path: '/astro/lights',
              success: false,
              alreadyRegistered: true,
            },
          ],
          allSucceeded: true,
        },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId('scan-source-/astro/lights'),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByText(/could not verify whether this source/i),
      ).toBeInTheDocument();
      expect(mockInboxScanFolder).not.toHaveBeenCalled();
    });

    it('surfaces an alreadyRegistered source with no matching roots.list entry instead of dropping it', async () => {
      mockRootsList.mockResolvedValue({ status: 'ok', data: [] });

      renderStep({
        sources: [SOURCES[0]],
        flushResult: {
          results: [
            {
              kind: 'light_frames',
              path: '/astro/lights',
              success: false,
              alreadyRegistered: true,
            },
          ],
          allSucceeded: true,
        },
      });

      await waitFor(() => {
        expect(
          screen.getByText(/could not verify whether this source/i),
        ).toBeInTheDocument();
      });
      expect(mockInboxScanFolder).not.toHaveBeenCalled();
    });
  });

  describe('empty-state resolution gating (review round 2 #2)', () => {
    it('does not flash "no sources registered" while alreadyRegistered resolution is pending', () => {
      // Never resolves — holds the component in the pre-`resolved` state.
      mockRootsList.mockReturnValue(new Promise(() => {}));

      renderStep({
        sources: [SOURCES[0]],
        flushResult: {
          results: [
            {
              kind: 'light_frames',
              path: '/astro/lights',
              success: false,
              alreadyRegistered: true,
            },
          ],
          allSucceeded: true,
        },
      });

      expect(
        screen.queryByText(/no sources registered/i),
      ).not.toBeInTheDocument();
    });
  });

  describe('re-entry guard', () => {
    it('does not re-trigger scans when re-rendered with the same props', async () => {
      mockInboxScanFolder.mockResolvedValue({
        status: 'ok',
        data: SCAN_RESPONSE_EMPTY,
      });

      const { rerender } = renderStep({ sources: [SOURCES[0]] });

      await waitFor(() => {
        expect(mockInboxScanFolder).toHaveBeenCalledTimes(1);
      });

      // Re-render with same props (simulates parent state update)
      rerender(
        <StepScan
          sources={[SOURCES[0]]}
          flushResult={FLUSH_RESULT}
          onAllDoneChange={vi.fn()}
        />,
      );

      // Should still be 1 — the ref guard prevents double scan
      await new Promise((r) => setTimeout(r, 10));
      expect(mockInboxScanFolder).toHaveBeenCalledTimes(1);
    });
  });
});
