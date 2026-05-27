import type { ReactNode, CSSProperties } from 'react';

export interface TableColumn {
  key: string;
  label: string;
  className?: string;
  style?: CSSProperties;
  cellStyle?: CSSProperties;
}

export type TableRow = {
  [key: string]: ReactNode | CSSProperties | undefined;
  /** Optional per-row CSS applied to the <tr> element. Not rendered as a cell. */
  _rowStyle?: CSSProperties;
  /** Optional per-row className applied to the <tr> element. Not rendered as a cell. */
  _rowClassName?: string;
};

export interface TableProps {
  columns: TableColumn[];
  rows: TableRow[];
}

export function Table({ columns, rows }: TableProps) {
  return (
    <table className="alm-table">
      <thead>
        <tr>{columns.map((c, i) => <th key={i} style={c.style}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} style={row._rowStyle as CSSProperties | undefined} className={row._rowClassName as string | undefined}>
            {columns.map((c, ci) => (
              <td key={ci} className={c.className} style={c.cellStyle}>{row[c.key] as ReactNode}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
