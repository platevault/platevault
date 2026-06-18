/// <reference types="@testing-library/jest-dom" />
/**
 * StepCatalogs tests — spec 035 (repurposed first-run "Target resolution" step).
 *
 * The step no longer downloads catalogs (spec-014 backend removed). It now shows
 * the SIMBAD online-resolution toggle plus an explanatory note. These tests
 * confirm the new content and the absence of any catalog-download affordance.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockUpdate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  getResolverSettings: mockGet,
  updateResolverSettings: mockUpdate,
}));

import { StepCatalogs, DEFAULT_CATALOG_SETTINGS } from './StepCatalogs';

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockGet.mockResolvedValue({
    contractVersion: '1.0',
    requestId: 'r',
    settings: {
      onlineEnabled: true,
      simbadEndpoint: 'https://simbad.example/tap',
      debounceMs: 300,
      requestTimeoutSecs: 10,
    },
  });
});

describe('StepCatalogs (Target resolution)', () => {
  it('renders the SIMBAD online-resolution toggle', async () => {
    render(
      <StepCatalogs settings={DEFAULT_CATALOG_SETTINGS} onSettingsChange={vi.fn()} />,
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(
      screen.getByLabelText('Enable online SIMBAD resolution'),
    ).toBeInTheDocument();
  });

  it('explains on-demand SIMBAD resolution with a bundled seed', () => {
    render(
      <StepCatalogs settings={DEFAULT_CATALOG_SETTINGS} onSettingsChange={vi.fn()} />,
    );
    expect(screen.getAllByText(/SIMBAD/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/bundled seed/i).length).toBeGreaterThan(0);
  });

  it('shows no catalog-download affordance', () => {
    render(
      <StepCatalogs settings={DEFAULT_CATALOG_SETTINGS} onSettingsChange={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
  });
});
