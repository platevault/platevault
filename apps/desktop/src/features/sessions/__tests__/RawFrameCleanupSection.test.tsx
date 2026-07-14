// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * RawFrameCleanupSection tests (spec 048 US3 T031 frontend).
 *
 * The raw sub-frame `cleanup.candidates.scan`/`cleanup.plan.generate`
 * extension had a real, tested backend (#500) but no UI surface at all
 * before this component. Verifies, mirroring the project-level
 * `OutputsCleanupSections.test.tsx` pattern:
 * 1. Pre-scan: no fabricated candidates; scan is on-demand.
 * 2. Scanned candidates render with checkboxes, reclaimable-byte total, and
 *    protected candidates are excluded from selection (no checkbox).
 * 3. Generate sends the selected frame ids + destination and opens the
 *    shared review overlay with the created plan id.
 * 4. Empty scan result renders the no-candidates teaching state.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawFrameCleanupScanResponse } from '@/bindings/index';

const { mockScanMutate, mockGenerateMutate, scanState, generateState } =
  vi.hoisted(() => ({
    mockScanMutate: vi.fn(),
    mockGenerateMutate: vi.fn(),
    scanState: {
      data: undefined as RawFrameCleanupScanResponse | undefined,
      isPending: false,
      isError: false,
    },
    generateState: { isPending: false, isError: false },
  }));

vi.mock('@/features/inventory/store', () => ({
  useRawFrameCleanupScan: () => ({ ...scanState, mutate: mockScanMutate }),
  useGenerateRawFrameCleanupPlan: () => ({
    ...generateState,
    mutate: mockGenerateMutate,
  }),
}));

vi.mock('@/features/plans/PlanReviewOverlay', () => ({
  PlanReviewOverlay: ({
    planId,
    open,
  }: {
    planId: string | null;
    open: boolean;
  }) =>
    open ? (
      <div data-testid="raw-cleanup-review-overlay-stub">{planId}</div>
    ) : null,
}));

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn() }),
}));

import { RawFrameCleanupSection } from '../RawFrameCleanupSection';

function scanResult(
  overrides: Partial<RawFrameCleanupScanResponse> = {},
): RawFrameCleanupScanResponse {
  return {
    candidates: [
      {
        frameId: 'frame-1',
        sessionId: 'session-1',
        rootId: 'root-1',
        relativePath: 'lights/frame_001.fits',
        frameType: 'light',
        sizeBytes: 1024,
        protection: 'normal',
        confidence: 1.0,
      },
      {
        frameId: 'frame-2',
        sessionId: 'session-1',
        rootId: 'root-1',
        relativePath: 'lights/frame_002.fits',
        frameType: 'light',
        sizeBytes: 2048,
        protection: 'protected',
        confidence: 1.0,
      },
    ],
    totalReclaimableBytes: 3072,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  scanState.data = undefined;
  scanState.isPending = false;
  scanState.isError = false;
  generateState.isPending = false;
  generateState.isError = false;
});

describe('RawFrameCleanupSection (spec 048 US3)', () => {
  it('renders the section and calls the raw scan on demand (no fabricated candidates)', () => {
    render(<RawFrameCleanupSection sessionId="session-1" />);
    expect(screen.getByTestId('session-raw-cleanup')).toBeInTheDocument();
    expect(
      screen.queryByTestId('raw-cleanup-candidate-frame-1'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('raw-cleanup-scan-btn'));
    expect(mockScanMutate).toHaveBeenCalledWith(
      { scope: { sessionId: 'session-1' } },
      expect.anything(),
    );
  });

  it('renders scanned candidates; protected candidates carry no checkbox', () => {
    scanState.data = scanResult();
    render(<RawFrameCleanupSection sessionId="session-1" />);

    const row1 = screen.getByTestId('raw-cleanup-candidate-frame-1');
    expect(
      within(row1).getByTestId('raw-cleanup-select-frame-1'),
    ).toBeInTheDocument();

    const row2 = screen.getByTestId('raw-cleanup-candidate-frame-2');
    expect(
      within(row2).queryByTestId('raw-cleanup-select-frame-2'),
    ).not.toBeInTheDocument();
    expect(within(row2).getByText('Protected')).toBeInTheDocument();
  });

  it('generates a plan with the selected (non-protected) frame ids and opens the review overlay', () => {
    scanState.data = scanResult();
    // Selection is seeded by the scan mutation's own onSuccess (mirrors real
    // usage: scan.data updating IS the result of that onSuccess firing).
    mockScanMutate.mockImplementation(
      (
        _vars: unknown,
        opts?: { onSuccess?: (r: RawFrameCleanupScanResponse) => void },
      ) => {
        opts?.onSuccess?.(scanState.data as RawFrameCleanupScanResponse);
      },
    );
    mockGenerateMutate.mockImplementation(
      (
        _vars: unknown,
        opts?: {
          onSuccess?: (r: { planId: string; itemCount: number }) => void;
        },
      ) => {
        opts?.onSuccess?.({ planId: 'plan-raw-1', itemCount: 1 });
      },
    );
    render(<RawFrameCleanupSection sessionId="session-1" />);

    fireEvent.click(screen.getByTestId('raw-cleanup-scan-btn'));
    fireEvent.click(screen.getByTestId('raw-cleanup-generate-btn'));
    // Only frame-1 (non-protected) is auto-selected after scan.
    expect(mockGenerateMutate).toHaveBeenCalledWith(
      { selectedFrameIds: ['frame-1'], destructiveDestination: 'archive' },
      expect.anything(),
    );
    expect(
      screen.getByTestId('raw-cleanup-review-overlay-stub'),
    ).toHaveTextContent('plan-raw-1');
  });

  it('renders the no-candidates teaching state for an empty scan result', () => {
    scanState.data = scanResult({ candidates: [], totalReclaimableBytes: 0 });
    render(<RawFrameCleanupSection sessionId="session-1" />);
    expect(
      screen.getByText('No raw sub-frame cleanup candidates'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('raw-cleanup-generate-btn'),
    ).not.toBeInTheDocument();
  });
});
