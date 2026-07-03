/**
 * Vitest unit tests for CalibrationMatching (spec 007 / spec 043 P8).
 *
 * Covers the Offset "match required" toggle persistence path — the gap this
 * package closes (previously tagged STUB-OFFSET-REQUIRED: local-state-only,
 * no backend field). Mocks the generated bindings surface so the real
 * settingsIpc wrappers (calibrationTolerancesGet/Update) run and unwrap the
 * Result envelope, mirroring SourceProtectionOverride.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { CalibrationMatching } from './CalibrationMatching';
import type { CalibrationTolerances } from './settingsIpc';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockGet, mockUpdate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    calibrationTolerancesGet: mockGet,
    calibrationTolerancesUpdate: mockUpdate,
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTolerances(overrides: Partial<CalibrationTolerances> = {}): CalibrationTolerances {
  return {
    temperatureToleranceC: 5,
    exposureToleranceS: 2,
    agingLimitDays: 365,
    requireSameCamera: true,
    requireSameGain: true,
    requireSameBinning: true,
    requireSameOffset: true,
    ...overrides,
  };
}

/** The Offset row's toggle checkbox — table rows have no per-toggle aria-label,
 *  so scope the query to the row containing the "Offset" field label. */
function offsetToggleInput(): HTMLElement {
  const row = screen.getByText('Offset').closest('tr');
  if (!row) throw new Error('Offset row not found');
  return within(row).getByRole('checkbox');
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CalibrationMatching — offset match-required persistence', () => {
  it('loads requireSameOffset from the backend on mount', async () => {
    mockGet.mockResolvedValue({ status: 'ok', data: makeTolerances({ requireSameOffset: false }) });
    render(<CalibrationMatching save={vi.fn()} />);

    await waitFor(() => {
      expect(offsetToggleInput()).not.toBeChecked();
    });
  });

  it('persists the offset toggle via calibration.tolerances.update, not just local state', async () => {
    mockGet.mockResolvedValue({ status: 'ok', data: makeTolerances({ requireSameOffset: true }) });
    mockUpdate.mockResolvedValue({ status: 'ok', data: makeTolerances({ requireSameOffset: false }) });

    render(<CalibrationMatching save={vi.fn()} />);
    await waitFor(() => expect(offsetToggleInput()).toBeChecked());

    fireEvent.click(offsetToggleInput());

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ requireSameOffset: false }));
    });
    expect(offsetToggleInput()).not.toBeChecked();
  });

  it('does not persist sibling fields as a side effect of toggling offset', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeTolerances({ requireSameCamera: false, requireSameOffset: true }),
    });
    mockUpdate.mockResolvedValue({ status: 'ok', data: makeTolerances() });

    render(<CalibrationMatching save={vi.fn()} />);
    await waitFor(() => expect(offsetToggleInput()).toBeChecked());

    fireEvent.click(offsetToggleInput());

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    // The persisted patch carries the *current* (unrelated) requireSameCamera
    // state through unchanged — this pane always sends the full DTO.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ requireSameCamera: false, requireSameOffset: false }),
    );
  });

  it('restore-defaults resets requireSameOffset to true and persists it', async () => {
    mockGet.mockResolvedValue({ status: 'ok', data: makeTolerances({ requireSameOffset: false }) });
    mockUpdate.mockResolvedValue({ status: 'ok', data: makeTolerances({ requireSameOffset: true }) });

    render(<CalibrationMatching save={vi.fn()} />);
    await waitFor(() => expect(offsetToggleInput()).not.toBeChecked());

    fireEvent.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ requireSameOffset: true }));
    });
  });

  it('falls back to the in-code default (true) when the backend is unavailable', async () => {
    mockGet.mockRejectedValue('network error');
    render(<CalibrationMatching save={vi.fn()} />);

    // No assertion to wait on for a rejected get; flush microtasks instead.
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    expect(offsetToggleInput()).toBeChecked();
  });
});
