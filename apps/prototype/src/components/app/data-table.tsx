/**
 * Dense data table (foundation-owned) on native table semantics.
 *
 * - Sorting: header buttons with `aria-sort`; null values sort last.
 * - Selection: controlled checkbox column with a select-all for the rows
 *   shown. Filtering is the caller's job: selection ids are never dropped
 *   here, so callers can report "Selected outside current filters: N".
 * - Keyboard: ↑/↓ move focus to the same column in the adjacent row, across
 *   groups; Tab order stays natural. Row height follows the density token `--row-h`.
 * - Grouping (opt-in `groups`): group header rows inside this one table, so
 *   every group shares the column widths and the pinned header row.
 */
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export interface Column<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  sortValue?: (row: T) => string | number | null
  align?: "left" | "right"
  className?: string
  /** Render this column's cell as the row header (`th scope="row"`). */
  rowHeader?: boolean
  /** Truncate long text (paths, names) at 18rem; pair with a `title`. */
  truncate?: boolean
}

export interface DataTableSelection<T> {
  selected: string[]
  onChange: (ids: string[]) => void
  /** Accessible name fragment for the row checkbox, e.g. the session name. */
  rowLabel: (row: T) => string
  isSelectable?: (row: T) => boolean
}

export interface DataTableGrouping<T> {
  /** Group of a row, e.g. its observing night. */
  key: (row: T) => string
  /** Group header content, e.g. "Thu 30 Sep · 3 sessions"; `rows` are the group's rows. */
  label: (key: string, rows: T[]) => ReactNode
  /** Order of groups by key; default ascending (`localeCompare`). */
  compare?: (a: string, b: string) => number
}

export interface DataTableProps<T> {
  /** Table caption (visually hidden); names the data set. */
  label: string
  rows: T[]
  columns: Column<T>[]
  getRowId: (row: T) => string
  selection?: DataTableSelection<T>
  initialSort?: { columnId: string; direction: "asc" | "desc" }
  /** Shown instead of the body when there are no rows. */
  empty?: ReactNode
  loading?: boolean
  /** The row whose detail is open; marked `aria-current`. */
  activeRowId?: string | null
  rowClassName?: (row: T) => string | undefined
  className?: string
  /** "frame" (default) scrolls long tables inside their frame with a pinned header; "none" grows with content. */
  scroll?: "frame" | "none"
  /**
   * Show rows in groups inside this one table. Columns line up across groups
   * because they are one table; the sort applies within each group, and
   * select-all covers every group shown.
   */
  groups?: DataTableGrouping<T>
}

