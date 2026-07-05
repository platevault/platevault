import { forwardRef, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ReactNode, CSSProperties, TableHTMLAttributes, MouseEvent } from 'react';

export interface TableColumn {
  key: string;
  /** Header content. Accepts a plain string or rich nodes (e.g. sortable header buttons). */
  label: ReactNode;
  className?: string;
  style?: CSSProperties;
  cellStyle?: CSSProperties;
  /**
   * ARIA sort state emitted on the `<th>` (NOT on the inner SortHeader button,
   * where it would be invalid). Sortable tables pass
   * `ariaSortFor(active, dir)` from `@/components` so only the active sort
   * column announces its direction.
   */
  ariaSort?: 'ascending' | 'descending' | 'none' | 'other';
}

export type TableRow = {
  [key: string]:
    | ReactNode
    | CSSProperties
    | ((evt: MouseEvent) => void)
    | string
    | undefined;
  /** Optional per-row CSS applied to the <tr> element. Not rendered as a cell. */
  _rowStyle?: CSSProperties;
  /** Optional per-row className applied to the <tr> element. Not rendered as a cell. */
  _rowClassName?: string;
  /** Optional click handler applied to the <tr> element. Not rendered as a cell. */
  _onClick?: (evt: MouseEvent) => void;
  /** Optional `data-testid` applied to the <tr> element. Not rendered as a cell. */
  _testid?: string;
};

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  columns: TableColumn[];
  rows: TableRow[];
  /**
   * Window the rows for large lists using the padding-spacer pattern (a real
   * CSS `<table>` bracketed by two sentinel spacer `<tr>`s). The table is
   * wrapped in its OWN scroll container — give that container a bounded height
   * (e.g. a flex child of a column). Default false (plain table, all rows).
   *
   * When the scroll element has no measurable height (jsdom / first paint) the
   * virtualizer yields zero items and every row renders without spacers, so
   * windowing is a runtime perf optimisation, never a behaviour change.
   */
  virtualized?: boolean;
  /** Estimated row height (px) seeding the virtualizer. Default 36. */
  estimateRowHeight?: number;
  /** className on the scroll wrapper (virtualized mode only). */
  scrollClassName?: string;
  /** `data-testid` on the scroll wrapper (virtualized mode only). */
  scrollTestId?: string;
}

export const Table = forwardRef<HTMLTableElement, TableProps>(
  function Table(
    {
      columns,
      rows,
      className,
      virtualized = false,
      estimateRowHeight = 36,
      scrollClassName,
      scrollTestId,
      ...rest
    },
    ref,
  ) {
    const cls = ['alm-table', className].filter(Boolean).join(' ');

    // The scroll viewport the virtualizer measures against (virtualized mode).
    const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
    const scrollRef = useCallback((node: HTMLDivElement | null) => {
      setScrollEl(node);
    }, []);

    const rowVirtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollEl,
      estimateSize: () => estimateRowHeight,
      overscan: 8,
      enabled: virtualized,
    });

    const renderRow = (row: TableRow, ri: number) => (
      <tr
        key={ri}
        // eslint-disable-next-line no-restricted-syntax -- dynamic: Table row style passthrough from caller (_rowStyle)
        style={row._rowStyle}
        className={row._rowClassName}
        onClick={row._onClick}
        data-testid={row._testid}
      >
        {columns.map((c, ci) => (
          // eslint-disable-next-line no-restricted-syntax -- dynamic: Table cell style passthrough from caller (cellStyle)
          <td key={ci} className={c.className} style={c.cellStyle}>
            {row[c.key] as ReactNode}
          </td>
        ))}
      </tr>
    );

    const head = (
      <thead>
        <tr>
          {columns.map((c, i) => (
            // eslint-disable-next-line no-restricted-syntax -- dynamic: caller-provided column header style passthrough
            <th key={i} className={c.className} style={c.style} aria-sort={c.ariaSort}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
    );

    if (!virtualized) {
      return (
        <table ref={ref} className={cls} {...rest}>
          {head}
          <tbody>{rows.map((row, ri) => renderRow(row, ri))}</tbody>
        </table>
      );
    }

    // ── Virtualized (padding-spacer pattern) ──────────────────────────────────
    const virtualItems = rowVirtualizer.getVirtualItems();
    const windowed = virtualItems.length > 0;
    const totalSize = rowVirtualizer.getTotalSize();
    const paddingBefore = windowed ? virtualItems[0].start : 0;
    const paddingAfter = windowed
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;
    const colCount = columns.length;

    return (
      <div
        ref={scrollRef}
        className={['alm-table__scroll', scrollClassName].filter(Boolean).join(' ')}
        data-testid={scrollTestId}
        data-virtual-scroll="true"
      >
        <table ref={ref} className={cls} {...rest}>
          {head}
          <tbody>
            {windowed ? (
              <>
                {paddingBefore > 0 && (
                  <tr aria-hidden="true" className="alm-table__spacer">
                    {/* eslint-disable-next-line no-restricted-syntax, jsx-a11y/control-has-associated-label -- dynamic: virtualizer before-spacer height; decorative spacer in aria-hidden row, no label needed */}
                    <td colSpan={colCount} style={{ height: `${paddingBefore}px` }} />
                  </tr>
                )}
                {virtualItems.map((vi) => renderRow(rows[vi.index], vi.index))}
                {paddingAfter > 0 && (
                  <tr aria-hidden="true" className="alm-table__spacer">
                    {/* eslint-disable-next-line no-restricted-syntax, jsx-a11y/control-has-associated-label -- dynamic: virtualizer after-spacer height; decorative spacer in aria-hidden row, no label needed */}
                    <td colSpan={colCount} style={{ height: `${paddingAfter}px` }} />
                  </tr>
                )}
              </>
            ) : (
              rows.map((row, ri) => renderRow(row, ri))
            )}
          </tbody>
        </table>
      </div>
    );
  },
);
Table.displayName = 'Table';
