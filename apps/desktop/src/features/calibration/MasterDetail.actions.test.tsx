// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * MasterDetail — header action buttons (#642).
 *
 * "Use in project" / "Replace master" / Reveal previously rendered as live
 * primary buttons with `onClick: undefined` — dead controls. They must now be
 * disabled (with an explanatory title) rather than silently do nothing.
 */

import {
  render as rtlRender,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MasterDetail } from './MasterDetail';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';

// MasterDetail is now backed by TanStack Query (useCalibration.ts) — every
// render needs a QueryClientProvider ancestor.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

vi.mock('@/bindings/index', () => ({
  commands: {
    calibrationMastersGet: vi.fn().mockResolvedValue({
      status: 'ok',
      data: { usedBySessionIds: [], compatibleSessions: [] },
    }),
    sessionsList: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
    inventoryList: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        sources: [
          {
            id: 'root-1',
            path: '/data/lib',
            kind: 'local',
            state: 'active',
            sessions: [],
          },
        ],
      },
    }),
    nativeReveal: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
  },
}));

function makeMaster(
  overrides: Partial<CalibrationMaster> = {},
): CalibrationMaster {
  return {
    id: 'm-1',
    kind: 'dark',
    fingerprint: {
      camera: 'ASI2600MM',
      exposureS: 300,
      tempC: -10,
      gain: 100,
      binning: '1x1',
    },
    sourceSessionId: 'cal-ses-001',
    createdAt: '2026-01-01T00:00:00Z',
    ageDays: 30,
    sizeBytes: 128 * 1024 * 1024,
    usedBySessionIds: [],
    usedByProjectIds: [],
    ...overrides,
  };
}

describe('MasterDetail — header action buttons (#642)', () => {
  it('renders "Use in project" disabled with an explanatory title', () => {
    render(
      <MasterDetail
        master={makeMaster()}
        prefillSuggestion={false}
        agingThresholdDays={90}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Use in project' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title');
  });

  it('renders Reveal disabled with an explanatory title', () => {
    render(
      <MasterDetail
        master={makeMaster()}
        prefillSuggestion={false}
        agingThresholdDays={90}
      />,
    );
    const btn = screen.getByTestId('calibration-reveal-btn');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title');
  });

  it('renders "Replace master" disabled with an explanatory title when aging', () => {
    render(
      <MasterDetail
        master={makeMaster({ ageDays: 400 })}
        prefillSuggestion={false}
        agingThresholdDays={90}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Replace master' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title');
  });

  it('enables Reveal and calls nativeReveal once the master resolves to a file on an actionable root (#642)', async () => {
    const { commands } = await import('@/bindings/index');
    render(
      <MasterDetail
        master={makeMaster({
          rootId: 'root-1',
          relativePath: 'masters/masterDark_300s.xisf',
        })}
        prefillSuggestion={false}
        agingThresholdDays={90}
      />,
    );
    const btn = await screen.findByTestId('calibration-reveal-btn');
    await waitFor(() => expect(btn).not.toBeDisabled());

    fireEvent.click(btn);

    await waitFor(() =>
      expect(commands.nativeReveal).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/data/lib/masters/masterDark_300s.xisf',
        }),
      ),
    );
  });

  it('renders Reveal disabled when the master has no resolved frame path', () => {
    render(
      <MasterDetail
        master={makeMaster({ rootId: null, relativePath: null })}
        prefillSuggestion={false}
        agingThresholdDays={90}
      />,
    );
    const btn = screen.getByTestId('calibration-reveal-btn');
    expect(btn).toBeDisabled();
  });
});
