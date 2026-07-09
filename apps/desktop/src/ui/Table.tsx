import { forwardRef, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  ReactNode,
  CSSProperties,
  TableHTMLAttributes,
  MouseEvent,
  KeyboardEvent,
} from 'react';

/** Base left padding (px) + per-depth step for indented (grouped) table rows. */
const INDENT_BASE = 8;
const INDENT_STEP = 12;

/**
 * Left indent (px) for a grouped row at `depth`. Shared by every list-page
 * table so the depth→padding mapping lives in one place; pass the result as a
 * row's `_indent`.
 */
export function tableIndent(depth: number): number {
  return INDENT_BASE + depth * INDENT_STEP;
}

/**
 * Move keyboard focus to the adjacent focusable (selectable) row, skipping
 * spacer rows and non-clickable rows. Wired to Arrow Up/Down on clickable rows.
 */
function focusAdjacentRow(current: HTMLTableRowElement, dir: 1 | -1) {
  const scope = current.closest('tbody') ?? current.parentElement;
  if (!scope) return;
  const clickable = Array.from(
    scope.querySelectorAll<HTMLTableRowElement>('tr[data-row-clickable="true"]'),
  );
  const idx = clickable.indexOf(current);
  clickable[idx + dir]?.focus();
}

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
  /**
   * Optional activation handler for the row. When set, the row becomes a
   * keyboard-operable option: focusable (`tabIndex=0`), activated by
   * Enter/Space, and navigable with Arrow Up/Down. Named `_onClick` for
   * backward compatibility; it also fires on keyboard activation.
   */
  _onClick?: (evt: MouseEvent) => void;
  /**
   * Selection state for a clickable row. When provided, emitted as
   * `aria-selected` on the `<tr>`. Omit for clickable rows that navigate
   * rather than select.
   */
  _selected?: boolean;
  /**
   * Left indent (px) for a grouped/nested row, applied to the first cell's
   * content via a CSS variable. Use `tableIndent(depth)` to compute it.
   */
  _indent?: number;
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

    const renderRow = (row: TableRow, ri: number) => {
      const onClick = row._onClick;
      const clickable = typeof onClick === 'function';
      const style: CSSProperties | undefined =
        row._indent != null
          ? // The custom property carries the per-row indent; consumed by the
            // `.alm-table__row--indented` rule (primitives.css).
            { ...row._rowStyle, ['--alm-row-indent' as string]: `${row._indent}px` }
          : row._rowStyle;
      const className =
        [
          row._rowClassName,
          clickable ? 'alm-table__row--clickable' : null,
          row._indent != null ? 'alm-table__row--indented' : null,
        ]
          .filter(Boolean)
          .join(' ') || undefined;
      return (
        <tr
          key={ri}
          // eslint-disable-next-line no-restricted-syntax -- dynamic: Table row style passthrough (_rowStyle) + per-row indent CSS var
          style={style}
          className={className}
          onClick={onClick}
          onKeyDown={
            clickable
              ? (e: KeyboardEvent<HTMLTableRowElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick(e as unknown as MouseEvent);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    focusAdjacentRow(e.currentTarget, 1);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    focusAdjacentRow(e.currentTarget, -1);
                  }
                }
              : undefined
          }
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- selectable row: focusable only when it carries an activation handler
          tabIndex={clickable ? 0 : undefined}
          aria-selected={row._selected}
          data-row-clickable={clickable ? 'true' : undefined}
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
    };

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
