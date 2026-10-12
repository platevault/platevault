/**
 * Dense data table (foundation-owned, plan P4) on native table semantics,
 * drawn with the `components/ui/table` parts.
 *
 * - Sorting: a column sorts by its `sortValue` unless it is `static` (row
 *   actions, a thumbnail). The header is a borderless button with
 *   `aria-sort`; only the active column shows its arrow, and the arrow's room
 *   is kept so sorting never moves a header. Null values sort last.
 * - Selection: controlled checkbox column with a select-all for the rows
 *   shown. Filtering is the caller's job (`rows` are the rows the filters
 *   leave): selection ids are never dropped here, and the batch bar counts the
 *   ones the filters hide. The count also shows in the status bar's context
 *   slot (`useStatusSelection`).
 * - Toolbar slot (`toolbar`, `batchActions`): one row of fixed height above
 *   the table with the FilterBar controls and the toolbar actions. While rows
 *   are selected the batch bar takes the row's place at the same height
 *   ("3 selected · 1 hidden by filters [Show] · actions · Clear selection"),
 *   so selecting never moves the table. Action feedback and the active-filter
 *   chips sit under the row.
 * - Row actions (`rowActions`, `primaryRowAction`): a trailing column with at
 *   most one inline action and the row's ⋯ menu. Right click, Shift+F10 or the
 *   Menu key on a row open the same items as a context menu named after the
 *   row (`rowLabel`). One action runner per table holds the confirmations
 *   and refusals.
 * - Expand (`expand`): a disclosure in the first cell opens the row's detail
 *   in a row under it, one level deep (a nested DataTable, a KeyValueList).
 * - Keyboard: ↑/↓ move focus to the same column in the adjacent row, across
 *   groups; Tab order stays natural. Row height and cell padding follow the
 *   density tokens `--row-h` and `--row-py`.
 * - Grouping (opt-in `groups`): group header rows inside this one table, so
 *   every group shares the column widths and the pinned header row.
 * - Pinned first column (opt-in `stickyFirstColumn`): the selection column
 *   and the first column stay in view while a wide table scrolls sideways,
 *   and so does the row-actions column at the right edge.
 * - Click to act (opt-in `onRowClick`): a click on the row outside its
 *   controls (links, buttons, inputs, menus) runs the row's primary action,
 *   as does Enter on the focused row. Controls keep their own action.
 */
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, MoreHorizontal, X } from "lucide-react"
import {
  type FocusEvent,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useMessages } from "@/app/preferences"
import { useStatusSelection } from "@/app/status-selection"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CommitResult } from "@/store/core"
import { ClearableInput } from "./clearable-input"
import { ConfirmDialog } from "./confirm-dialog"
import type { Action, Column as ColumnContract, MenuItem } from "./contracts"
import { FilterChips } from "./data"
import { ActionError } from "./feedback"
import { type FilterBarProps, FilterControls, TOOLBAR_ROW, useFacetChips } from "./filter-bar"
import { type MenuEntry, MenuEntries, type MenuRow, menuContent, menuRowAt, openMenuFromKeyboard } from "./row-menu"

/** Controls inside a row that keep their own click; a click on them never runs `onRowClick`. */
const ROW_CONTROLS = "a[href], button, input, select, textarea, label, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=combobox], [role=menuitem], [role=option], [contenteditable=true]"

/**
 * @deprecated Import `Column` from `@/components/app/contracts`; W3 moves the
 * imports and W4 removes this alias.
 */
export type Column<T> = ColumnContract<T>

export interface DataTableSelection<T> {
  selected: string[]
  onChange: (ids: string[]) => void
  /** Accessible name fragment for the row checkbox, e.g. the session name. */
  rowLabel: (row: T) => string
  isSelectable?: (row: T) => boolean
  /** The batch bar's count as one complete message, when the noun must agree ("3 sessões selecionadas"); default "3 selected". */
  countLabel?: (count: number) => string
  /** Shows the selected rows the filters hide (clears the filters, or picks a "Selected" facet); the batch bar offers it as Show. */
  onShowHidden?: () => void
}

export interface DataTableGrouping<T> {
  /** Group of a row, e.g. its observing night. */
  key: (row: T) => string
  /** Group header content, e.g. "Thu 30 Sep · 3 sessions"; `rows` are the group's rows. */
  label: (key: string, rows: T[]) => ReactNode
  /** Order of groups by key; default ascending (`localeCompare`). */
  compare?: (a: string, b: string) => number
}

