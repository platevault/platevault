// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * OutputsCleanupSections tests — spec 043 §4 (task #44) + spec 017 WP-E.
 *
 * Outputs:
 * - Teaching empty state when no accepted outputs exist (STUB path).
 * - Outputs table + verification pills when outputs are present.
 *
 * Cleanup (spec 017 WP-E two-step flow):
 * 1. Pre-scan: teaching prompt + scan button; no fabricated candidates.
 * 2. Scan renders candidates grouped by classification with confidence,
 *    reclaimable bytes, and protected rows clearly marked.
 * 3. Protected candidates are NOT selectable — no selection affordance exists.
 * 4. Generate flow sends projectId + chosen destructive destination and opens
 *    the shared review overlay with the created plan id.
 * 5. Empty scan result renders the no-candidates teaching state (no generate).
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CleanupScanResult } from '@/bindings/index';

const { mockScanMutate, mockGenerateMutate, scanState, generateState } =
  vi.hoisted(() => ({
    mockScanMutate: vi.fn(),
    mockGenerateMutate: vi.fn(),
    scanState: {
      data: undefined as CleanupScanResult | undefined,
      isPending: false,
      isError: false,
    },
    generateState: { isPending: false, isError: false },
  }));

vi.mock('./cleanupStore', () => ({
  useCleanupScan: () => ({ ...scanState, mutate: mockScanMutate }),
  useGenerateCleanupPlan: () => ({
    ...generateState,
    mutate: mockGenerateMutate,
  }),
}));

// The shared overlay has its own test file; stub it to observe the handoff.
vi.mock('@/features/plans/PlanReviewOverlay', () => ({
  PlanReviewOverlay: ({
    planId,
    open,
  }: {
    planId: string | null;
    open: boolean;
  }) =>
    open ? <div data-testid="plan-review-overlay-stub">{planId}</div> : null,
}));

import { OutputsSection, CleanupSection } from './OutputsCleanupSections';

