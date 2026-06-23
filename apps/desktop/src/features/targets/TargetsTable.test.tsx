/// <reference types="@testing-library/jest-dom" />
/**
 * TargetsTable tests — virtualized planner table + planning columns
 * (tasks #84/#85, spec-043 redesign, spec 044 mock columns).
 *
 * Under jsdom there is no layout, so the virtualizer reports zero height and the
 * table falls back to rendering every row (the page/tests rely on all rows being
 * present; windowing is a runtime-only perf optimization). These tests assert:
 *  - the planning columns replaced Constellation/Magnitude (Max alt · Tonight
 *    sparkline · Visible · Sessions kept; Designation + Type kept);
 *  - spec 044 mock columns present: Lunar dist, Filters, Imaging time;
 *  - rows render inside a real <table> with group headers preserved;
 *  - selecting a row fires onSelect;
 *  - sort headers call onSort for all sortable columns;
 *  - usableAltDeg prop changes affect visible-tonight text;
 *  - filter badges render broadband and/or narrowband bands.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { TargetListItem } from '@/api/commands';
import { TargetsTable, DEFAULT_TARGET_SORT } from './TargetsTable';

function item(primaryDesignation: string, objectType = 'other'): TargetListItem {
  return {
    id: primaryDesignation,
    effectiveLabel: primaryDesignation,
    primaryDesignation,
    objectType,
    raDeg: 0,
    decDeg: 0,
    aliases: [],
  };
}

const TARGETS: TargetListItem[] = [
  item('NGC 7000', 'emission_nebula'),
  item('M 31', 'galaxy'),
];

function renderTable(overrides: Partial<React.ComponentProps<typeof TargetsTable>> = {}) {
  const onSelect = vi.fn();
  const onSort = vi.fn();
  render(
    <TargetsTable
      targets={TARGETS}
      selected={null}
      onSelect={onSelect}
      sort={DEFAULT_TARGET_SORT}
      onSort={onSort}
      {...overrides}
    />,
  );
  return { onSelect, onSort };
}

describe('TargetsTable (#84/#85)', () => {
  it('renders the planning columns and drops Constellation/Magnitude', () => {
    renderTable();
    expect(screen.getByText('Max alt')).toBeInTheDocument();
    expect(screen.getByText('Tonight')).toBeInTheDocument();
    expect(screen.getByText('Visible')).toBeInTheDocument();
    // Opposition column: MOCK placeholder until backend ephemeris (#58) lands.
    expect(screen.getByText('Opposition')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Designation')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.queryByText('Constellation')).not.toBeInTheDocument();
    expect(screen.queryByText('Magnitude')).not.toBeInTheDocument();
  });

  it('renders the spec 044 mock columns: Lunar dist, Filters, Imaging time', () => {
    renderTable();
    // task #5: headers abbreviated to fit widened columns ("Lunar" and "Img time").
    expect(screen.getByText('Lunar')).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Img time')).toBeInTheDocument();
  });

  it('renders rows inside a real <table> with group headers', () => {
    renderTable();
    const table = screen.getByRole('table');
    expect(within(table).getByText('NGC 7000')).toBeInTheDocument();
    expect(within(table).getByText('M 31')).toBeInTheDocument();
    // Default group-by is catalogue → Messier + NGC group headers with counts.
    expect(within(table).getByText('Messier')).toBeInTheDocument();
    expect(within(table).getByText('NGC')).toBeInTheDocument();
  });

  it('renders a max-altitude value and a sparkline per target row', () => {
    renderTable();
    // Degree-suffixed max altitude appears (rounded integer + °) — may also
    // match lunar distance values so just confirm at least 2 are present.
    expect(screen.getAllByText(/^\d+°$/).length).toBeGreaterThanOrEqual(2);
    // One sparkline SVG per target row (role=img with an accessible label).
    expect(screen.getByLabelText('Altitude tonight for NGC 7000')).toBeInTheDocument();
    expect(screen.getByLabelText('Altitude tonight for M 31')).toBeInTheDocument();
  });

  it('renders filter badges with band labels', () => {
    renderTable();
    // Each row has at least one filter badge (Ha is always recommended in the
    // mock since MOCK_MOON_PHASE_FRAC = 0.55, above the bright-moon threshold).
    expect(screen.getAllByLabelText('Ha').length).toBeGreaterThanOrEqual(1);
  });

  it('fires onSelect when a target row is clicked', () => {
    const { onSelect } = renderTable();
    const cell = screen.getByText('NGC 7000');
    fireEvent.click(cell.closest('tr') as HTMLTableRowElement);
    expect(onSelect).toHaveBeenCalledWith('NGC 7000');
  });

  it('fires onSort when a sortable header is clicked', () => {
    const { onSort } = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Type' }));
    expect(onSort).toHaveBeenCalledWith('type');
  });

  it('fires onSort for all spec 044 sortable columns', () => {
    const { onSort } = renderTable();
    // task #5: aria-labels use the abbreviated header text.
    const sortCases: [string, string][] = [
      ['Sort by Max alt', 'maxAlt'],
      ['Sort by Visible', 'visible'],
      ['Sort by Lunar', 'lunarDist'],
      ['Sort by Img time', 'imagingTime'],
    ];
    for (const [label, col] of sortCases) {
      onSort.mockClear();
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(onSort).toHaveBeenCalledWith(col);
    }
  });

  it('reflects usableAltDeg in visible-tonight tooltip text', () => {
    // Force a target that we know is visible at 30° but possibly not at 89°.
    // We just verify that the threshold value appears in the tooltip text.
    renderTable({ usableAltDeg: 42 });
    // At least one tooltip should reference the custom threshold.
    const spans = document.querySelectorAll('[title*="42°"]');
    expect(spans.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the empty message when there are no targets and not loading', () => {
    renderTable({ targets: [], emptyMessage: 'Nothing here.' });
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('shows the loading footer while loading', () => {
    renderTable({ loading: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
