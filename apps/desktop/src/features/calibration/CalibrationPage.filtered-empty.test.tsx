// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Filtered-empty vs truly-empty on the Calibration masters list (#669), and
 * the first real consumer of `EmptyState.action` (#812).
 *
 * The page filters upstream and hands MastersTable only the survivors, so the
 * table alone cannot tell "library is empty" from "the filter hid everything".
 * These tests pin BOTH branches plus the Clear-filters CTA, since a regression
 * here is silent: the onboarding copy ("run a scan") renders fine, it is just
 * a lie while masters exist.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type {
  CalibrationMaster_Serialize as CalibrationMaster,
  CalibrationKind,
} from '@/bindings/index';

const { mastersState } = vi.hoisted(() => ({
  mastersState: { masters: [] as CalibrationMaster[] },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ selected: undefined }),
}));

vi.mock('./useCalibration', () => ({
  useCalibrationMasters: () => ({
    masters: mastersState.masters,
    loading: false,
    error: undefined,
  }),
  useCalibrationSettings: () => ({
    prefillSuggestion: false,
    agingThresholdDays: 90,
  }),
}));

import { CalibrationPage } from './CalibrationPage';

function makeMaster(id: string, kind: CalibrationKind): CalibrationMaster {
  return {
    id,
    kind,
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
  };
}

function searchFor(query: string) {
  const input = screen.getByLabelText(/search/i);
  fireEvent.change(input, { target: { value: query } });
}

describe('CalibrationPage — filtered-empty vs truly-empty (#669)', () => {
  it('shows the run-a-scan onboarding empty state when the library has no masters', () => {
    mastersState.masters = [];
    render(<CalibrationPage />);
    expect(screen.getByTestId('masters-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('masters-empty-filtered')).toBeNull();
  });

  it('shows a filter-named empty state — never the onboarding copy — when a search miss hides existing masters', () => {
    mastersState.masters = [makeMaster('dark-1', 'dark')];
    render(<CalibrationPage />);
    searchFor('nonexistent-filter-xyz');

    const empty = screen.getByTestId('masters-empty-filtered');
    expect(empty).toHaveTextContent('nonexistent-filter-xyz');
    expect(screen.queryByTestId('masters-empty')).toBeNull();
    // The onboarding call-to-action must not appear while masters exist.
    expect(empty).not.toHaveTextContent(/run a scan/i);
  });

  it('keeps the onboarding empty state when a search misses an EMPTY library', () => {
    mastersState.masters = [];
    render(<CalibrationPage />);
    searchFor('anything');

    expect(screen.getByTestId('masters-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('masters-empty-filtered')).toBeNull();
  });

  it('keeps the onboarding empty state when only never-shown kinds exist (FR-001)', () => {
    // dark_flat is filtered out at the table level, so the filter is not what
    // emptied the list — onboarding copy is the honest message.
    mastersState.masters = [makeMaster('df-1', 'dark_flat')];
    render(<CalibrationPage />);
    searchFor('dark');

    expect(screen.getByTestId('masters-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('masters-empty-filtered')).toBeNull();
  });

  it('#812: the filtered empty state offers a Clear filters action that restores the list', () => {
    mastersState.masters = [makeMaster('dark-1', 'dark')];
    render(<CalibrationPage />);
    searchFor('nonexistent-filter-xyz');

    const clear = screen.getByRole('button', { name: /clear filters/i });
    fireEvent.click(clear);

    expect(screen.queryByTestId('masters-empty-filtered')).toBeNull();
    expect(screen.getByTestId('master-usage-dark-1')).toBeInTheDocument();
  });
});
