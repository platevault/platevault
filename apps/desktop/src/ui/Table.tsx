import type { ReactNode, CSSProperties } from 'react';

export interface TableColumn {
  key: string;
  label: string;
  className?: string;
  style?: CSSProperties;
  cellStyle?: CSSProperties;
}

export interface TableProps {
  columns: TableColumn[];
  rows: Record<string, ReactNode>[];
}

export function Table({ columns, rows }: TableProps) {
  return (
    <table className="alm-table">
      <thead>
        <tr>{columns.map((c, i) => <th key={i} style={c.style}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {columns.map((c, ci) => (
              <td key={ci} className={c.className} style={c.cellStyle}>{row[c.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
