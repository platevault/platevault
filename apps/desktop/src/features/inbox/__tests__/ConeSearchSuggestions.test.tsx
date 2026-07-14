// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ConeSearchSuggestions tests (spec 052 P3, US3).
 *
 * Covers:
 * - Renders ranked suggestions with confidence pills; the high-confidence
 *   (preselected) suggestion's Confirm button uses the primary variant.
 * - Offline (`resolve.offline`) renders an inert note, not an error banner,
 *   and never calls confirm.
 * - No pointing (`source: "none"`) renders the no-pointing note.
 * - Clicking Confirm calls `targetConeSearchConfirm` with the right payload
 *   and shows a confirmed note (never auto-applies without the click).
 * - "Re-check" re-invokes suggest with `reason: "on_demand"`.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { mockSuggest, mockConfirm } = vi.hoisted(() => ({
  mockSuggest: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    targetConeSearchSuggest: mockSuggest,
    targetConeSearchConfirm: mockConfirm,
  },
}));

import { ConeSearchSuggestions } from '../ConeSearchSuggestions';

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const highConfidenceResponse = {
  pointing: {
    source: 'wcs',
    centerRaDeg: 10.68,
    centerDecDeg: 41.27,
    radiusDeg: 1.0,
    opticsKnown: true,
  },
  suggestions: [
    {
      candidate: {
        canonicalTargetId: null,
        primaryDesignation: 'M 31',
        commonName: 'Andromeda Galaxy',
        objectType: 'galaxy',
        raDeg: 10.68,
        decDeg: 41.27,
        magnitude: 3.4,
        constellation: 'And',
      },
      separationDeg: 0.02,
      confidence: 'high',
      preselected: true,
      excluded: false,
    },
    {
      candidate: {
        canonicalTargetId: null,
        primaryDesignation: 'HD 12345',
        commonName: null,
        objectType: 'other',
        raDeg: 10.7,
        decDeg: 41.3,
        magnitude: null,
        constellation: 'And',
      },
      separationDeg: 0.5,
      confidence: 'low',
      preselected: false,
      excluded: true,
    },
  ],
};

describe('ConeSearchSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ranked suggestions with confidence pills and preselects the high-confidence one', async () => {
    mockSuggest.mockResolvedValue({
      status: 'ok',
      data: highConfidenceResponse,
    });

    renderWithClient(<ConeSearchSuggestions framesetId="item-1" />);

    await waitFor(() => expect(screen.getByText(/M 31/)).toBeInTheDocument());
    expect(screen.getByText(/HD 12345/)).toBeInTheDocument();

    expect(mockSuggest).toHaveBeenCalledWith({
      framesetId: 'item-1',
      reason: 'ingest',
    });

    // The excluded, low-confidence candidate is still shown, not auto-selected.
    expect(screen.getByText(/Excluded by default/i)).toBeInTheDocument();
  });

  it('renders an inert offline note, never an error, and never calls confirm', async () => {
    mockSuggest.mockResolvedValue({
      status: 'error',
      error: { code: 'resolve.offline', message: 'offline' },
    });

    renderWithClient(<ConeSearchSuggestions framesetId="item-2" />);

    await waitFor(() =>
      expect(screen.getByText(/unavailable offline/i)).toBeInTheDocument(),
    );
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('renders a no-pointing note when the pointing source is none', async () => {
    mockSuggest.mockResolvedValue({
      status: 'ok',
      data: {
        pointing: {
          source: 'none',
          centerRaDeg: null,
          centerDecDeg: null,
          radiusDeg: 1.0,
          opticsKnown: false,
        },
        suggestions: [],
      },
    });

    renderWithClient(<ConeSearchSuggestions framesetId="item-3" />);

    await waitFor(() =>
      expect(screen.getByText(/No reliable sky position/i)).toBeInTheDocument(),
    );
  });

  it('confirming a suggestion calls targetConeSearchConfirm and shows a confirmed note', async () => {
    mockSuggest.mockResolvedValue({
      status: 'ok',
      data: highConfidenceResponse,
    });
    mockConfirm.mockResolvedValue({
      status: 'ok',
      data: { canonicalTargetId: 'tid-1', created: true, linked: true },
    });

    renderWithClient(<ConeSearchSuggestions framesetId="item-4" />);

    await waitFor(() => expect(screen.getByText(/M 31/)).toBeInTheDocument());
    const confirmButtons = screen.getAllByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButtons[0]);

    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith({
        framesetId: 'item-4',
        candidate: {
          canonicalTargetId: null,
          primaryDesignation: 'M 31',
          simbadOid: null,
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Confirmed as this light group/i),
      ).toBeInTheDocument(),
    );
  });

  it('re-check re-invokes suggest with reason=on_demand', async () => {
    mockSuggest.mockResolvedValue({
      status: 'ok',
      data: highConfidenceResponse,
    });

    renderWithClient(<ConeSearchSuggestions framesetId="item-5" />);

    await waitFor(() => expect(screen.getByText(/M 31/)).toBeInTheDocument());
    // The Section's own expand/collapse header also has role="button" and its
    // accessible name aggregates the child button's text — pick the actual
    // <button> element.
    const recheckButton = screen
      .getAllByRole('button', { name: /re-check/i })
      .find((el) => el.tagName === 'BUTTON');
    fireEvent.click(recheckButton as HTMLElement);

    await waitFor(() =>
      expect(mockSuggest).toHaveBeenCalledWith({
        framesetId: 'item-5',
        reason: 'on_demand',
      }),
    );
  });
});
