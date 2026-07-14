// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * MatchCandidatesPanel tests — spec 007 UI wiring.
 *
 * Tests:
 * 1. Loading state renders loading indicator.
 * 2. Error state renders error banner.
 * 3. observer_location_missing renders the location-missing banner.
 * 4. session.mixed_state error renders the mixed-session banner.
 * 5. no_match status renders empty state.
 * 6. Ranked match candidates render with confidence bars.
 * 7. Dimension mismatches render with warning indicators (testids).
 * 8. Matched dimensions render with ✓ indicator.
 * 9. Suggest status pill renders correct label for 'match'.
 * 10. Suggest status pill renders 'ambiguous' label when ambiguous.
 * 11. Assign button is present for each candidate.
 * 12. Clicking Assign shows confirm state (prefill=true).
 * 13. Confirming assign calls onAssign with correct masterId and override=false.
 * 14. Assign with hard-rule violation: onAssign returns incompatible.dimensions →
 *     override confirm prompt renders.
 * 15. Force-assign calls onAssign with override=true.
 * 16. Cancel on confirm returns to idle state.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MatchCandidatesPanel } from './MatchCandidatesPanel';
import type { CalibrationMatchSuggestResponse } from '@/bindings/index';

// ── Test fixtures ──────────────────────────────────────────────────────────

const MASTER_ID_1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const MASTER_ID_2 = 'aaaaaaaa-0000-0000-0000-000000000002';

const matchResponse: CalibrationMatchSuggestResponse = {
  status: 'success',
  contractVersion: '2.0.0',
  requestId: 'req-001',
  suggestStatus: 'match',
  matches: [
    {
      sessionId: 'ses-001',
      masterId: MASTER_ID_1,
      calibrationType: 'dark',
      confidence: 1.0,
      dimensionsMatched: [
        {
          dimension: 'gain',
          observed: { value: 100 },
          reference: { value: 100 },
        },
        {
          dimension: 'offset',
          observed: { value: 50 },
          reference: { value: 50 },
        },
        {
          dimension: 'exposure',
          observed: { value: 300 },
          reference: { value: 300 },
          delta: 0,
        },
        {
          dimension: 'temperature',
          observed: { value: -10 },
          reference: { value: -10 },
          delta: 0,
        },
      ],
      dimensionsMismatched: [],
      selectionReason: 'compatible_fallback',
      // P9 session-context enrichment — fully resolved.
      targetName: 'M 31',
      filter: 'Ha',
      acquisitionNight: '2026-03-01',
      frameCount: 12,
    },
    {
      sessionId: 'ses-001',
      masterId: MASTER_ID_2,
      calibrationType: 'dark',
      confidence: 0.72,
      dimensionsMatched: [
        {
          dimension: 'gain',
          observed: { value: 100 },
          reference: { value: 100 },
        },
        {
          dimension: 'offset',
          observed: { value: 50 },
          reference: { value: 50 },
        },
      ],
      dimensionsMismatched: [
        { dimension: 'temperature', reason: 'out_of_tolerance', delta: 5.2 },
      ],
      selectionReason: 'compatible_fallback',
      // P9 session-context enrichment — unresolved (e.g. no canonical target
      // link, no fingerprint row); every field stays absent.
    },
  ],
};

const ambiguousResponse: CalibrationMatchSuggestResponse = {
  ...matchResponse,
  suggestStatus: 'ambiguous',
};

const noMatchResponse: CalibrationMatchSuggestResponse = {
  status: 'success',
  contractVersion: '2.0.0',
  requestId: 'req-002',
  suggestStatus: 'no_match',
  matches: [],
};

const observerMissingResponse: CalibrationMatchSuggestResponse = {
  status: 'error',
  contractVersion: '2.0.0',
  requestId: 'req-003',
  suggestStatus: 'observer_location_missing',
  error: {
    code: 'match.observer_location_missing',
    message: 'missing location',
  },
};

