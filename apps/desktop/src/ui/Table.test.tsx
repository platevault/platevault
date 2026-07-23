// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Table row a11y tests (handoff 02): keyboard-operable clickable rows —
 * roving Arrow Up/Down (pre-existing), Home/End jump-to-edge, and row/
 * aria-selected semantics. Sessions/Projects/Masters/Archive/Targets tables
 * all render through this component, so this is the single coverage point.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Table, type TableColumn, type TableRow } from './Table';

const COLUMNS: TableColumn[] = [{ key: 'name', label: 'Name' }];

function rows(onClick: (id: string) => void, selected?: string): TableRow[] {
  return ['a', 'b', 'c'].map((id) => ({
    name: id.toUpperCase(),
    _onClick: () => onClick(id),
    _selected: id === selected,
    _testid: `row-${id}`,
  }));
}

describe('Table clickable rows (handoff 02)', () => {
  it('exposes native row semantics with aria-selected on the selected row', () => {
    render(<Table columns={COLUMNS} rows={rows(vi.fn(), 'b')} />);
    const rowEls = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rowEls).toHaveLength(3);
    expect(rowEls[0]).toHaveAttribute('aria-selected', 'false');
    expect(rowEls[1]).toHaveAttribute('aria-selected', 'true');
    expect(rowEls[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('is keyboard-focusable and activates on Enter/Space', () => {
    const onClick = vi.fn();
    render(<Table columns={COLUMNS} rows={rows(onClick)} />);
    const rowA = screen.getByTestId('row-a');
    expect(rowA).toHaveAttribute('tabIndex', '0');
    fireEvent.keyDown(rowA, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith('a');
    fireEvent.keyDown(rowA, { key: ' ' });
    expect(onClick).toHaveBeenCalledWith('a');
  });

  it('ArrowDown/ArrowUp move focus between rows (pre-existing roving nav)', () => {
    render(<Table columns={COLUMNS} rows={rows(vi.fn())} />);
    const rowA = screen.getByTestId('row-a');
    const rowB = screen.getByTestId('row-b');
    rowA.focus();
    fireEvent.keyDown(rowA, { key: 'ArrowDown' });
    expect(rowB).toHaveFocus();
    fireEvent.keyDown(rowB, { key: 'ArrowUp' });
    expect(rowA).toHaveFocus();
  });

  it('End moves focus to the last row, Home back to the first', () => {
    render(<Table columns={COLUMNS} rows={rows(vi.fn())} />);
    const rowA = screen.getByTestId('row-a');
    const rowC = screen.getByTestId('row-c');
    rowA.focus();
    fireEvent.keyDown(rowA, { key: 'End' });
    expect(rowC).toHaveFocus();
    fireEvent.keyDown(rowC, { key: 'Home' });
    expect(rowA).toHaveFocus();
  });

  it('Home/End on a middle row jump straight to the edges', () => {
    render(<Table columns={COLUMNS} rows={rows(vi.fn())} />);
    const rowB = screen.getByTestId('row-b');
    const rowA = screen.getByTestId('row-a');
    const rowC = screen.getByTestId('row-c');
    rowB.focus();
    fireEvent.keyDown(rowB, { key: 'End' });
    expect(rowC).toHaveFocus();
    rowB.focus();
    fireEvent.keyDown(rowB, { key: 'Home' });
    expect(rowA).toHaveFocus();
  });
});
