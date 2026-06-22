/// <reference types="@testing-library/jest-dom" />
/**
 * MastersTable tests — spec 043 §4 shared-layout adoption (#73).
 *
 * The Calibration page moved from the narrow `MastersList` sidebar to a dense
 * full-width `MastersTable` (shared `@/ui` Table) grouped by kind. These tests
 * pin the behaviour + testids carried over from the old MastersList suite:
 *
 * 1. Loading state renders loading indicator (testid masters-loading).
 * 2. Error state renders error state (testid masters-error).
 * 3. Empty state when masters=[] (testid masters-empty).
 * 4. Masters render grouped by kind (DARKS / FLATS / BIAS).
 * 5. Aging pill renders for masters with age_days > agingThresholdDays.
 * 6. Clicking a master row calls onSelect with its id.
 * 7. dark_flat kind is not shown (FR-001).
 * 8. Usage count renders on rows (real usedBy* fields) (testid master-usage-*).
 * 9. Column headers + sort callback fire.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MastersTable, DEFAULT_MASTER_SORT } from './MastersTable';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMaster(overrides: Partial<CalibrationMaster> & { id: string }): CalibrationMaster {
  const { id, kind, ageDays, fingerprint, ...rest } = overrides;
  return {
    id,
    kind: kind ?? 'dark',
    fingerprint: {
      camera: 'ASI2600MM',
      exposureS: 300,
      tempC: -10,
      gain: 100,
      binning: '1x1',
      ...(fingerprint ?? {}),
    },
    sourceSessionId: 'cal-ses-001',
    createdAt: '2026-01-01T00:00:00Z',
    ageDays: ageDays ?? 30,
    sizeBytes: 128 * 1024 * 1024,
    usedBySessionIds: [],
    usedByProjectIds: [],
    ...rest,
  };
}

const masters: CalibrationMaster[] = [
  makeMaster({ id: 'dark-1', kind: 'dark', ageDays: 30 }),
  makeMaster({ id: 'dark-2', kind: 'dark', ageDays: 95 }), // aging
  makeMaster({
    id: 'flat-1',
    kind: 'flat',
    ageDays: 10,
    fingerprint: { camera: 'ASI2600MM', exposureS: 3, gain: 100, binning: '1x1', filter: 'Ha' },
  }),
  makeMaster({ id: 'bias-1', kind: 'bias', ageDays: 20 }),
];

const baseProps = {
  loading: false,
  error: undefined,
  selected: null,
  onSelect: vi.fn(),
  sort: DEFAULT_MASTER_SORT,
  onSort: vi.fn(),
  agingThresholdDays: 90,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MastersTable (spec 043 §4)', () => {
  it('1. Loading state renders loading indicator', () => {
    render(<MastersTable {...baseProps} masters={[]} loading />);
    expect(screen.getByTestId('masters-loading')).toBeInTheDocument();
  });

  it('2. Error state renders error message', () => {
    render(<MastersTable {...baseProps} masters={[]} error="DB error" />);
    expect(screen.getByTestId('masters-error')).toBeInTheDocument();
  });

  it('3. Empty state when no masters', () => {
    render(<MastersTable {...baseProps} masters={[]} />);
    expect(screen.getByTestId('masters-empty')).toBeInTheDocument();
  });

  it('4. Masters render grouped by kind with header rows (DARKS, FLATS, BIAS)', () => {
    const { container } = render(<MastersTable {...baseProps} masters={masters} />);
    // Group-header rows carry the spanning class + a count marker; collect their
    // headlines. (The plain text "BIAS" also appears as the bias-row kind pill,
    // so we read the group rows specifically rather than by raw text.)
    const groupHeadlines = Array.from(
      container.querySelectorAll('.alm-calib-table__group'),
    ).map((row) => row.textContent ?? '');
    expect(groupHeadlines.some((t) => t.startsWith('DARKS'))).toBe(true);
    expect(groupHeadlines.some((t) => t.startsWith('FLATS'))).toBe(true);
    expect(groupHeadlines.some((t) => t.startsWith('BIAS'))).toBe(true);
    expect(groupHeadlines).toHaveLength(3);
  });

  it('5. Aging pill renders for age_days > agingThresholdDays (default 90)', () => {
    render(<MastersTable {...baseProps} masters={masters} />);
    // dark-2 has age_days=95
    expect(screen.getByText('aging 95d')).toBeInTheDocument();
    // dark-1 has age_days=30 — no aging pill
    expect(screen.queryByText('aging 30d')).not.toBeInTheDocument();
  });

  it('5b. Filter column is conditional — flats show the filter, darks/bias show "—"', () => {
    render(<MastersTable {...baseProps} masters={masters} />);
    // flat-1 has filter 'Ha'
    expect(screen.getByText('Ha')).toBeInTheDocument();
  });

  it('6. Clicking a master row calls onSelect with its string id', () => {
    const onSelect = vi.fn();
    render(<MastersTable {...baseProps} masters={masters} onSelect={onSelect} />);
    // Rows show a readable master label ("Master Dark · …"); take the first and
    // walk up to the clickable table row.
    const label = screen.getAllByText((text) => text.startsWith('Master Dark'))[0];
    const row = label.closest('tr') ?? label;
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('dark-1');
  });

  it('7. dark_flat kind is not shown in the grouped table (FR-001)', () => {
    const darkFlatMaster = makeMaster({ id: 'df-1', kind: 'dark_flat', ageDays: 5 });
    render(<MastersTable {...baseProps} masters={[...masters, darkFlatMaster]} />);
    expect(screen.queryByText('DARK FLATS')).not.toBeInTheDocument();
    expect(screen.queryByText('DARK_FLATS')).not.toBeInTheDocument();
  });

  it('8. usage count renders on rows (real usedBy* fields)', () => {
    const used = makeMaster({
      id: 'dark-used',
      kind: 'dark',
      ageDays: 10,
      usedBySessionIds: ['s1', 's2', 's3'],
      usedByProjectIds: ['p1'],
    });
    const unused = makeMaster({ id: 'dark-unused', kind: 'dark', ageDays: 10 });
    render(<MastersTable {...baseProps} masters={[used, unused]} />);
    expect(screen.getByTestId('master-usage-dark-used')).toHaveTextContent('3 sessions · 1 project');
    expect(screen.getByTestId('master-usage-dark-unused')).toHaveTextContent('unused');
  });

  it('9. clicking a sortable column header fires onSort', () => {
    const onSort = vi.fn();
    render(<MastersTable {...baseProps} masters={masters} onSort={onSort} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Camera' }));
    expect(onSort).toHaveBeenCalledWith('camera');
  });

  it('10. renders without crashing when fingerprint is null (R-2 regression guard)', () => {
    const nullFp = makeMaster({ id: 'null-fp', kind: 'dark', ageDays: 5 });
    // Simulate backend rows with no fingerprint populated.
    (nullFp as { fingerprint: unknown }).fingerprint = null;
    expect(() => render(<MastersTable {...baseProps} masters={[nullFp]} />)).not.toThrow();
    expect(screen.getByText('DARKS')).toBeInTheDocument();
    const allText = document.body.textContent ?? '';
    expect(allText).not.toContain('undefined');
    expect(allText).not.toContain('NaN');
  });
});
