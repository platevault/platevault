import { Fragment, type ReactNode } from "react";
import clsx from "clsx";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  size?: number;
  className?: string;
  render: (row: T) => ReactNode;
}

export interface DataTableGroup<T> {
  id: string;
  heading: ReactNode;
  meta?: ReactNode;
  rows: T[];
}

export interface DataTableProps<T extends { id: string }> {
  columns: DataTableColumn<T>[];
  rows?: T[];
  groups?: DataTableGroup<T>[];
  selectedId?: string | null;
  onSelect?: (row: T) => void;
  emptyMessage?: ReactNode;
  rowOverflow?: (row: T) => ReactNode;
  density?: "dense" | "comfortable";
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  groups,
  selectedId,
  onSelect,
  emptyMessage,
  rowOverflow,
  density = "dense",
}: DataTableProps<T>) {
  const flatRows: T[] = rows ?? groups?.flatMap((g) => g.rows) ?? [];

  const renderRow = (row: T) => {
    const isSelected = selectedId === row.id;
    const isSelectable = onSelect != null;
    return (
      <tr
        key={row.id}
        data-selected={isSelected ? "true" : undefined}
        data-density={density === "comfortable" ? "comfortable" : undefined}
        onClick={() => onSelect?.(row)}
        tabIndex={isSelectable ? 0 : -1}
        role={isSelectable ? "option" : undefined}
        aria-selected={isSelectable ? isSelected : undefined}
        onKeyDown={(e) => {
          if (!isSelectable) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect?.(row);
          }
        }}
      >
        {columns.map((col) => (
          <td key={col.id} className={clsx(col.className)}>
            {col.render(row)}
          </td>
        ))}
        {rowOverflow ? (
          <td
            className="alm-table__overflow"
            onClick={(e) => e.stopPropagation()}
          >
            {rowOverflow(row)}
          </td>
        ) : null}
      </tr>
    );
  };

  return (
    <table
      className="alm-table"
      role={onSelect ? "listbox" : undefined}
      aria-multiselectable={false}
    >
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.id} style={col.size ? { width: col.size, minWidth: col.size } : undefined}>
              {col.header}
            </th>
          ))}
          {rowOverflow ? <th className="alm-table__overflow" /> : null}
        </tr>
      </thead>
      <tbody>
        {groups ? (
          groups.map((group) => (
            <Fragment key={group.id}>
              <tr className="alm-table__group-header" role="presentation">
                <td colSpan={columns.length + (rowOverflow ? 1 : 0)}>
                  {group.heading}
                  {group.meta ? <span className="alm-table__group-meta">{group.meta}</span> : null}
                </td>
              </tr>
              {group.rows.map(renderRow)}
            </Fragment>
          ))
        ) : flatRows.length === 0 ? (
          <tr>
            <td
              colSpan={columns.length + (rowOverflow ? 1 : 0)}
              style={{ textAlign: "center", color: "var(--text-faint)", height: 120 }}
            >
              {emptyMessage ?? "No data"}
            </td>
          </tr>
        ) : (
          flatRows.map(renderRow)
        )}
      </tbody>
    </table>
  );
}