/** The toolbar slot's content: the FilterBar controls, then the toolbar actions. `matchCount` defaults to the rows shown. */
export interface DataTableToolbar extends FilterBarProps {
  actions?: Action[]
}

export interface DataTableExpand<T> {
  /** The detail under an open row, one level deep: a nested DataTable (`scroll="none"`) or a KeyValueList. */
  render: (row: T) => ReactNode
  isExpandable?: (row: T) => boolean
  /** Rows open on first render. */
  defaultExpanded?: string[]
}

interface DataTableBaseProps<T> {
  /** Table caption (visually hidden); names the data set. */
  label: string
  rows: T[]
  columns: ColumnContract<T>[]
  getRowId: (row: T) => string
  selection?: DataTableSelection<T>
  initialSort?: { columnId: string; direction: "asc" | "desc" }
  /** Shown instead of the body when there are no rows. */
  empty?: ReactNode
  loading?: boolean
  /** The rows could not load: the body shows the error with Retry. */
  error?: { message: string; onRetry: () => void }
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
  /**
   * @deprecated Pass `rowActions`: the row's ⋯ menu and its context menu then
   * show the same items. W4 removes this prop.
   */
  contextMenu?: (row: T) => MenuEntry[] | ReactNode
  /** The row's primary action (open, select): a click outside the row's controls, or Enter on the focused row. */
  onRowClick?: (row: T) => void
  /** The toolbar slot above the table; the batch bar replaces it while rows are selected. */
  toolbar?: DataTableToolbar
  /** Actions on the whole selection, the rows the filters hide included; shown in the batch bar (three inline, the rest under More). */
  batchActions?: (selectedIds: string[]) => Action[]
}

/** Row actions and expand name each row, so `rowLabel` comes with them. */
type DataTableRowProps<T> =
  | { rowLabel?: undefined; rowActions?: undefined; primaryRowAction?: undefined; expand?: undefined }
  | {
      /** The row's name ("30 Sep OIII"): it names the row's ⋯ menu, its context menu and its disclosure. */
      rowLabel: (row: T) => string
      /** The row's ⋯ menu; right click, Shift+F10 and the Menu key open the same items. */
      rowActions?: (row: T) => MenuItem[]
      /** At most one inline action beside the ⋯ ("Make default"); null where it does not apply. */
      primaryRowAction?: (row: T) => Action | null
      expand?: DataTableExpand<T>
    }

export type DataTableProps<T> = DataTableBaseProps<T> & DataTableRowProps<T>

/** What the toolbar slot moves focus to after a swap took the focused control away. */
const SLOT_FOCUSABLE = "button:not([disabled]), input:not([disabled]), [role=checkbox], [tabindex]:not([tabindex='-1'])"