function scanResult(
  overrides: Partial<CleanupScanResult> = {},
): CleanupScanResult {
  return {
    projectId: 'p1',
    candidates: [
      {
        filePath: 'calibrated/light_001.xisf',
        dataType: 'intermediate',
        sizeBytes: 1024,
        reason:
          'intermediate artifact (classified by rule, 90% confidence); protection: normal; policy: archive',
      },
      {
        filePath: 'masters/master_dark.xisf',
        dataType: 'master',
        sizeBytes: 4096,
        reason:
          'master artifact (classified by rule, 95% confidence); protection: protected; policy: archive',
      },
    ],
    totalReclaimableBytes: 5120,
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

describe('OutputsSection (spec 043 §4)', () => {
  it('renders a teaching empty state when no outputs exist (STUB path)', () => {
    render(<OutputsSection />);
    expect(screen.getByTestId('project-outputs')).toBeInTheDocument();
    expect(screen.getByText('No accepted outputs yet')).toBeInTheDocument();
    // No fabricated table rows.
    expect(screen.queryByText('VERIFICATION')).not.toBeInTheDocument();
  });

  it('renders a verification pill per output when outputs are supplied', () => {
    render(
      <OutputsSection
        outputs={[
          {
            id: 'o1',
            name: 'NGC7000_HOO.xisf',
            format: 'XISF',
            verified: true,
          },
          {
            id: 'o2',
            name: 'NGC7000_draft.tif',
            format: 'TIFF',
            verified: false,
          },
        ]}
      />,
    );
    expect(screen.getByText('NGC7000_HOO.xisf')).toBeInTheDocument();
    expect(screen.getByText('verified')).toBeInTheDocument();
    expect(screen.getByText('unverified')).toBeInTheDocument();
    expect(
      screen.queryByText('No accepted outputs yet'),
    ).not.toBeInTheDocument();
  });
});

describe('CleanupSection (spec 017 WP-E)', () => {
  it('renders the scan prompt and calls cleanup.scan on demand (no fabricated data)', () => {
    render(<CleanupSection projectId="p1" />);
    expect(screen.getByTestId('project-cleanup-preview')).toBeInTheDocument();
    // Read-only teaching copy before any scan.
    expect(screen.getByText(/Scanning is read-only/)).toBeInTheDocument();
    // Protected categories documented (constitution II).
    expect(screen.getByTestId('cleanup-protected')).toBeInTheDocument();
    // No candidates invented pre-scan.
    expect(
      screen.queryByTestId('cleanup-group-intermediate'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cleanup-scan-btn'));
    expect(mockScanMutate).toHaveBeenCalledWith('p1');
  });

  it('renders scanned candidates grouped by classification with confidence and bytes', () => {
    scanState.data = scanResult();
    render(<CleanupSection projectId="p1" />);

    // Groups in classification order with subtotals.
    const intermediates = screen.getByTestId('cleanup-group-intermediate');
    expect(
      within(intermediates).getByText('Intermediates'),
    ).toBeInTheDocument();
    expect(
      within(intermediates).getByText('calibrated/light_001.xisf'),
    ).toBeInTheDocument();
    expect(within(intermediates).getByText('90%')).toBeInTheDocument();

    const masters = screen.getByTestId('cleanup-group-master');
    expect(
      within(masters).getByText('masters/master_dark.xisf'),
    ).toBeInTheDocument();
    expect(within(masters).getByText('95%')).toBeInTheDocument();

    // Total reclaimable bytes surfaced.
    expect(screen.getByTestId('cleanup-reclaimable')).toHaveTextContent(
      'reclaimable',
    );
  });

  it('marks protected candidates and offers no selection affordance', () => {
    scanState.data = scanResult();
    render(<CleanupSection projectId="p1" />);

    const masters = screen.getByTestId('cleanup-group-master');
    const protectedRow = within(masters).getByTestId('cleanup-candidate-0');
    expect(protectedRow).toHaveClass('alm-cleanup-scan__row--protected');
    expect(within(protectedRow).getByText('Protected')).toBeInTheDocument();

    // NOT selectable (constitution II): no checkboxes/switches anywhere in the
    // candidate tables — inclusion is governed by policy + the protection gate.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('generates a plan with the chosen destination and opens the review overlay', () => {
    scanState.data = scanResult();
    mockGenerateMutate.mockImplementation(
      (
        _vars: unknown,
        opts?: {
          onSuccess?: (r: {
            planId: string;
            itemCount: number;
            protectedItemCount: number;
          }) => void;
        },
      ) => {
        opts?.onSuccess?.({
          planId: 'plan-9',
          itemCount: 2,
          protectedItemCount: 1,
        });
      },
    );
    render(<CleanupSection projectId="p1" />);

    // Default destination is the canonical archive.
    fireEvent.click(screen.getByTestId('cleanup-generate-btn'));
    expect(mockGenerateMutate).toHaveBeenCalledWith(
      { projectId: 'p1', destructiveDestination: 'archive' },
      expect.anything(),
    );
    // Handoff to the shared review overlay with the created plan.
    expect(screen.getByTestId('plan-review-overlay-stub')).toHaveTextContent(
      'plan-9',
    );

    // Switching to system trash flows through on the next generate.
    fireEvent.click(screen.getByText('System trash'));
    fireEvent.click(screen.getByTestId('cleanup-generate-btn'));
    expect(mockGenerateMutate).toHaveBeenLastCalledWith(
      { projectId: 'p1', destructiveDestination: 'trash' },
      expect.anything(),
    );
  });

  it('renders the no-candidates teaching state for an empty scan result', () => {
    scanState.data = scanResult({ candidates: [], totalReclaimableBytes: 0 });
    render(<CleanupSection projectId="p1" />);
    expect(screen.getByText('No cleanup candidates')).toBeInTheDocument();
    expect(
      screen.queryByTestId('cleanup-generate-btn'),
    ).not.toBeInTheDocument();
  });
});
