import { forwardRef } from 'react';
import type { ReactNode, CSSProperties, TableHTMLAttributes, MouseEvent } from 'react';

export interface TableColumn {
  key: string;
  label: string;
  className?: string;
  style?: CSSProperties;
  cellStyle?: CSSProperties;
}

export type TableRow = {
  [key: string]: ReactNode | CSSProperties | ((evt: MouseEvent) => void) | undefined;
  /** Optional per-row CSS applied to the <tr> element. Not rendered as a cell. */
  _rowStyle?: CSSProperties;
  /** Optional per-row className applied to the <tr> element. Not rendered as a cell. */
  _rowClassName?: string;
  /** Optional click handler applied to the <tr> element. Not rendered as a cell. */
  _onClick?: (evt: MouseEvent) => void;
};

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  columns: TableColumn[];
  rows: TableRow[];
}

export const Table = forwardRef<HTMLTableElement, TableProps>(
  function Table({ columns, rows, className, ...rest }, ref) {
    const cls = ['alm-table', className].filter(Boolean).join(' ');
    return (
      <table ref={ref} className={cls} {...rest}>
        <thead>
          <tr>{columns.map((c, i) => <th key={i} style={c.style}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              style={row._rowStyle}
              className={row._rowClassName}
              onClick={row._onClick as ((evt: MouseEvent) => void) | undefined}
            >
              {columns.map((c, ci) => (
                <td key={ci} className={c.className} style={c.cellStyle}>{row[c.key] as ReactNode}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
);
Table.displayName = 'Table';