export function DataTable<T>({
  label,
  rows,
  columns,
  getRowId,
  selection,
  initialSort,
  empty,
  loading,
  activeRowId,
  rowClassName,
  className,
  scroll = "frame",
  groups,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort ?? null)

  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.id === sort.columnId) : undefined
    if (!sort || !column?.sortValue) return rows
    const factor = sort.direction === "asc" ? 1 : -1
    const value = column.sortValue
    return [...rows].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * factor
    })
  }, [rows, columns, sort])

  // One body per group (keeping the sort inside each), or one body for all rows.
  const bodies = useMemo(() => {
    if (!groups) return [{ key: null, rows: sorted }]
    const byKey = new Map<string, T[]>()
    for (const row of sorted) {
      const key = groups.key(row)
      byKey.set(key, [...(byKey.get(key) ?? []), row])
    }
    return [...byKey.keys()]
      .sort(groups.compare ?? ((a, b) => a.localeCompare(b)))
      .map((key) => ({ key, rows: byKey.get(key)! }))
  }, [sorted, groups])

  const selectable = selection ? sorted.filter((row) => selection.isSelectable?.(row) ?? true) : []
  const selectedSet = new Set(selection?.selected ?? [])
  const shownSelected = selectable.filter((row) => selectedSet.has(getRowId(row))).length
  const allShownSelected = selectable.length > 0 && shownSelected === selectable.length

  function toggleAll(checked: boolean) {
    if (!selection) return
    const shownIds = selectable.map(getRowId)
    const next = checked
      ? [...new Set([...selection.selected, ...shownIds])]
      : selection.selected.filter((id) => !shownIds.includes(id))
    selection.onChange(next)
  }

  function toggleRow(id: string, checked: boolean) {
    if (!selection) return
    selection.onChange(checked ? [...selection.selected, id] : selection.selected.filter((s) => s !== id))
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableSectionElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const target = event.target as HTMLElement
    if (target.closest("input, textarea, select, [role=listbox], [role=menu]") && target.tagName !== "BUTTON") return
    const cell = target.closest("td, th")
    const row = cell?.closest<HTMLElement>("tr[data-row]")
    if (!cell || !row) return
    // Data rows of the whole table, so ↑/↓ also cross group boundaries.
    const allRows = Array.from(row.closest("table")?.querySelectorAll<HTMLElement>("tbody tr[data-row]") ?? [])
    const sibling = allRows[allRows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)]
    if (!sibling) return
    const index = Array.from(row.children).indexOf(cell)
    const focusable = "a[href], button:not([disabled]), [role=checkbox], input:not([disabled])"
    const next = sibling.children[index]?.querySelector<HTMLElement>(focusable) ?? sibling.querySelector<HTMLElement>(focusable)
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  const columnCount = columns.length + (selection ? 1 : 0)
  return (
    <div
      className={cn(
        // The frame is the scroll container in both axes so the header row
        // stays pinned while long tables scroll inside it.
        "relative overflow-auto rounded-lg border",
        scroll === "frame" && "max-h-[calc(100dvh-14rem)]",
        className,
      )}
      aria-busy={loading || undefined}
    >
      <table className="w-full text-sm">
        <caption className="sr-only">{loading ? `Loading ${label}` : label}</caption>
        <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
          <tr>
            {selection ? (
              <th scope="col" className="h-(--row-h) w-10 px-3">
                <Checkbox
                  aria-label={`Select all ${selectable.length} shown`}
                  checked={allShownSelected}
                  indeterminate={shownSelected > 0 && !allShownSelected}
                  disabled={loading || selectable.length === 0}
                  onCheckedChange={(checked) => toggleAll(checked)}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const active = sort?.columnId === column.id
              const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : column.sortValue ? "none" : undefined
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn("h-(--row-h) px-3 font-medium whitespace-nowrap", column.align === "right" ? "text-right" : "text-left", column.className)}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className={cn("inline-flex h-6 items-center gap-1 rounded-sm hover:text-foreground", active && "text-foreground")}
                      onClick={() =>
                        setSort((current) =>
                          current?.columnId === column.id
                            ? { columnId: column.id, direction: current.direction === "asc" ? "desc" : "asc" }
                            : { columnId: column.id, direction: "asc" },
                        )
                      }
                    >
                      {column.header}
                      {active ? (
                        sort.direction === "asc" ? <ArrowUp aria-hidden="true" className="size-3" /> : <ArrowDown aria-hidden="true" className="size-3" />
                      ) : (
                        <ArrowUpDown aria-hidden="true" className="size-3 opacity-50" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        {loading ? (
          <tbody>
            {Array.from({ length: 6 }, (_, r) => (
              <tr key={r} className="h-(--row-h) border-b last:border-0">
                {Array.from({ length: columnCount }, (_, c) => (
                  <td key={c} className="px-3">
                    <Skeleton className={cn("h-3", c === 0 && selection ? "size-4" : "w-3/4")} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : sorted.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={columnCount} className="p-4">
                {empty ?? <p className="text-sm text-muted-foreground">No rows.</p>}
              </td>
            </tr>
          </tbody>
        ) : (
          bodies.map((body, bodyIndex) => (
            <tbody key={body.key ?? "rows"} onKeyDown={onKeyDown}>
              {body.key !== null && groups ? (
                <tr className={cn("border-b bg-muted/40", bodyIndex > 0 && "border-t")}>
                  <th scope="rowgroup" colSpan={columnCount} className="h-(--row-h) px-3 text-left text-xs font-semibold">
                    {groups.label(body.key, body.rows)}
                  </th>
                </tr>
              ) : null}
              {body.rows.map((row) => {
                const id = getRowId(row)
                const isSelected = selectedSet.has(id)
                const canSelect = selection?.isSelectable?.(row) ?? true
                return (
                  <tr
                    key={id}
                    data-row
                    aria-current={activeRowId === id ? "true" : undefined}
                    data-selected={isSelected || undefined}
                    className={cn(
                      "h-(--row-h) border-b last:border-0 hover:bg-muted/60",
                      "data-selected:bg-primary/10 data-selected:hover:bg-primary/16",
                      "aria-[current=true]:bg-accent aria-[current=true]:shadow-[inset_2px_0_0_var(--primary)]",
                      rowClassName?.(row),
                    )}
                  >
                    {selection ? (
                      <td className="w-10 px-3">
                        <Checkbox
                          aria-label={`Select ${selection.rowLabel(row)}`}
                          checked={isSelected}
                          disabled={!canSelect}
                          onCheckedChange={(checked) => toggleRow(id, checked)}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => {
                      const Cell = column.rowHeader ? "th" : "td"
                      return (
                        <Cell
                          key={column.id}
                          scope={column.rowHeader ? "row" : undefined}
                          className={cn(
                            "px-3 py-1 font-normal tabular-nums",
                            column.truncate ? "max-w-72 truncate" : "whitespace-nowrap",
                            column.align === "right" ? "text-right" : "text-left",
                            column.className,
                          )}
                        >
                          {column.cell(row)}
                        </Cell>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          ))
        )}
      </table>
    </div>
  )
}

/**
 * Table toolbar: page search (focused by `/`), filter controls and actions,
 * aligned on one row above a DataTable.
 */
export function TableToolbar({
  search,
  filters,
  actions,
}: {
  /** Search input props; the input gets `data-page-search` for the `/` shortcut. */
  search?: { label: string; placeholder: string; value: string; onChange: (value: string) => void }
  filters?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {search ? (
        <div className="relative w-64 min-w-0">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-page-search
            type="search"
            aria-label={search.label}
            placeholder={search.placeholder}
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            className="pl-8"
          />
        </div>
      ) : null}
      {filters}
      <div className="flex-1" />
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * Selection summary for multi-select tables (VSEL-FR-06): how many are
 * selected, how many of those are hidden by the current filters, and the
 * bulk actions that apply. Renders nothing when nothing is selected.
 */
export function SelectionBar({
  count,
  hiddenByFilters = 0,
  noun,
  onShowSelected,
  onClear,
  actions,
}: {
  count: number
  hiddenByFilters?: number
  /** Singular noun, e.g. "session". */
  noun: string
  onShowSelected?: () => void
  onClear: () => void
  actions?: ReactNode
}) {
  if (count === 0) return null
  return (
    <div role="region" aria-label="Selection" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/40 bg-primary/8 px-3 py-1.5 text-sm">
      <span className="font-medium tabular-nums" aria-live="polite">
        {count} {count === 1 ? noun : `${noun}s`} selected
        {hiddenByFilters > 0 ? <span className="font-normal text-muted-foreground"> · Selected outside current filters: {hiddenByFilters}</span> : null}
      </span>
      {onShowSelected ? (
        <Button size="sm" variant="ghost" onClick={onShowSelected}>
          Show selected
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear selection
      </Button>
      <div className="flex-1" />
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}