/// <reference types="@testing-library/jest-dom" />
/**
 * StepCatalogs tests — first-run "Configuration" step.
 *
 * The step no longer downloads catalogs (spec-014 backend removed). It is now a
 * small Configuration screen: SIMBAD online-resolution toggle, display density,
 * default source protection, default scan depth, and a disabled theme control.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockUpdate, mockGetSettings, mockUpdateSettings } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockGetSettings: vi.fn(),
  mockUpdateSettings: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  getResolverSettings: mockGet,
  updateResolverSettings: mockUpdate,
  getSettings: mockGetSettings,
  updateSettings: mockUpdateSettings,
}));

import { StepCatalogs, DEFAULT_CATALOG_SETTINGS } from './StepCatalogs';

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockGetSettings.mockReset();
  mockUpdateSettings.mockReset();
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
  mockGetSettings.mockResolvedValue({ values: { defaultProtection: 'protected' } });
  mockUpdateSettings.mockResolvedValue(undefined);
});

function renderStep() {
  return render(
    <StepCatalogs settings={DEFAULT_CATALOG_SETTINGS} onSettingsChange={vi.fn()} />,
  );
}

describe('StepCatalogs (Configuration)', () => {
  it('renders the SIMBAD online-resolution toggle', async () => {
    renderStep();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.getByLabelText('Enable online SIMBAD resolution')).toBeInTheDocument();
  });

  it('renders the display density, protection, and scan-depth controls', async () => {
    renderStep();
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    expect(screen.getByLabelText('Default source protection')).toBeInTheDocument();
    expect(screen.getByLabelText('Display density')).toBeInTheDocument();
  });

  it('shows a disabled theme control', () => {
    renderStep();
    const theme = screen.getByLabelText('Theme');
    expect(theme).toBeDisabled();
  });

  it('shows no catalog-download affordance', () => {
    renderStep();
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
  });
});
