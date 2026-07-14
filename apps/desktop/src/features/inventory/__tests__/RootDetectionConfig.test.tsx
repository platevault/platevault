// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * RootDetectionConfig tests (spec 048 US4 T034-T036 frontend).
 *
 * `inventory.root_config.{get,set}` had a real, tested backend but no UI
 * surface at all before this component. Verifies:
 * 1. Collapsed by default — no query hooks fire until expanded (a root list
 *    page must not require a QueryClientProvider merely because this control
 *    exists somewhere on the page).
 * 2. Expanding loads and renders the documented defaults.
 * 3. Changing the reconcile mode / a detection toggle calls
 *    `inventory.root_config.set` with a partial patch.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RootInventoryConfig } from '@/bindings/index';

const { mockSetMutate, configState } = vi.hoisted(() => ({
  mockSetMutate: vi.fn(),
  configState: {
    data: undefined as RootInventoryConfig | undefined,
    isLoading: false,
    error: undefined as Error | undefined,
  },
}));

vi.mock('../store', () => ({
  useRootConfig: (rootId: string | null) =>
    rootId == null
      ? { data: undefined, isLoading: false, error: undefined }
      : { ...configState },
  useSetRootConfig: () => ({
    mutate: mockSetMutate,
    isError: false,
    error: undefined,
  }),
}));

import { RootDetectionConfig } from '../RootDetectionConfig';

function config(
  overrides: Partial<RootInventoryConfig> = {},
): RootInventoryConfig {
  return {
    reconcileMode: 'flag_missing',
    detection: {
      live: true,
      scheduled: false,
      onOpen: false,
      followSymlinks: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  configState.data = undefined;
  configState.isLoading = false;
  configState.error = undefined;
});

describe('RootDetectionConfig (spec 048 US4)', () => {
  it('renders collapsed by default (no query fires until expanded)', () => {
    render(<RootDetectionConfig rootId="root-1" />);
    expect(
      screen.getByTestId('root-detection-toggle-root-1'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('root-detection-root-1'),
    ).not.toBeInTheDocument();
  });

  it('expanding loads and renders the documented defaults', () => {
    configState.data = config();
    render(<RootDetectionConfig rootId="root-1" />);

    fireEvent.click(screen.getByTestId('root-detection-toggle-root-1'));
    expect(screen.getByTestId('root-detection-root-1')).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Reconcile mode' }),
    ).toHaveValue('flag_missing');
  });

  it('changing reconcile mode calls inventory.root_config.set', () => {
    configState.data = config();
    render(<RootDetectionConfig rootId="root-1" />);
    fireEvent.click(screen.getByTestId('root-detection-toggle-root-1'));

    fireEvent.change(screen.getByRole('combobox', { name: 'Reconcile mode' }), {
      target: { value: 'auto_reconcile' },
    });
    expect(mockSetMutate).toHaveBeenCalledWith({
      reconcileMode: 'auto_reconcile',
    });
  });

  it('toggling a detection trigger calls inventory.root_config.set with a partial patch', () => {
    configState.data = config();
    render(<RootDetectionConfig rootId="root-1" />);
    fireEvent.click(screen.getByTestId('root-detection-toggle-root-1'));

    fireEvent.click(
      screen.getByRole('checkbox', { name: /Live filesystem watch/i }),
    );
    expect(mockSetMutate).toHaveBeenCalledWith({
      detection: {
        live: false,
        scheduled: null,
        onOpen: null,
        followSymlinks: null,
      },
    });
  });
});
