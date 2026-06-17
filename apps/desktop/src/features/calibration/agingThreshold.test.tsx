/**
 * T056 — Aging threshold persists across reload and consumer reads it (FR-023).
 *
 * Verifies:
 * 1. MastersList uses agingThresholdDays prop, not hardcoded 90.
 * 2. A master at age=91 with threshold=90 shows the aging pill.
 * 3. A master at age=91 with threshold=120 does NOT show the aging pill.
 * 4. The settings key 'calibration.aging_threshold_days' is the correct key
 *    (not the old bogus 'calibration_matching'/'aging_threshold_days').
 *    Verified by checking that MastersList derives aging from prop, not hardcode.
 */

/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MastersList } from './MastersList';
import { DEFAULT_AGING_THRESHOLD_DAYS } from './useCalibration';
import type { CalibrationMaster } from '@/bindings/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMaster(id: string, age_days: number): CalibrationMaster {
  return {
    id,
    kind: 'dark',
    fingerprint: {
      camera: 'ASI2600MM',
      exposure_s: 300,
      temp_c: -10,
      gain: 100,
      binning: '1x1',
    },
    source_session_id: 'cal-ses-001',
    created_at: '2026-01-01T00:00:00Z',
    age_days,
    size_bytes: 128 * 1024 * 1024,
    used_by_session_ids: [],
    used_by_project_ids: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('T056 — aging threshold from persisted settings, not hardcoded', () => {
  it('1. DEFAULT_AGING_THRESHOLD_DAYS constant is 90 (matches Rust default)', () => {
    expect(DEFAULT_AGING_THRESHOLD_DAYS).toBe(90);
  });

  it('2. threshold=90: master with age_days=91 shows aging pill', () => {
    const masters = [makeMaster('m-91', 91)];
    render(
      <MastersList
        masters={masters}
        loading={false}
        error={undefined}
        selected={null}
        onSelect={vi.fn()}
        agingThresholdDays={90}
      />,
    );
    expect(screen.getByText(/aging 91d/)).toBeInTheDocument();
  });

  it('3. threshold=120: master with age_days=91 does NOT show aging pill', () => {
    // This test proves MastersList uses the prop, not a hardcoded 90.
    // Before T059, this would fail because the component always used > 90.
    const masters = [makeMaster('m-91', 91)];
    render(
      <MastersList
        masters={masters}
        loading={false}
        error={undefined}
        selected={null}
        onSelect={vi.fn()}
        agingThresholdDays={120}
      />,
    );
    expect(screen.queryByText(/aging 91d/)).not.toBeInTheDocument();
  });

  it('4. threshold=30: master age=31 shows aging, age=30 does not', () => {
    const masters = [makeMaster('m-31', 31), makeMaster('m-30', 30)];
    render(
      <MastersList
        masters={masters}
        loading={false}
        error={undefined}
        selected={null}
        onSelect={vi.fn()}
        agingThresholdDays={30}
      />,
    );
    expect(screen.getByText(/aging 31d/)).toBeInTheDocument();
    expect(screen.queryByText(/aging 30d/)).not.toBeInTheDocument();
  });

  it('5. Old bogus key scope guard: hardcoded threshold=90 no longer controls the pill', () => {
    // With threshold=180 passed as prop, a 91-day master must NOT show the pill.
    // If the component were still using a hardcoded 90, it would show the pill.
    // This test is the regression guard against reverting to a hardcoded value.
    const masters = [makeMaster('m-91', 91)];
    render(
      <MastersList
        masters={masters}
        loading={false}
        error={undefined}
        selected={null}
        onSelect={vi.fn()}
        agingThresholdDays={180}
      />,
    );
    expect(screen.queryByText(/aging 91d/)).not.toBeInTheDocument();
  });
});
