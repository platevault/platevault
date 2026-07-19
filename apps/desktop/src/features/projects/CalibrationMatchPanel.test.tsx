// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * CalibrationMatchPanel tests — spec 007 T034.
 *
 * Tests:
 * 1. Renders nothing when sessionIds is empty.
 * 2. Loading state shows loading indicator.
 * 3. Error state renders error message.
 * 4. Successful batch result renders per-session + per-type status pills.
 * 5. observer_location_missing status renders 'needs location' label.
 * 6. Confidence is shown for candidates with matches.
 * 7. Hard error (session.not_found) renders error state.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the calibration-match IPC helper
vi.mock('./calibrationMatch', async (importOriginal) => {
  const original = await importOriginal<typeof import('./calibrationMatch')>();
  return { ...original, calibrationMatchSuggestBatch: vi.fn() };
});

// The shared useEntityNames hook (#809) resolves session names via
// useInventorySources — mock `inventoryList` so the panel's name lookup
// doesn't hit a real Tauri bridge in jsdom. Empty by default; individual
// tests override via mockResolvedValueOnce to prove name resolution.
const { mockInventoryList } = vi.hoisted(() => ({
  mockInventoryList: vi.fn(),
}));
vi.mock('@/bindings/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...original,
    commands: { ...original.commands, inventoryList: mockInventoryList },
  };
});

import { CalibrationMatchPanel } from './CalibrationMatchPanel';
import { calibrationMatchSuggestBatch } from './calibrationMatch';
import type { CalibrationMatchBatchResponse } from '@/bindings/index';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const SESSION_1 = 'ses-aabbccdd-0001';
const SESSION_2 = 'ses-aabbccdd-0002';

function makeSuccessResponse(
  partial?: Partial<CalibrationMatchBatchResponse>,
): CalibrationMatchBatchResponse {
  return {
    status: 'success',
    contractVersion: '1.0',
    requestId: 'req-batch-1',
    results: [
      {
        sessionId: SESSION_1,
        calibrationType: 'dark',
        status: 'match',
        candidates: [
          {
            sessionId: SESSION_1,
            masterId: 'master-dark-1',
            calibrationType: 'dark',
            confidence: 0.97,
            dimensionsMatched: [{ dimension: 'gain' }],
            dimensionsMismatched: [],
            selectionReason: 'compatible_fallback',
          },
        ],
      },
      {
        sessionId: SESSION_1,
        calibrationType: 'flat',
        status: 'no_match',
        candidates: [],
      },
      {
        sessionId: SESSION_1,
        calibrationType: 'bias',
        status: 'match.observer_location_missing',
      },
      {
        sessionId: SESSION_2,
        calibrationType: 'dark',
        status: 'match',
        candidates: [
          {
            sessionId: SESSION_2,
            masterId: 'master-dark-2',
            calibrationType: 'dark',
            confidence: 0.85,
            dimensionsMatched: [],
            dimensionsMismatched: [],
            selectionReason: 'compatible_fallback',
          },
        ],
      },
      {
        sessionId: SESSION_2,
        calibrationType: 'flat',
        status: 'ambiguous',
        candidates: [],
      },
      {
        sessionId: SESSION_2,
        calibrationType: 'bias',
        status: 'no_match',
        candidates: [],
      },
    ],
    ...partial,
  };
}

