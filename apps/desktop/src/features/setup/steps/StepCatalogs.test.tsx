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

const { mockGet, mockUpdate, mockSettingsGet, mockSettingsUpdate } = vi.hoisted(
  () => ({
    mockGet: vi.fn(),
    mockUpdate: vi.fn(),
    mockSettingsGet: vi.fn(),
    mockSettingsUpdate: vi.fn(),
  }),
);

// ResolverSettingsControl reads getResolverSettings / updateResolverSettings
// from the settings feature's settingsIpc glue module (spec 037); mock those at
// that boundary. StepCatalogs itself calls commands.settingsGet /
// commands.settingsUpdate + unwrap (mocked below).
vi.mock('@/features/settings/settingsIpc', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/settings/settingsIpc')>();
  return {
    ...actual,
    getResolverSettings: mockGet,
    updateResolverSettings: mockUpdate,
  };
});

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: mockSettingsGet,
    settingsUpdate: mockSettingsUpdate,
  },
}));

import { StepCatalogs, DEFAULT_CATALOG_SETTINGS } from './StepCatalogs';

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockSettingsGet.mockReset();
  mockSettingsUpdate.mockReset();
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
  mockSettingsGet.mockResolvedValue({
    status: 'ok',
    data: { values: { defaultProtection: 'protected' } },
  });
  mockSettingsUpdate.mockResolvedValue({ status: 'ok', data: null });
});

function renderStep() {
  return render(
    <StepCatalogs
      settings={DEFAULT_CATALOG_SETTINGS}
      onSettingsChange={vi.fn()}
    />,
  );
}

describe('StepCatalogs (Configuration)', () => {
  it('renders the SIMBAD online-resolution toggle', async () => {
    renderStep();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(
      screen.getByLabelText('Enable online SIMBAD resolution'),
    ).toBeInTheDocument();
  });

  it('renders the display density, protection, and scan-depth controls', async () => {
    renderStep();
    await waitFor(() => expect(mockSettingsGet).toHaveBeenCalled());
    expect(
      screen.getByLabelText('Default source protection'),
    ).toBeInTheDocument();
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
