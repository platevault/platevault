/**
 * Dense data table (foundation-owned) on native table semantics.
 *
 * - Sorting: header buttons with `aria-sort`; null values sort last.
 * - Selection: controlled checkbox column with a select-all for the rows
 *   shown. Filtering is the caller's job: selection ids are never dropped
 *   here, so callers can report "Selected outside current filters: N". The
 *   count also shows in the status bar's context slot (`useStatusSelection`).
 * - Keyboard: ↑/↓ move focus to the same column in the adjacent row, across
 *   groups; Tab order stays natural. Row height follows the density token `--row-h`.
 * - Grouping (opt-in `groups`): group header rows inside this one table, so
 *   every group shares the column widths and the pinned header row.
 * - Pinned first column (opt-in `stickyFirstColumn`): the selection column
 *   and the first column stay in view while a wide table scrolls sideways.
 * - Context menu (opt-in `contextMenu`): one native-style menu for the table;
 *   right click, Shift+F10 or the Menu key on a row opens that row's items,
 *   in a menu named after the row.
 *   Return `MenuEntry[]` (row-menu.tsx) or ready-made menu items.
 * - Click to act (opt-in `onRowClick`): a click on the row outside its
 *   controls (links, buttons, inputs, menus) runs the row's primary action,
 *   as does Enter on the focused row. Controls keep their own action.
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { type KeyboardEvent, type MouseEvent, type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { useStatusSelection } from "@/app/status-selection"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { ClearableInput } from "./clearable-input"
import { type MenuEntry, type MenuRow, menuContent, menuRowAt, openMenuFromKeyboard } from "./row-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** Controls inside a row that keep their own click; a click on them never runs `onRowClick`. */
const ROW_CONTROLS = "a[href], button, input, select, textarea, label, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=combobox], [role=menuitem], [role=option], [contenteditable=true]"

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
  /**
   * Keep the selection column and the first column in view while the table
   * scrolls sideways (wide tables at 1024px). The frame takes the card
   * surface so pinned cells match the rows they cover; `rowClassName`
   * backgrounds do not reach the pinned cells.
   */
  stickyFirstColumn?: boolean
  /** The row's context menu: entries (`MenuEntry[]`) or menu items; every item must also be reachable from the row itself. */
  contextMenu?: (row: T) => MenuEntry[] | ReactNode
  /** The row's primary action (open, select): a click outside the row's controls, or Enter on the focused row. */
  onRowClick?: (row: T) => void
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
  stickyFirstColumn = false,
  contextMenu,
  onRowClick,
}: DataTableProps<T>) {
  const m = useMessages()
  const [sort, setSort] = useState(initialSort ?? null)
  const [menuTarget, setMenuTarget] = useState<MenuRow | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const lastPinnedHeader = useRef<HTMLTableCellElement>(null)
  useStatusSelection(selection?.selected.length ?? 0)

  // Scroll padding the width of the pinned columns, so Tab never leaves a
  // focused cell under them (WCAG 2.4.11); it follows column resizes.
  useLayoutEffect(() => {
    const container = frame.current
    const header = lastPinnedHeader.current
    if (!stickyFirstColumn || !container || !header) return
    const update = () => container.style.setProperty("--pinned-w", `${header.offsetLeft + header.offsetWidth}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => observer.disconnect()
  }, [stickyFirstColumn])

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
    const row = target.closest<HTMLElement>("tr[data-row]")
    // A focused row (click to act) moves to the adjacent row's first control, or the row itself.
    const cell = target === row ? row.children[0] : target.closest("td, th")
    if (!cell || !row) return
    // Data rows of the whole table, so ↑/↓ also cross group boundaries.
    const allRows = Array.from(row.closest("table")?.querySelectorAll<HTMLElement>("tbody tr[data-row]") ?? [])
    const sibling = allRows[allRows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)]
    if (!sibling) return
    const index = Array.from(row.children).indexOf(cell)
    const focusable = "a[href], button:not([disabled]), [role=checkbox], input:not([disabled])"
    const next = sibling.children[index]?.querySelector<HTMLElement>(focusable) ?? sibling.querySelector<HTMLElement>(focusable) ?? (onRowClick ? sibling : null)
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  // Only clicks on the row's own DOM count: portalled menus and dialogs opened from a row bubble here through React.
  const rowClick = (row: T) => (event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement
    if (!event.currentTarget.contains(target) || target.closest(ROW_CONTROLS)) return
    if (window.getSelection()?.isCollapsed === false) return
    onRowClick?.(row)
  }
  const rowKey = (row: T) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== "Enter" || event.target !== event.currentTarget) return
    event.preventDefault()
    onRowClick?.(row)
  }

  const columnCount = columns.length + (selection ? 1 : 0)
  // Pinned cells are opaque (card plus the row's tint, `--row-bg`) and sit
  // under the sticky header (z-10). The last pinned cell draws the edge.
  const pinned = (position: "first" | "only" | "last", head = false) =>
    stickyFirstColumn
      ? cn(
          "sticky",
          head ? "bg-card" : "z-1 bg-card [background-image:linear-gradient(var(--row-bg),var(--row-bg))]",
          position === "last" ? "left-10" : "left-0",
          position !== "first" && "shadow-[inset_-1px_0_0_var(--border)]",
          !head && position !== "last" && "group-aria-[current=true]/row:shadow-[inset_2px_0_0_var(--primary)]",
          !head && position === "only" && "group-aria-[current=true]/row:shadow-[inset_2px_0_0_var(--primary),inset_-1px_0_0_var(--border)]",
        )
      : undefined
  const columnPin = selection ? "last" : "only"
  // The row under the pointer (or the focused row for Shift+F10) picks the
  // menu's items; outside a row the browser's own menu stays.
  const onContextMenu = (event: MouseEvent) => {
    const found = menuRowAt(event.target, "data-row-id")
    if (found === null) event.stopPropagation()
    else setMenuTarget(found)
  }
  const menuRow = contextMenu && menuTarget !== null ? rows.find((row) => getRowId(row) === menuTarget.key) : undefined
  const frameClass = cn(
    // The frame is the scroll container in both axes so the header row
    // stays pinned while long tables scroll inside it. Scroll padding the
    // height of that header keeps a focused row out from under it (WCAG 2.4.11).
    "relative scroll-pt-[calc(var(--row-h)+1px)] overflow-auto rounded-md border bg-background",
    stickyFirstColumn && "scroll-pl-(--pinned-w) bg-card",
    scroll === "frame" && "max-h-[calc(100dvh-14rem)]",
    className,
  )
  const table = (
      <table className="w-full text-sm" onContextMenu={contextMenu ? onContextMenu : undefined} onKeyDown={contextMenu ? (event) => openMenuFromKeyboard(event, "data-row-id") : undefined}>
        <caption className="sr-only">{loading ? m.table_loading({ name: label }) : label}</caption>
        <thead data-chrome className="sticky top-0 z-10 bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
          <tr>
            {selection ? (
              <th scope="col" className={cn("h-(--row-h) w-10 px-3", pinned("first", true))}>
                <Checkbox
                  aria-label={m.table_select_all({ count: selectable.length })}
                  checked={allShownSelected}
                  indeterminate={shownSelected > 0 && !allShownSelected}
                  disabled={loading || selectable.length === 0}
                  onCheckedChange={(checked) => toggleAll(checked)}
                />
              </th>
            ) : null}
            {columns.map((column, columnIndex) => {
              const active = sort?.columnId === column.id
              const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : column.sortValue ? "none" : undefined
              return (
                <th
                  key={column.id}
                  ref={columnIndex === 0 ? lastPinnedHeader : undefined}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    "h-(--row-h) px-3 font-medium whitespace-nowrap",
                    column.align === "right" ? "text-right" : "text-left",
                    column.className,
                    columnIndex === 0 && pinned(columnPin, true),
                  )}
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
                {empty ?? <p className="text-sm text-muted-foreground">{m.table_no_rows()}</p>}
              </td>
            </tr>
          </tbody>
        ) : (
          bodies.map((body, bodyIndex) => (
            <tbody key={body.key ?? "rows"} onKeyDown={onKeyDown}>
              {body.key !== null && groups ? (
                <tr className={cn("border-b bg-muted/40", bodyIndex > 0 && "border-t")}>
                  <th scope="rowgroup" colSpan={columnCount} className="h-(--row-h) px-3 text-left text-xs font-semibold">
                    {/* The label stays in view while the table scrolls sideways. */}
                    <span className={cn(stickyFirstColumn && "sticky left-3")}>{groups.label(body.key, body.rows)}</span>
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
                    data-row-id={contextMenu ? id : undefined}
                    aria-current={activeRowId === id ? "true" : undefined}
                    tabIndex={onRowClick ? -1 : undefined}
                    onClick={onRowClick ? rowClick(row) : undefined}
                    onKeyDown={onRowClick ? rowKey(row) : undefined}
                    data-selected={isSelected || undefined}
                    className={cn(
                      // The stripe skips selected rows, so the selected tint always shows.
                      "group/row h-(--row-h) border-b border-border/50 last:border-0 even:not-data-selected:bg-foreground/[0.022] hover:bg-foreground/[0.06]",
                      "data-selected:bg-primary/16 data-selected:hover:bg-primary/22",
                      "aria-[current=true]:bg-accent aria-[current=true]:shadow-[inset_2px_0_0_var(--primary)]",
                      // The same tints as a variable, for pinned cells that paint over the row.
                      "[--row-bg:transparent] even:not-data-selected:[--row-bg:color-mix(in_oklab,var(--foreground)_2.2%,transparent)] hover:[--row-bg:color-mix(in_oklab,var(--foreground)_6%,transparent)]",
                      "data-selected:[--row-bg:color-mix(in_oklab,var(--primary)_16%,transparent)] data-selected:hover:[--row-bg:color-mix(in_oklab,var(--primary)_22%,transparent)]",
                      "aria-[current=true]:[--row-bg:var(--accent)]",
                      onRowClick && "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      rowClassName?.(row),
                    )}
                  >
                    {selection ? (
                      <td className={cn("w-10 px-3", pinned("first"))}>
                        <Checkbox
                          aria-label={m.table_select_row({ name: selection.rowLabel(row) })}
                          checked={isSelected}
                          disabled={!canSelect}
                          onCheckedChange={(checked) => toggleRow(id, checked)}
                        />
                      </td>
                    ) : null}
                    {columns.map((column, columnIndex) => {
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
                            columnIndex === 0 && pinned(columnPin),
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
  )
  const busy = loading || undefined
  if (!contextMenu) {
    return (
      <div ref={frame} className={frameClass} aria-busy={busy}>
        {table}
      </div>
    )
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger ref={frame} className={frameClass} aria-busy={busy}>
        {table}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={menuTarget?.name}>{menuRow ? menuContent(contextMenu(menuRow)) : null}</ContextMenuContent>
    </ContextMenu>
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
        <ClearableInput search wrapperClassName="w-64" aria-label={search.label} placeholder={search.placeholder} value={search.value} onValueChange={search.onChange} />
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
 * bulk actions that apply. With nothing selected only an empty live region
 * stays mounted, so the first count is announced too (WCAG 4.1.3).
 */
export function SelectionBar({
  count,
  hiddenByFilters = 0,
  label,
  onShowSelected,
  onClear,
  clearDisabledReason,
  actions,
}: {
  count: number
  hiddenByFilters?: number
  /** The count line as one complete message, so the caller's noun agrees in gender and number: `m.project_sessions_selected({ count })`. */
  label: string
  onShowSelected?: () => void
  onClear: () => void
  /** When set, Clear selection stays focusable but disabled, with this reason beside it. */
  clearDisabledReason?: string
  actions?: ReactNode
}) {
  const m = useMessages()
  const clearReasonId = useId()
  const live = (
    <span className={count === 0 ? undefined : "font-medium tabular-nums"} aria-live="polite">
      {count === 0 ? null : (
        <>
          {label}
          {hiddenByFilters > 0 ? <span className="font-normal text-muted-foreground"> · {m.selection_outside_filters({ count: hiddenByFilters })}</span> : null}
        </>
      )}
    </span>
  )
  // Out of the layout flow, so an empty bar adds no gap between its siblings.
  if (count === 0) return <div className="sr-only">{live}</div>
  return (
    <div role="region" aria-label={m.selection_region()} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/40 bg-primary/8 px-3 py-1.5 text-sm">
      {live}
      {onShowSelected ? (
        <Button size="sm" variant="ghost" onClick={onShowSelected}>
          {m.selection_show()}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        disabled={clearDisabledReason !== undefined}
        focusableWhenDisabled
        aria-describedby={clearDisabledReason !== undefined ? clearReasonId : undefined}
      >
        {m.selection_clear()}
      </Button>
      {clearDisabledReason !== undefined ? (
        <span id={clearReasonId} className="text-xs text-muted-foreground">
          {clearDisabledReason}
        </span>
      ) : null}
      <div className="flex-1" />
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}