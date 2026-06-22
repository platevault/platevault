/// <reference types="@testing-library/jest-dom" />
/**
 * TargetsTable tests — virtualized planner table + planning columns
 * (tasks #84/#85, spec-043 redesign).
 *
 * Under jsdom there is no layout, so the virtualizer reports zero height and the
 * table falls back to rendering every row (the page/tests rely on all rows being
 * present; windowing is a runtime-only perf optimization). These tests assert:
 *  - the planning columns replaced Constellation/Magnitude (Max alt · Tonight
 *    sparkline · Visible · Sessions kept; Designation + Type kept);
 *  - rows render inside a real <table> with group headers preserved;
 *  - selecting a row fires onSelect;
 *  - sort headers call onSort.
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
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Designation')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.queryByText('Constellation')).not.toBeInTheDocument();
    expect(screen.queryByText('Magnitude')).not.toBeInTheDocument();
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
    // Degree-suffixed max altitude appears (rounded integer + °).
    expect(screen.getAllByText(/^\d+°$/).length).toBeGreaterThanOrEqual(2);
    // One sparkline SVG per target row (role=img with an accessible label).
    expect(screen.getByLabelText('Altitude tonight for NGC 7000')).toBeInTheDocument();
    expect(screen.getByLabelText('Altitude tonight for M 31')).toBeInTheDocument();
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

  it('shows the empty message when there are no targets and not loading', () => {
    renderTable({ targets: [], emptyMessage: 'Nothing here.' });
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('shows the loading footer while loading', () => {
    renderTable({ loading: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