describe('CalibrationMatchPanel (spec 007 T034)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInventoryList.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'ok',
        contractVersion: '1.0',
        requestId: 'req-inventory',
        generatedAt: '2026-01-01T00:00:00Z',
        sources: [],
      },
    });
  });

  it('1. Renders nothing when sessionIds is empty', () => {
    const { container } = render(<CalibrationMatchPanel sessionIds={[]} />, {
      wrapper,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('2. Loading state shows loading indicator', () => {
    vi.mocked(calibrationMatchSuggestBatch).mockReturnValue(
      new Promise(() => {}),
    ); // never resolves
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />, { wrapper });
    expect(screen.getByTestId('cal-panel-loading')).toBeInTheDocument();
  });

  it('3. Error state renders error message when batch fails', async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue({
      status: 'error',
      contractVersion: '1.0',
      requestId: 'req-err',
      errors: [
        {
          code: 'session.not_found',
          message: 'Session not found',
          sessionId: SESSION_1,
        },
      ],
    });
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />, { wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('cal-panel-error')).toBeInTheDocument();
    });
  });

  it('4. Successful batch result renders per-session status pills', async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue(
      makeSuccessResponse(),
    );
    render(<CalibrationMatchPanel sessionIds={[SESSION_1, SESSION_2]} />, {
      wrapper,
    });
    await waitFor(() => {
      expect(screen.getByTestId('cal-panel')).toBeInTheDocument();
    });
    // SESSION_1 dark → match pill
    expect(
      screen.getByTestId(`cal-type-dark-${SESSION_1}`),
    ).toBeInTheDocument();
    // SESSION_2 flat → ambiguous
    expect(
      screen.getByTestId(`cal-type-flat-${SESSION_2}`),
    ).toBeInTheDocument();
  });

  it("5. observer_location_missing renders 'needs location' label", async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue(
      makeSuccessResponse(),
    );
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />, { wrapper });
    await waitFor(() => {
      expect(
        screen.getByTestId(`cal-type-bias-${SESSION_1}`),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId(`cal-type-bias-${SESSION_1}`)).toHaveTextContent(
      'needs location',
    );
  });

  it('6. Confidence percentage shown for matching candidates', async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue(
      makeSuccessResponse(),
    );
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />, { wrapper });
    await waitFor(() => {
      expect(
        screen.getByTestId(`cal-confidence-dark-${SESSION_1}`),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`cal-confidence-dark-${SESSION_1}`),
    ).toHaveTextContent('97%');
  });

  it('7. Empty state when results array is empty', async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue({
      status: 'success',
      contractVersion: '1.0',
      requestId: 'req-empty',
      results: [],
    });
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />, { wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('cal-panel-empty')).toBeInTheDocument();
    });
  });

  it('8. unrecognized status code renders the localized fallback, never the raw code (#664)', async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue(
      makeSuccessResponse({
        results: [
          {
            sessionId: SESSION_1,
            calibrationType: 'dark',
            status: 'some.unhandled.code',
            candidates: [],
          },
        ],
      }),
    );
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />, { wrapper });
    await waitFor(() => {
      expect(
        screen.getByTestId(`cal-type-dark-${SESSION_1}`),
      ).toBeInTheDocument();
    });
    const pill = screen.getByTestId(`cal-type-dark-${SESSION_1}`);
    expect(pill).toHaveTextContent('unknown status');
    expect(pill).not.toHaveTextContent('some.unhandled.code');
  });

  it('9. resolves a session id to its display name via the shared entity-name hook (#809)', async () => {
    mockInventoryList.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'ok',
        contractVersion: '1.0',
        requestId: 'req-inventory',
        generatedAt: '2026-01-01T00:00:00Z',
        sources: [
          {
            id: 'src-1',
            path: '/library/src-1',
            kind: 'library',
            state: 'active',
            sessions: [
              {
                id: SESSION_1,
                name: 'M31 – 2026-05-20',
                sourceId: 'src-1',
                frames: 40,
                type: 'light',
                target: 'M31',
                filter: null,
                exposure: null,
              },
            ],
          },
        ],
      },
    });
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue(
      makeSuccessResponse(),
    );
    render(<CalibrationMatchPanel sessionIds={[SESSION_1, SESSION_2]} />, {
      wrapper,
    });
    await waitFor(() => {
      expect(screen.getByTestId('cal-panel')).toBeInTheDocument();
    });
    // SESSION_1 has a resolved name; SESSION_2 has no matching inventory
    // source, so it keeps the truncated raw-id fallback.
    expect(screen.getByText('M31 – 2026-05-20')).toBeInTheDocument();
    expect(screen.getByText(`${SESSION_2.slice(0, 12)}…`)).toBeInTheDocument();
  });
});
