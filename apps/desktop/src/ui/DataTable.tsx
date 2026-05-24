// NOTE: Requires @tanstack/react-virtual as a dependency for virtual scrolling.
// Install: pnpm add @tanstack/react-virtual

import { useRef, useMemo, useState, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getGroupedRowModel,
  getExpandedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type GroupingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Checkbox } from '@base-ui-components/react/checkbox';
import { clsx } from 'clsx';

export interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[];
  groupBy?: string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  density?: string;
  /** Return extra HTML attributes for a given row (e.g. data-tour anchors). */
  rowProps?: (row: T, index: number) => Record<string, string> | undefined;
}

export function DataTable<T>({
  columns,
  data,
  groupBy,
  onRowClick,
  selectable,
  density,
  rowProps,
}: DataTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [grouping] = useState<GroupingState>(groupBy ? [groupBy] : []);

  const allColumns = useMemo(() => {
    if (!selectable) return columns;
    const selectCol: ColumnDef<T, any> = {
      id: '_select',
      header: ({ table }) => (
        <Checkbox.Root
          className="alm-checkbox"
          checked={table.getIsAllRowsSelected()}
          onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)}
          aria-label="Select all rows"
        >
          <Checkbox.Indicator className="alm-checkbox__indicator">
            &#x2713;
          </Checkbox.Indicator>
        </Checkbox.Root>
      ),
      cell: ({ row }) => (
        <Checkbox.Root
          className="alm-checkbox"
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
          aria-label="Select row"
        >
          <Checkbox.Indicator className="alm-checkbox__indicator">
            &#x2713;
          </Checkbox.Indicator>
        </Checkbox.Root>
      ),
      size: 32,
    };
    return [selectCol, ...columns];
  }, [columns, selectable]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, rowSelection, grouping },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: groupBy ? getGroupedRowModel() : undefined,
    getExpandedRowModel: groupBy ? getExpandedRowModel() : undefined,
    enableRowSelection: selectable,
  });

  const { rows } = table.getRowModel();

  // Read the computed --alm-row-height for the virtualizer estimate.
  // Falls back to 32 if the custom property is not resolvable at mount time.
  const getRowHeight = useCallback((): number => {
    if (!containerRef.current) return 32;
    const raw = getComputedStyle(containerRef.current).getPropertyValue('--alm-row-height');
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 32;
  }, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: getRowHeight,
    overscan: 10,
  });

  const useVirtual = data.length >= 50;

  const [focusedRowIndex, setFocusedRowIndex] = useState(-1);

  // Keyboard navigation: arrow keys to move, Enter to select
  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (rows.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRowIndex((prev) => Math.min(prev + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRowIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusedRowIndex >= 0 && onRowClick) {
        e.preventDefault();
        onRowClick(rows[focusedRowIndex].original);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusedRowIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setFocusedRowIndex(rows.length - 1);
      }
    },
    [rows, focusedRowIndex, onRowClick],
  );

  return (
    <div
      ref={containerRef}
      className={clsx('alm-data-table', density && `density-${density}`)}
      style={{ overflow: 'auto', flex: 1 }}
      role="grid"
      tabIndex={0}
      onKeyDown={handleTableKeyDown}
      aria-label="Data table"
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                  style={{
                    cursor: header.column.getCanSort() ? 'pointer' : 'default',
                    height: 'var(--alm-row-height)',
                    padding: 'var(--alm-cell-padding)',
                    textAlign: 'left',
                    fontSize: 'var(--alm-text-xs)',
                    fontWeight: 600,
                    color: 'var(--alm-text-muted)',
                    borderBottom: '1px solid var(--alm-border)',
                    userSelect: 'none',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--alm-bg)',
                  }}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === 'asc' && ' ↑'}
                  {header.column.getIsSorted() === 'desc' && ' ↓'}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody style={useVirtual ? { height: virtualizer.getTotalSize(), position: 'relative' } : undefined}>
          {(useVirtual ? virtualizer.getVirtualItems() : rows.map((_, i) => ({ index: i, start: 0, size: 32 }))).map(
            (virtualRow) => {
              const row = rows[virtualRow.index];
              const extraProps = rowProps?.(row.original, virtualRow.index);
              const isFocused = virtualRow.index === focusedRowIndex;
              return (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  aria-rowindex={virtualRow.index + 2} /* +2: 1-indexed, row 1 is header */
                  aria-selected={isFocused || undefined}
                  style={{
                    cursor: onRowClick ? 'pointer' : 'default',
                    background: isFocused ? 'var(--alm-gray-100)' : undefined,
                    outline: isFocused ? '2px solid var(--alm-accent)' : undefined,
                    outlineOffset: isFocused ? '-2px' : undefined,
                    ...(useVirtual
                      ? { position: 'absolute', top: virtualRow.start, width: '100%', display: 'table-row' }
                      : {}),
                  }}
                  {...extraProps}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        height: 'var(--alm-row-height)',
                        padding: 'var(--alm-cell-padding)',
                        fontSize: 'var(--alm-text-sm)',
                        borderBottom: '1px solid var(--alm-border)',
                      }}
                    >
                      {cell.getIsGrouped() ? (
                        <button
                          type="button"
                          onClick={row.getToggleExpandedHandler()}
                          style={{ fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          {row.getIsExpanded() ? '▼' : '▶'}{' '}
                          {flexRender(cell.column.columnDef.cell, cell.getContext())} ({row.subRows.length})
                        </button>
                      ) : cell.getIsAggregated() ? (
                        flexRender(cell.column.columnDef.aggregatedCell ?? cell.column.columnDef.cell, cell.getContext())
                      ) : cell.getIsPlaceholder() ? null : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </td>
                  ))}
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
}
