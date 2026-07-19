// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * MasterDetail — missing-value semantics (spec-030 Q16 / #620, #619, T132/T134).
 *
 * Fingerprint rows are always present (never conditionally omitted by
 * truthiness — that collapsed "missing" into "not-applicable"); applicability
 * is read from the master-kind field-applicability matrix, not inferred from
 * value absence.
 */

import { render as rtlRender, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MasterDetail } from './MasterDetail';
import { commands } from '@/bindings/index';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';

// MasterDetail is now backed by TanStack Query (useCalibration.ts) — every
// render needs a QueryClientProvider ancestor.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    ),
  });
}

const MASTER_ID = 'aaaaaaaa-0000-0000-0000-000000000002';

vi.mock('@/bindings/index', () => ({
  commands: {
    calibrationMastersGet: vi.fn(),
    sessionsList: vi.fn(),
    calibrationMatchSuggest: vi.fn(),
    calibrationMatchAssign: vi.fn(),
  },
}));

function makeMaster(
  overrides: Partial<CalibrationMaster> = {},
): CalibrationMaster {
  return {
    id: MASTER_ID,
    kind: 'bias',
    fingerprint: {
      camera: 'ASI2600MM',
      gain: 100,
      binning: '1x1',
      sensorMode: 'HCG',
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

beforeEach(() => {
  vi.mocked(commands.calibrationMastersGet).mockResolvedValue({
    status: 'ok',
    data: { usedBySessionIds: [], compatibleSessions: [] },
  } as never);
  vi.mocked(commands.sessionsList).mockResolvedValue({
    status: 'ok',
    data: [],
  } as never);
  vi.mocked(commands.calibrationMatchSuggest).mockResolvedValue({
    status: 'ok',
    data: undefined,
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MasterDetail — missing-value semantics (Q16 / #620)', () => {
  it('bias master: filter/exposure/set-temp rows render blank (not-applicable), never the unresolved chip', () => {
    render(
      <MasterDetail
        master={makeMaster()}
        prefillSuggestion={false}
        agingThresholdDays={365}
      />,
    );
    // "Filter" row is not-applicable for bias — no unresolved chip anywhere
    // for the not-applicable dimensions, but the row for a real field like
    // gain/camera still renders normally.
    expect(screen.getByText('100')).toBeInTheDocument(); // gain, real value
    expect(screen.queryAllByTestId('unresolved-chip')).toHaveLength(0);
  });

  it('dark master missing gain: gain row renders the unresolved chip, never "0"', () => {
    render(
      <MasterDetail
        master={makeMaster({
          kind: 'dark',
          fingerprint: {
            camera: 'ASI2600MM',
            exposureS: 300,
            binning: '1x1',
            gain: null,
          },
        })}
        prefillSuggestion={false}
        agingThresholdDays={365}
      />,
    );
    const chips = screen.getAllByTestId('unresolved-chip');
    expect(chips.length).toBeGreaterThan(0);
    // A defaulted zero must never appear as the visible gain value.
    const gainRow = screen.getByText('Gain').closest('[role="row"]');
    expect(gainRow).not.toBeNull();
    expect(within(gainRow as HTMLElement).queryByText('0')).toBeNull();
  });
});
