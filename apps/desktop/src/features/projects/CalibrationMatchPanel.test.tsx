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

// Mock the calibration-match IPC helper
vi.mock('./calibrationMatch', async (importOriginal) => {
  const original = await importOriginal<typeof import('./calibrationMatch')>();
  return { ...original, calibrationMatchSuggestBatch: vi.fn() };
});

import { CalibrationMatchPanel } from './CalibrationMatchPanel';
import { calibrationMatchSuggestBatch } from './calibrationMatch';
import type { CalibrationMatchBatchResponse } from '@/bindings/index';

const SESSION_1 = 'ses-aabbccdd-0001';
const SESSION_2 = 'ses-aabbccdd-0002';

function makeSuccessResponse(partial?: Partial<CalibrationMatchBatchResponse>): CalibrationMatchBatchResponse {
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
      { sessionId: SESSION_1, calibrationType: 'flat', status: 'no_match', candidates: [] },
      { sessionId: SESSION_1, calibrationType: 'bias', status: 'observer_location_missing' },
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
      { sessionId: SESSION_2, calibrationType: 'flat', status: 'ambiguous', candidates: [] },
      { sessionId: SESSION_2, calibrationType: 'bias', status: 'no_match', candidates: [] },
    ],
    ...partial,
  };
}

describe('CalibrationMatchPanel (spec 007 T034)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Renders nothing when sessionIds is empty', () => {
    const { container } = render(<CalibrationMatchPanel sessionIds={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('2. Loading state shows loading indicator', () => {
    vi.mocked(calibrationMatchSuggestBatch).mockReturnValue(new Promise(() => {})); // never resolves
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />);
    expect(screen.getByTestId('cal-panel-loading')).toBeInTheDocument();
  });

  it('3. Error state renders error message when batch fails', async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue({
      status: 'error',
      contractVersion: '1.0',
      requestId: 'req-err',
      errors: [{ code: 'session.not_found', message: 'Session not found', sessionId: SESSION_1 }],
    });
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />);
    await waitFor(() => {
      expect(screen.getByTestId('cal-panel-error')).toBeInTheDocument();
    });
  });

  it('4. Successful batch result renders per-session status pills', async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue(makeSuccessResponse());
    render(<CalibrationMatchPanel sessionIds={[SESSION_1, SESSION_2]} />);
    await waitFor(() => {
      expect(screen.getByTestId('cal-panel')).toBeInTheDocument();
    });
    // SESSION_1 dark → match pill
    expect(screen.getByTestId(`cal-type-dark-${SESSION_1}`)).toBeInTheDocument();
    // SESSION_2 flat → ambiguous
    expect(screen.getByTestId(`cal-type-flat-${SESSION_2}`)).toBeInTheDocument();
  });

  it("5. observer_location_missing renders 'needs location' label", async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue(makeSuccessResponse());
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />);
    await waitFor(() => {
      expect(screen.getByTestId(`cal-type-bias-${SESSION_1}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`cal-type-bias-${SESSION_1}`)).toHaveTextContent('needs location');
  });

  it('6. Confidence percentage shown for matching candidates', async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue(makeSuccessResponse());
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />);
    await waitFor(() => {
      expect(screen.getByTestId(`cal-confidence-dark-${SESSION_1}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`cal-confidence-dark-${SESSION_1}`)).toHaveTextContent('97%');
  });

  it('7. Empty state when results array is empty', async () => {
    vi.mocked(calibrationMatchSuggestBatch).mockResolvedValue({
      status: 'success',
      contractVersion: '1.0',
      requestId: 'req-empty',
      results: [],
    });
    render(<CalibrationMatchPanel sessionIds={[SESSION_1]} />);
    await waitFor(() => {
      expect(screen.getByTestId('cal-panel-empty')).toBeInTheDocument();
    });
  });
});
