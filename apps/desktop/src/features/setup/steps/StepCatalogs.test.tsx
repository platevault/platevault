// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * StepCatalogs tests — first-run "Configuration" step.
 *
 * The step no longer downloads catalogs (spec-014 backend removed). It is now a
 * small Configuration screen: SIMBAD online-resolution toggle, display density,
 * and default source protection.
 */

import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
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
  localStorage.clear();
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
    // findBy: the toggle comes from ResolverSettingsControl (compact), which
    // renders a label-less <Skeleton> until `loaded` flips in a .finally()
    // after mockGet resolves — the waitFor above only proves the call (#1083).
    expect(
      await screen.findByLabelText('Enable online SIMBAD resolution'),
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

  it('shows no catalog-download affordance', () => {
    renderStep();
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
  });
});

describe('DefaultProtectionControl mount-read vs user-edit race', () => {
  it('does not let the in-flight mount read clobber a choice made while it was pending', async () => {
    // Hold the mount `settingsGet` open so the user can act while it is still
    // in flight — the same defect fixed in LogPanelContext and Settings >
    // Cleanup. The stale read must not overwrite the newer pick.
    let resolveGet!: (v: unknown) => void;
    mockSettingsGet.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    renderStep();

    const select = screen.getByLabelText(
      'Default source protection',
    ) as HTMLSelectElement;
    expect(select.value).toBe('protected');

    // User picks 'unprotected' before the read resolves. This also persists,
    // so a clobber would leave the UI disagreeing with the settings DB.
    fireEvent.change(select, { target: { value: 'unprotected' } });
    expect(select.value).toBe('unprotected');
    expect(mockSettingsUpdate).toHaveBeenCalledWith('cleanup', {
      defaultProtection: 'unprotected',
    });

    // The stale read now lands, carrying the pre-edit value.
    await act(async () => {
      resolveGet({
        status: 'ok',
        data: { values: { defaultProtection: 'protected' } },
      });
    });

    // Assert directly, NOT via waitFor: waitFor would succeed on its first
    // check before a clobber landed and would pass with the fix removed.
    expect(select.value).toBe('unprotected');
  });
});
