import { Fragment, useState, type ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  size?: number;
  className?: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  accessor?: (row: T) => string | number | null | undefined;
}

export interface DataTableGroup<T> {
  id: string;
  heading: ReactNode;
  meta?: ReactNode;
  rows: T[];
  /** When true the group header shows a chevron and can be clicked to collapse. */
  collapsible?: boolean;
  /** Initial expanded state when collapsible=true. Defaults to true. */
  defaultExpanded?: boolean;
}

export interface DataTableProps<T extends { id: string }> {
  columns: DataTableColumn<T>[];
  rows?: T[];
  groups?: DataTableGroup<T>[];
  selectedId?: string | null;
  onSelect?: (row: T) => void;
  selectedIds?: Set<string>;
  onToggleRow?: (row: T, modifiers: { shift: boolean; meta: boolean }) => void;
  onToggleAll?: () => void;
  emptyMessage?: ReactNode;
  rowOverflow?: (row: T) => ReactNode;
  density?: "dense" | "comfortable";
  sort?: { id: string; dir: "asc" | "desc" } | null;
  onSortChange?: (next: { id: string; dir: "asc" | "desc" } | null) => void;
}

/**
 * Sort an array of rows by a column's accessor.
 * - Numeric comparison for numbers.
 * - localeCompare with numeric:true for strings.
 * - null/undefined always sorts to the END regardless of direction.
 * - Returns a new array (never mutates).
 */
export function sortRows<T>(
  rows: T[],
  column: DataTableColumn<T>,
  dir: "asc" | "desc",
): T[] {
  if (!column.accessor) return rows;
  const accessor = column.accessor;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    const aNull = av == null;
    const bNull = bv == null;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv), undefined, {
        sensitivity: "base",
        numeric: true,
      });
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  groups,
  selectedId,
  onSelect,
  selectedIds,
  onToggleRow,
  onToggleAll,
  emptyMessage,
  rowOverflow,
  density = "dense",
  sort,
  onSortChange,
}: DataTableProps<T>) {
  // Collapsible group state: set of expanded group ids.
  // Seeded from defaultExpanded (default true) on first render only.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    if (!groups) return new Set();
    const expanded = new Set<string>();
    for (const g of groups) {
      if (g.collapsible && g.defaultExpanded !== false) {
        expanded.add(g.id);
      }
    }
    return expanded;
  });

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const flatRows: T[] = rows ?? groups?.flatMap((g) => g.rows) ?? [];
  const showCheckboxes = selectedIds != null && onToggleRow != null;
  const allSelected = showCheckboxes && flatRows.length > 0 && flatRows.every((r) => selectedIds!.has(r.id));
  const someSelected = showCheckboxes && flatRows.some((r) => selectedIds!.has(r.id)) && !allSelected;

  function handleHeaderClick(col: DataTableColumn<T>) {
    if (!col.sortable || !onSortChange) return;
    if (sort?.id !== col.id) {
      onSortChange({ id: col.id, dir: "asc" });
    } else if (sort.dir === "asc") {
      onSortChange({ id: col.id, dir: "desc" });
    } else {
      onSortChange(null);
    }
  }

  function handleHeaderKeyDown(e: React.KeyboardEvent, col: DataTableColumn<T>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleHeaderClick(col);
    }
  }

  const renderRow = (row: T) => {
    const isSelected = selectedId === row.id;
    const isChecked = selectedIds?.has(row.id) ?? false;
    const isSelectable = onSelect != null;
    return (
      <tr
        key={row.id}
        data-selected={isSelected ? "true" : undefined}
        data-checked={isChecked ? "true" : undefined}
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
        {showCheckboxes ? (
          <td className="alm-table__check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => {}}
              onClick={(e) => {
                e.stopPropagation();
                onToggleRow!(row, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
              }}
              aria-label="Select row"
            />
          </td>
        ) : null}
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

  const colSpan =
    columns.length + (rowOverflow ? 1 : 0) + (showCheckboxes ? 1 : 0);

  return (
    <table
      className="alm-table"
      role={onSelect ? "listbox" : undefined}
      aria-multiselectable={false}
    >
      <thead>
        <tr>
          {showCheckboxes ? (
            <th className="alm-table__check">
              <input
                type="checkbox"
                aria-label={allSelected ? "Deselect all" : "Select all"}
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={() => onToggleAll?.()}
              />
            </th>
          ) : null}
          {columns.map((col) => {
            const isSortable = col.sortable === true && onSortChange != null;
            const isActive = sort?.id === col.id;
            const ariaSort = isActive
              ? sort.dir === "asc"
                ? "ascending"
                : "descending"
              : isSortable
              ? "none"
              : undefined;
            return (
              <th
                key={col.id}
                style={col.size ? { width: col.size, minWidth: col.size } : undefined}
                role={isSortable ? "columnheader" : undefined}
                aria-sort={ariaSort}
                data-sortable={isSortable ? "true" : undefined}
                data-sort-active={isActive ? "true" : undefined}
                tabIndex={isSortable ? 0 : undefined}
                onClick={isSortable ? () => handleHeaderClick(col) : undefined}
                onKeyDown={isSortable ? (e) => handleHeaderKeyDown(e, col) : undefined}
                className={isSortable ? "alm-table__th--sortable" : undefined}
              >
                <span className="alm-table__th-inner">
                  {col.header}
                  {isSortable ? (
                    <span
                      className={
                        isActive
                          ? "alm-table__sort-icon alm-table__sort-icon--active"
                          : "alm-table__sort-icon"
                      }
                      aria-hidden="true"
                    >
                      {isActive && sort.dir === "desc" ? (
                        <ChevronDown size={11} />
                      ) : (
                        <ChevronUp size={11} />
                      )}
                    </span>
                  ) : null}
                </span>
              </th>
            );
          })}
          {rowOverflow ? <th className="alm-table__overflow" /> : null}
        </tr>
      </thead>
      <tbody>
        {groups ? (
          groups.map((group) => {
            const isCollapsible = group.collapsible === true;
            const isExpanded = !isCollapsible || expandedGroups.has(group.id);
            return (
              <Fragment key={group.id}>
                <tr
                  className="alm-table__group-header"
                  role="presentation"
                  data-collapsible={isCollapsible ? "true" : undefined}
                  onClick={isCollapsible ? () => toggleGroup(group.id) : undefined}
                >
                  <td colSpan={colSpan}>
                    {isCollapsible ? (
                      <span className="alm-table__group-header__chevron" aria-hidden="true">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
                    ) : null}
                    {group.heading}
                    {group.meta ? <span className="alm-table__group-meta">{group.meta}</span> : null}
                  </td>
                </tr>
                {isExpanded ? group.rows.map(renderRow) : null}
              </Fragment>
            );
          })
        ) : flatRows.length === 0 ? (
          <tr>
            <td
              colSpan={colSpan}
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
