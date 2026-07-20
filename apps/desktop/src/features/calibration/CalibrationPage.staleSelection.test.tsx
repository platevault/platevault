// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * CalibrationPage stale-selection gating (#735 item 1).
 *
 * Page-level WIRING, deliberately not hook logic: `use-stale-selection.test.tsx`
 * feeds the hook explicit booleans, so it structurally cannot catch a page that
 * derives `found` from a query result that is still empty because the list IPC
 * has not resolved yet. On a cold reload that misreads a perfectly valid
 * `?selected=` as stale and rewrites the URL without it, breaking the spec 020
 * SC-002 guarantee that a reload lands on the same selection.
 *
 * Both directions are asserted so the fix cannot regress into a gate that is
 * simply held open forever.
 */

import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CalibrationMaster } from '@/bindings/index';

const mastersState: {
  masters: CalibrationMaster[];
  loading: boolean;
  error: Error | undefined;
} = { masters: [], loading: false, error: undefined };

function makeMaster(id: string): CalibrationMaster {
  return {
    id,
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
  } as CalibrationMaster;
}

vi.mock('./useCalibration', () => ({
  useCalibrationMasters: () => mastersState,
  useCalibrationSettings: () => ({
    prefillSuggestion: false,
    agingThresholdDays: 90,
  }),
}));

// The detail pane pulls the whole calibration matching stack in; the gate under
// test lives on the page, so a stub keeps this focused (and cheap).
vi.mock('./MasterDetail', () => ({
  MasterDetail: () => <div data-testid="master-detail-stub" />,
}));

const mockNavigate = vi.fn();
const mockSelectedId = { current: undefined as string | undefined };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: mockSelectedId.current }),
}));

import { CalibrationPage } from './CalibrationPage';

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectedId.current = undefined;
  mastersState.masters = [];
  mastersState.loading = false;
  mastersState.error = undefined;
});

describe('CalibrationPage stale-selection gating (#735)', () => {
  it('keeps a valid ?selected= while the masters query is still loading', () => {
    mastersState.loading = true;
    mockSelectedId.current = 'master-1';

    render(<CalibrationPage />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('still clears a genuinely absent id once the list has settled', () => {
    mastersState.masters = [makeMaster('master-other')];
    mockSelectedId.current = 'master-gone';

    render(<CalibrationPage />);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true }),
    );
  });
});