const mixedStateResponse: CalibrationMatchSuggestResponse = {
  status: 'error',
  contractVersion: '2.0.0',
  requestId: 'req-004',
  error: { code: 'session.mixed_state', message: 'mixed state' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const _noop = async () => ({ status: 'success' as const });

type OnAssignFn = (
  masterId: string,
  override: boolean,
) => Promise<{
  status: string;
  error?: { code: string; message: string; details?: { dimensions: string[] } };
}>;

function renderPanel(props: {
  response?: CalibrationMatchSuggestResponse;
  loading?: boolean;
  error?: string;
  onAssign?: OnAssignFn;
  assigning?: boolean;
  prefillSuggestion?: boolean;
}) {
  const {
    response,
    loading = false,
    error,
    onAssign = vi.fn().mockResolvedValue({ status: 'success' }),
    assigning = false,
    prefillSuggestion = true,
  } = props;

  return render(
    <MatchCandidatesPanel
      sessionId="ses-001"
      response={response}
      loading={loading}
      error={error}
      onAssign={onAssign}
      assigning={assigning}
      prefillSuggestion={prefillSuggestion}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MatchCandidatesPanel', () => {
  it('1. loading state renders loading indicator', () => {
    renderPanel({ loading: true });
    expect(screen.getByTestId('suggest-loading')).toBeInTheDocument();
  });

  it('2. error state renders error banner', () => {
    renderPanel({ error: 'Network failure' });
    expect(screen.getByTestId('suggest-error')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-error')).toHaveTextContent(
      'Network failure',
    );
  });

  it('3. observer_location_missing guard error renders observer-location warning', () => {
    // status: 'error' with code 'match.observer_location_missing' routes to the
    // guard-error banner with location text.
    renderPanel({ response: observerMissingResponse });
    expect(screen.getByTestId('suggest-guard-error')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-guard-error')).toHaveTextContent(
      'Observer location',
    );
  });

  it('4. session.mixed_state error renders the mixed-session banner', () => {
    renderPanel({ response: mixedStateResponse });
    expect(screen.getByTestId('suggest-guard-error')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-guard-error')).toHaveTextContent(
      'mixed',
    );
  });

  it('5. no_match status renders empty state', () => {
    renderPanel({ response: noMatchResponse });
    // Hero is now a compatible-SESSIONS match table (spec 043 §4): the empty
    // state reads "No compatible sessions".
    expect(screen.getByText('No compatible sessions')).toBeInTheDocument();
  });

  it('6. renders ranked candidates with confidence bars', () => {
    renderPanel({ response: matchResponse });
    const bars = screen.getAllByTestId('confidence-bar');
    // Two candidates → two bars
    expect(bars.length).toBe(2);
    // First bar is 100% wide (exact match)
    expect(bars[0]).toHaveStyle({ width: '100%' });
    // Second bar is 72% wide
    expect(bars[1]).toHaveStyle({ width: '72%' });
  });

  it('7. dimension mismatches render with warning testids', () => {
    renderPanel({ response: matchResponse });
    // Second candidate has temperature out_of_tolerance
    expect(screen.getByTestId('mismatch-temperature')).toBeInTheDocument();
    expect(screen.getByTestId('mismatch-temperature')).toHaveTextContent(
      'out of tolerance',
    );
  });

  it('8. matched dimensions render with a "matched" indicator', () => {
    renderPanel({ response: matchResponse });
    // gain is in dimensionsMatched for both candidates → multiple matched icons.
    // The check glyph is now a lucide <Check> with aria-label="matched"
    // (role="img"), so query by accessible name instead of literal text.
    const checks = screen.getAllByRole('img', { name: 'matched' });
    expect(checks.length).toBeGreaterThan(0);
  });

  it("9. suggest status pill shows 'match'", () => {
    renderPanel({ response: matchResponse });
    expect(screen.getByTestId('suggest-status-pill')).toHaveTextContent(
      'match',
    );
  });

  it("10. suggest status pill shows 'ambiguous'", () => {
    renderPanel({ response: ambiguousResponse });
    expect(screen.getByTestId('suggest-status-pill')).toHaveTextContent(
      'ambiguous',
    );
  });

  it('11. Assign button is present for each candidate', () => {
    renderPanel({ response: matchResponse });
    expect(screen.getByTestId(`assign-btn-${MASTER_ID_1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`assign-btn-${MASTER_ID_2}`)).toBeInTheDocument();
  });

  it('12. Clicking Assign shows confirm state (prefill=true)', () => {
    renderPanel({ response: matchResponse });
    fireEvent.click(screen.getByTestId(`assign-btn-${MASTER_ID_1}`));
    expect(screen.getByTestId('assign-confirm-btn')).toBeInTheDocument();
    expect(screen.getByTestId('assign-cancel-btn')).toBeInTheDocument();
  });

  it('13. Confirming assign calls onAssign with masterId and override=false', async () => {
    const onAssign: OnAssignFn = vi
      .fn()
      .mockResolvedValue({ status: 'success' }) as OnAssignFn;
    renderPanel({ response: matchResponse, onAssign });
    fireEvent.click(screen.getByTestId(`assign-btn-${MASTER_ID_1}`));
    fireEvent.click(screen.getByTestId('assign-confirm-btn'));
    await waitFor(() => {
      expect(onAssign).toHaveBeenCalledWith(MASTER_ID_1, false);
    });
  });

  it('14. hard-rule violation → override confirm prompt renders', async () => {
    const onAssign: OnAssignFn = vi.fn().mockResolvedValue({
      status: 'error',
      error: {
        code: 'incompatible.dimensions',
        message: 'Hard-rule mismatch',
        details: { dimensions: ['gain'] },
      },
    }) as OnAssignFn;
    renderPanel({ response: matchResponse, onAssign });
    fireEvent.click(screen.getByTestId(`assign-btn-${MASTER_ID_1}`));
    fireEvent.click(screen.getByTestId('assign-confirm-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('override-warning')).toBeInTheDocument();
      expect(screen.getByTestId('assign-override-btn')).toBeInTheDocument();
    });
  });

  it('15. Force-assign calls onAssign with override=true', async () => {
    const onAssign: OnAssignFn = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'error',
        error: {
          code: 'incompatible.dimensions',
          message: 'mismatch',
          details: { dimensions: ['gain'] },
        },
      })
      .mockResolvedValueOnce({ status: 'success' }) as OnAssignFn;
    renderPanel({ response: matchResponse, onAssign });
    // First click: Assign
    fireEvent.click(screen.getByTestId(`assign-btn-${MASTER_ID_1}`));
    // Second click: Confirm (triggers incompatible.dimensions error)
    fireEvent.click(screen.getByTestId('assign-confirm-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('assign-override-btn')).toBeInTheDocument();
    });
    // Third click: Force-assign
    fireEvent.click(screen.getByTestId('assign-override-btn'));
    await waitFor(() => {
      expect(onAssign).toHaveBeenNthCalledWith(2, MASTER_ID_1, true);
    });
  });

  it('16. Cancel on confirm returns to idle (no confirm button)', () => {
    renderPanel({ response: matchResponse });
    fireEvent.click(screen.getByTestId(`assign-btn-${MASTER_ID_1}`));
    expect(screen.getByTestId('assign-confirm-btn')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('assign-cancel-btn'));
    expect(screen.queryByTestId('assign-confirm-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId(`assign-btn-${MASTER_ID_1}`)).toBeInTheDocument();
  });

  it('17. renders target/filter/night/frames from the P9 session-context enrichment', () => {
    renderPanel({ response: matchResponse });
    expect(screen.getByText('M 31')).toBeInTheDocument();
    expect(screen.getByText('Ha')).toBeInTheDocument();
    expect(screen.getByText('2026-03-01')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('18. renders "—" fallback for each context field the backend could not resolve', () => {
    renderPanel({ response: matchResponse });
    // Candidate 2 (MASTER_ID_2) has no session-context fields — all four
    // columns fall back to the shared em-dash placeholder used elsewhere
    // (e.g. SessionsTable). The fully-resolved candidate 1 renders real
    // values, so at least one dash-per-field must come from candidate 2.
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });
});