/** T2 (plan §6.2): a cut-off cell shows its full text on hover, and only while it is cut. */
function titleWhenCut(event: PointerEvent<HTMLElement>) {
  const element = event.currentTarget
  if (element.scrollWidth > element.clientWidth) element.title = element.textContent ?? ""
  else element.removeAttribute("title")
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
  error,
  activeRowId,
  rowClassName,
  className,
  scroll = "frame",
  groups,
  stickyFirstColumn = false,
  contextMenu,
  onRowClick,
  toolbar,
  batchActions,
  rowLabel,
  rowActions,
  primaryRowAction,
  expand,
}: DataTableProps<T>) {
  const m = useMessages()
  const baseId = useId()
  const runner = useAction()
  const [sort, setSort] = useState(initialSort ?? null)
  const [menuTarget, setMenuTarget] = useState<MenuRow | null>(null)
  const [expanded, setExpanded] = useState(() => new Set(expand?.defaultExpanded ?? []))
  const frame = useRef<HTMLDivElement>(null)
  const lastPinnedHeader = useRef<HTMLTableCellElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const slotHadFocus = useRef(false)
  const selectedCount = selection?.selected.length ?? 0
  useStatusSelection(selectedCount)

  const hasSlot = toolbar !== undefined || (selection !== undefined && batchActions !== undefined)
  const batchShown = hasSlot && selectedCount > 0
  const chips = useFacetChips({ ...toolbar, matchCount: toolbar?.matchCount ?? rows.length })

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

  // The batch bar and the toolbar row swap in place. When the swap removed the
  // focused control (Clear selection, a batch action that empties the
  // selection), focus goes to the first control of what took its place.
  useLayoutEffect(() => {
    const active = document.activeElement
    if (!slotHadFocus.current || (active !== null && active !== document.body)) return
    slot.current?.querySelector<HTMLElement>(SLOT_FOCUSABLE)?.focus()
  }, [batchShown])

  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.id === sort.columnId) : undefined
    if (!sort || !column?.sortValue || column.static) return rows
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

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableSectionElement>) {
    // A nested table (an expanded row's detail) moved focus already.
    if (event.defaultPrevented || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return
    const target = event.target as HTMLElement
    if (target.closest("input, textarea, select, [role=listbox], [role=menu]") && target.tagName !== "BUTTON") return
    const row = target.closest<HTMLElement>("tr[data-row]")
    // A focused row (click to act) moves to the adjacent row's first control, or the row itself.
    const cell = target === row ? row.children[0] : target.closest("td, th")
    if (!cell || !row) return
    // Data rows of the whole table, so ↑/↓ also cross group boundaries; a nested table's rows are its own.
    const allRows = Array.from(row.closest("table")?.querySelectorAll<HTMLElement>(":scope > tbody > tr[data-row]") ?? [])
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

  const hasRowActions = rowActions !== undefined || primaryRowAction !== undefined
  const nameOf = (row: T) => rowLabel?.(row) ?? selection?.rowLabel(row) ?? getRowId(row)
  const columnCount = columns.length + (selection ? 1 : 0) + (hasRowActions ? 1 : 0)
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
  const pinnedEnd = (head = false) =>
    stickyFirstColumn
      ? cn("sticky right-0 shadow-[inset_1px_0_0_var(--border)]", head ? "bg-card" : "z-1 bg-card [background-image:linear-gradient(var(--row-bg),var(--row-bg))]")
      : undefined
  const columnPin = selection ? "last" : "only"

  const menuEnabled = rowActions !== undefined || contextMenu !== undefined
  // The row under the pointer (or the focused row for Shift+F10) picks the
  // menu's items; outside a row, and in a nested table's rows, the browser's
  // own menu (or the nested table's) stays.
  const onContextMenu = (event: MouseEvent<HTMLTableElement>) => {
    const own = event.target instanceof Element && event.target.closest("table") === event.currentTarget
    const found = own ? menuRowAt(event.target, "data-row-id") : null
    if (found === null) event.stopPropagation()
    else setMenuTarget(found)
  }
  const menuRow = menuEnabled && menuTarget !== null ? rows.find((row) => getRowId(row) === menuTarget.key) : undefined
  const menuItems = menuRow === undefined ? null : rowActions ? <MenuItems items={rowActions(menuRow)} runner={runner} /> : contextMenu ? menuContent(contextMenu(menuRow)) : null
  const frameClass = cn(
    // The frame is the scroll container in both axes so the header row
    // stays pinned while long tables scroll inside it. Scroll padding the
    // height of that header keeps a focused row out from under it (WCAG 2.4.11).
    "relative scroll-pt-[calc(var(--row-h)+1px)] overflow-auto rounded-md border bg-background",
    stickyFirstColumn && "scroll-pl-(--pinned-w) bg-card",
    // A shown (deprecated) SelectionBar's height is left free (`--selection-bar-h`), so the bar never covers a row.
    scroll === "frame" && "max-h-[calc(100dvh-14rem-var(--selection-bar-h,0px))]",
    className,
  )

  const sortHeader = (column: ColumnContract<T>, active: boolean, direction: "asc" | "desc") => {
    const Arrow = active && direction === "desc" ? ArrowDown : ArrowUp
    return (
      <button
        type="button"
        className={cn("group/sort inline-flex h-6 items-center gap-1 rounded-sm hover:text-foreground", column.align === "right" && "flex-row-reverse", active && "text-foreground")}
        onClick={() =>
          setSort((current) =>
            current?.columnId === column.id ? { columnId: column.id, direction: current.direction === "asc" ? "desc" : "asc" } : { columnId: column.id, direction: "asc" },
          )
        }
      >
        {column.header}
        {/* Only the active column shows its arrow; the others keep its room, and hint it on hover and focus. */}
        <Arrow aria-hidden="true" className={cn("size-3", !active && "opacity-0 group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50")} />
      </button>
    )
  }

  const table = (
    <Table
      onContextMenu={menuEnabled ? onContextMenu : undefined}
      onKeyDown={menuEnabled ? (event) => !event.defaultPrevented && openMenuFromKeyboard(event, "data-row-id") : undefined}
    >
      <TableCaption>{loading ? m.table_loading({ name: label }) : label}</TableCaption>
      <TableHeader>
        <tr>
          {selection ? (
            <TableHead className={cn("w-10", pinned("first", true))}>
              <Checkbox
                aria-label={m.table_select_all({ count: selectable.length })}
                checked={allShownSelected}
                indeterminate={shownSelected > 0 && !allShownSelected}
                disabled={loading || selectable.length === 0}
                onCheckedChange={(checked) => toggleAll(checked)}
              />
            </TableHead>
          ) : null}
          {columns.map((column, columnIndex) => {
            const sortable = !column.static && column.sortValue !== undefined
            const active = sortable && sort?.columnId === column.id
            const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : sortable ? "none" : undefined
            return (
              <TableHead
                key={column.id}
                ref={columnIndex === 0 ? lastPinnedHeader : undefined}
                aria-sort={ariaSort}
                className={cn(
                  column.align === "right" && "text-right",
                  column.className,
                  // The header text lines up with the cell text after the disclosure.
                  columnIndex === 0 && expand && "pl-10",
                  columnIndex === 0 && pinned(columnPin, true),
                )}
              >
                {sortable ? sortHeader(column, active, sort?.direction ?? "asc") : column.header}
              </TableHead>
            )
          })}
          {hasRowActions ? (
            <TableHead className={cn("w-px", pinnedEnd(true))}>
              <span className="sr-only">{m.table_actions_column()}</span>
            </TableHead>
          ) : null}
        </tr>
      </TableHeader>
      {loading ? (
        <TableBody>
          {Array.from({ length: 6 }, (_, r) => (
            <TableRow key={r} kind="state">
              {Array.from({ length: columnCount }, (_, c) => (
                <td key={c} className="px-3">
                  <Skeleton className={cn("h-3", c === 0 && selection ? "size-4" : "w-3/4")} />
                </td>
              ))}
            </TableRow>
          ))}
        </TableBody>
      ) : error ? (
        <TableBody>
          <TableRow kind="state">
            <td colSpan={columnCount} className="p-4">
              <ActionError message={error.message} onRetry={error.onRetry} />
            </td>
          </TableRow>
        </TableBody>
      ) : sorted.length === 0 ? (
        <TableBody>
          <TableRow kind="state">
            <td colSpan={columnCount} className="p-4">
              {empty ?? <p className="text-sm text-muted-foreground">{m.table_no_rows()}</p>}
            </td>
          </TableRow>
        </TableBody>
      ) : (
        bodies.map((body, bodyIndex) => (
          <TableBody key={body.key ?? "rows"} onKeyDown={onKeyDown}>
            {body.key !== null && groups ? (
              <TableRow kind="group">
                <th scope="rowgroup" colSpan={columnCount} className="px-3 text-left text-xs font-semibold">
                  {/* The label stays in view while the table scrolls sideways. */}
                  <span className={cn(stickyFirstColumn && "sticky left-3")}>{groups.label(body.key, body.rows)}</span>
                </th>
              </TableRow>
            ) : null}
            {body.rows.map((row, rowIndex) => {
              const id = getRowId(row)
              const isSelected = selectedSet.has(id)
              const canSelect = selection?.isSelectable?.(row) ?? true
              const canExpand = expand !== undefined && (expand.isExpandable?.(row) ?? true)
              const isExpanded = canExpand && expanded.has(id)
              const detailId = `${baseId}-detail-${bodyIndex}-${rowIndex}`
              const primary = primaryRowAction?.(row) ?? null
              return (
                <Fragment key={id}>
                  <TableRow
                    data-row
                    data-row-id={menuEnabled ? id : undefined}
                    data-alt={rowIndex % 2 === 1 || undefined}
                    data-selected={isSelected || undefined}
                    aria-current={activeRowId === id ? "true" : undefined}
                    tabIndex={onRowClick ? -1 : undefined}
                    onClick={onRowClick ? rowClick(row) : undefined}
                    onKeyDown={onRowClick ? rowKey(row) : undefined}
                    className={cn(onRowClick && "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", rowClassName?.(row))}
                  >
                    {selection ? (
                      <TableCell className={cn("w-10", pinned("first"))}>
                        <Checkbox
                          aria-label={m.table_select_row({ name: selection.rowLabel(row) })}
                          checked={isSelected}
                          disabled={!canSelect}
                          onCheckedChange={(checked) => toggleRow(id, checked)}
                        />
                      </TableCell>
                    ) : null}
                    {columns.map((column, columnIndex) => {
                      const content = column.cell(row)
                      const disclosure = columnIndex === 0 && expand !== undefined
                      const truncate = column.truncate ? { className: "truncate", onPointerEnter: titleWhenCut } : undefined
                      return (
                        <TableCell
                          key={column.id}
                          rowHeader={column.rowHeader}
                          className={cn(
                            column.truncate ? "max-w-72" : "whitespace-nowrap",
                            !disclosure && truncate?.className,
                            column.align === "right" && "text-right",
                            column.className,
                            columnIndex === 0 && pinned(columnPin),
                          )}
                          onPointerEnter={disclosure ? undefined : truncate?.onPointerEnter}
                        >
                          {disclosure ? (
                            <div className="flex min-w-0 items-center gap-1">
                              {canExpand ? (
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-expanded={isExpanded}
                                  aria-controls={isExpanded ? detailId : undefined}
                                  aria-label={m.table_row_details({ name: nameOf(row) })}
                                  onClick={() => toggleExpanded(id)}
                                >
                                  <ChevronRight aria-hidden="true" className={cn("motion-safe:transition-transform motion-safe:duration-150", isExpanded && "rotate-90")} />
                                </Button>
                              ) : (
                                <span aria-hidden="true" className="size-6 shrink-0" />
                              )}
                              <div className={cn("min-w-0", truncate?.className)} onPointerEnter={truncate?.onPointerEnter}>
                                {content}
                              </div>
                            </div>
                          ) : (
                            content
                          )}
                        </TableCell>
                      )
                    })}
                    {hasRowActions ? (
                      <TableCell className={cn("w-px text-right whitespace-nowrap", pinnedEnd())}>
                        <div className="inline-flex items-center gap-1 align-middle">
                          {primary ? <ActionButton action={primary} size="xs" runner={runner} /> : null}
                          {rowActions ? <RowActions name={nameOf(row)} items={rowActions(row)} runner={runner} /> : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                  {isExpanded ? (
                    <TableRow kind="detail">
                      <td id={detailId} colSpan={columnCount} className="px-3 py-2">
                        {expand.render(row)}
                      </td>
                    </TableRow>
                  ) : null}
                </Fragment>
              )
            })}
          </TableBody>
        ))
      )}
    </Table>
  )
  const busy = loading || undefined
  const framed = !menuEnabled ? (
    <div ref={frame} className={frameClass} aria-busy={busy}>
      {table}
    </div>
  ) : (
    <ContextMenu>
      <ContextMenuTrigger ref={frame} className={frameClass} aria-busy={busy}>
        {table}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={menuRow === undefined ? undefined : rowActions ? nameOf(menuRow) : menuTarget?.name}>{menuItems}</ContextMenuContent>
    </ContextMenu>
  )
  if (!hasSlot) {
    return (
      <>
        {framed}
        {runner.dialog}
      </>
    )
  }

  const hidden = selection ? selection.selected.length - shownSelectedOf(rows, getRowId, selectedSet) : 0
  const countLabel = selection?.countLabel?.(selectedCount) ?? m.table_selected_count({ count: selectedCount, n: formatCount(selectedCount) })
  return (
    <div className="space-y-1.5">
      <div
        ref={slot}
        className={cn("flex min-w-0 items-center gap-2", TOOLBAR_ROW)}
        onFocus={() => {
          slotHadFocus.current = true
        }}
        onBlur={(event: FocusEvent<HTMLDivElement>) => {
          // Focus that moved somewhere else; a control removed by the swap blurs to nothing.
          if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) slotHadFocus.current = false
        }}
      >
        {batchShown && selection ? (
          <BatchBar
            countLabel={countLabel}
            hidden={hidden}
            onShowHidden={selection.onShowHidden}
            onClear={() => selection.onChange([])}
            actions={batchActions?.(selection.selected) ?? []}
            runner={runner}
          />
        ) : toolbar ? (
          <>
            <FilterControls {...toolbar} />
            {toolbar.actions && toolbar.actions.length > 0 ? (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {toolbar.actions.map((action) => (
                  <ActionButton key={action.id} action={action} size="sm" runner={runner} />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">{m.table_row_count({ count: rows.length, n: formatCount(rows.length) })}</span>
        )}
        <span className="sr-only" aria-live="polite">
          {batchShown ? countLabel : null}
        </span>
      </div>
      {runner.feedback}
      {toolbar ? <FilterChips {...chips} /> : null}
      {framed}
      {runner.dialog}
    </div>
  )
}

/** How many of the selected ids are rows shown; the rest are hidden by the filters. */
function shownSelectedOf<T>(rows: T[], getRowId: (row: T) => string, selected: Set<string>): number {
  let shown = 0
  for (const row of rows) if (selected.has(getRowId(row))) shown += 1
  return shown
}

/** The toolbar row while rows are selected: the count, what the filters hide, the batch actions and Clear selection. */
function BatchBar({
  countLabel,
  hidden,
  onShowHidden,
  onClear,
  actions,
  runner,
}: {
  countLabel: string
  hidden: number
  onShowHidden?: () => void
  onClear: () => void
  actions: Action[]
  runner: ActionRunner
}) {
  const m = useMessages()
  // Three inline keep the bar one row high; the rest go under More.
  const inline = actions.slice(0, 3)
  const more = actions.slice(3)
  return (
    <div role="region" aria-label={m.selection_region()} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md border border-primary/40 bg-primary/8 px-2 text-sm">
      <span className="shrink-0 font-medium tabular-nums">{countLabel}</span>
      {hidden > 0 ? (
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          <span className="truncate">· {m.table_selection_hidden({ count: hidden, n: formatCount(hidden) })}</span>
          {onShowHidden ? (
            <Button size="xs" variant="ghost" onClick={onShowHidden}>
              {m.table_selection_show()}
            </Button>
          ) : null}
        </span>
      ) : null}
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {inline.map((action) => (
          <ActionButton key={action.id} action={action} size="sm" runner={runner} />
        ))}
        {more.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
              {m.common_more()}
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-48">
              <MenuItems items={more} runner={runner} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={onClear}>
        <X data-icon="inline-start" aria-hidden="true" />
        {m.selection_clear()}
      </Button>
    </div>
  )
}

/*
 * Interim stand-ins for the action rendering of plan P1/P2 (unit U2:
 * actions.tsx, row-actions.tsx), with the same names and props. On
 * integration this section goes and DataTable imports
 * `{ ActionButton, MenuItems, useAction, type ActionRunner }` from
 * "./actions" and `{ RowActions }` from "./row-actions".
 */

interface ActionRunner {
  run: (action: Action) => void
  /** The last run's error, placed beside the triggers. */
  feedback: ReactNode
  /** The ConfirmDialog of an action with `confirm`; mounted once. */
  dialog: ReactNode
  clear: () => void
}

function isAction(item: MenuItem): item is Action {
  return "run" in item
}

function useAction(): ActionRunner {
  const [confirming, setConfirming] = useState<Action | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const settle = (result: CommitResult | void) => setError(result && !result.ok ? result.message : null)
  const spec = confirming?.confirm
  return {
    run: (action) => {
      if (action.unavailable) return
      if (action.confirm) {
        setConfirming(action)
        setOpen(true)
        return
      }
      const result = action.run()
      if (result instanceof Promise) void result.then(settle)
      else settle(result)
    },
    feedback: error === null ? null : <ActionError message={error} className="min-w-0" />,
    dialog:
      confirming && spec ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={spec.title}
          description={spec.summary ?? null}
          changes={spec.groups?.map((group) => group.label) ?? []}
          confirmLabel={spec.confirm.label}
          tone={spec.confirm.kind === "destructive" ? "destructive" : "default"}
          onConfirm={() => {
            const result = confirming.run()
            if (!(result instanceof Promise)) return result
            void result.then(settle)
          }}
        />
      ) : null,
    clear: () => setError(null),
  }
}

function menuEntries(items: MenuItem[], runner: ActionRunner): MenuEntry[] {
  return items.flatMap((item): MenuEntry[] => {
    if (!isAction(item)) return "submenu" in item ? [{ heading: item.submenu }, ...menuEntries(item.items, runner)] : [item]
    return [
      {
        label: item.opensDialog || item.confirm ? `${item.label}…` : item.label,
        onSelect: () => runner.run(item),
        icon: item.icon,
        shortcut: item.shortcut,
        destructive: item.kind === "destructive",
        disabled: item.unavailable !== undefined,
      },
    ]
  })
}

function MenuItems({ items, runner }: { items: MenuItem[]; runner: ActionRunner }) {
  return <MenuEntries entries={menuEntries(items, runner)} />
}

function ActionButton({ action, size = "default", runner }: { action: Action; size?: "sm" | "default" | "xs"; runner?: ActionRunner }) {
  const own = useAction()
  const reasonId = useId()
  const kind = action.kind ?? "standard"
  // One primary per view: in a table cell a primary action renders outline.
  const variant = kind === "destructive" ? "destructive" : kind === "primary" && size !== "xs" ? "default" : "outline"
  const Icon = action.icon
  return (
    <>
      <Button
        size={size}
        variant={variant}
        className="shrink-0"
        disabled={action.unavailable !== undefined}
        focusableWhenDisabled
        aria-describedby={action.unavailable ? reasonId : undefined}
        onClick={() => (runner ?? own).run(action)}
      >
        {Icon ? <Icon data-icon="inline-start" aria-hidden="true" /> : null}
        {action.label}
        {action.opensDialog || action.confirm ? "…" : null}
      </Button>
      {action.unavailable ? (
        <span id={reasonId} className="min-w-0 truncate text-xs text-muted-foreground">
          {action.unavailable.reason}
        </span>
      ) : null}
      {runner ? null : (
        <>
          {own.feedback}
          {own.dialog}
        </>
      )}
    </>
  )
}

function RowActions({ name, items, runner }: { name: string; items: MenuItem[]; runner?: ActionRunner }) {
  const m = useMessages()
  const own = useAction()
  if (!items.some(isAction)) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={m.location_more_actions({ name })} />}>
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <MenuItems items={items} runner={runner ?? own} />
        </DropdownMenuContent>
      </DropdownMenu>
      {runner ? null : (
        <>
          {own.feedback}
          {own.dialog}
        </>
      )}
    </>
  )
}

/**
 * @deprecated Pass `toolbar` to DataTable: its FilterBar controls and actions
 * then sit in the toolbar slot the batch bar swaps with. W4 removes this.
 *
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
 * Room a shown SelectionBar takes at the bottom of the pane: its height
 * plus its 8 px float and the gap to its table. Table frames shorten by it
 * and the pane's scroll padding (shell `MainArea`) keeps it clear, so no row
 * hides behind the bar and a focused row scrolls into view above it.
 */
const SELECTION_BAR_VAR = "--selection-bar-h"
const SELECTION_BAR_CLEARANCE_PX = 16

function useReservedBarHeight(bar: RefObject<HTMLElement | null>, shown: boolean) {
  useLayoutEffect(() => {
    const element = bar.current
    if (!shown || !element) return
    const root = document.documentElement
    const apply = () => root.style.setProperty(SELECTION_BAR_VAR, `${element.offsetHeight + SELECTION_BAR_CLEARANCE_PX}px`)
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.style.removeProperty(SELECTION_BAR_VAR)
    }
  }, [bar, shown])
}

/**
 * @deprecated Pass `batchActions` (and `selection.onShowHidden`) to
 * DataTable: its batch bar then replaces the toolbar row in place, at the
 * same height. W4 removes this.
 *
 * Selection summary for multi-select tables (VSEL-FR-06): how many are
 * selected, how many of those are hidden by the current filters, and the
 * bulk actions that apply, with any standing refusal of those actions
 * (`children`) inside the same bar. Render it right after its table and
 * keep it mounted: it takes no room above the rows, so selecting never
 * moves them, and it sticks to the pane's bottom edge while the table runs
 * past it. With nothing selected only an empty live region stays mounted,
 * so the first count is announced too (WCAG 4.1.3).
 */
export function SelectionBar({
  count,
  hiddenByFilters = 0,
  label,
  onShowSelected,
  onClear,
  clearDisabledReason,
  actions,
  children,
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
  /** Why an action is unavailable for this selection, e.g. a `Refusal`; shown under the actions. */
  children?: ReactNode
}) {
  const m = useMessages()
  const clearReasonId = useId()
  const bar = useRef<HTMLDivElement>(null)
  useReservedBarHeight(bar, count > 0)
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
    <div ref={bar} role="region" aria-label={m.selection_region()} className="sticky bottom-2 z-10 rounded-lg bg-background">
      <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/8 px-3 py-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
        {children}
      </div>
    </div>
  )
}
