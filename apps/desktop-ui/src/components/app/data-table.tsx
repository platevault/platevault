/**
 * Dense data table (foundation-owned, plan P4) on native table semantics,
 * drawn with the `components/ui/table` parts.
 *
 * - Sorting: a column sorts by its `sortValue` unless it is `static` (row
 *   actions, a thumbnail). The header is a borderless button with
 *   `aria-sort`; only the active column shows its arrow, and the arrow's room
 *   is kept so sorting never moves a header. Null values sort last. The sort
 *   is the table's own (`initialSort`) or the host's (`sort`, `onSortChange`),
 *   and `sortRows` orders rows exactly as the table shows them.
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
 *   and refusals. With `primaryRowActionIcon` the inline action shows its
 *   icon alone, named by its tooltip, so a wide table keeps to its frame.
 * - Expand (`expand`): a disclosure in the first cell opens the row's detail
 *   in a row under it, one level deep (a nested DataTable, a KeyValueList).
 * - Keyboard (P-KBD1): a table whose rows act (selection, row actions, click
 *   to act, a primary action or expand) is one Tab stop, on its current row:
 *   Tab then visits that row's own controls (checkbox, disclosure, links,
 *   inline action, ⋯) and leaves the table; the other rows and their controls
 *   are out of the Tab order. Tab comes back to the row focused last, else
 *   the open row (`activeRowId`), else the first; a click on a row or its
 *   control makes it current. On the row, ↑/↓ move a row (across groups,
 *   no wrap), Home/End go to the first or last row, Page Up/Down move one
 *   screen, Space selects it (a single-key shortcut: off with the switch),
 *   Enter opens it (`onRowClick`, else the primary row action), and Shift+F10
 *   or the Menu key opens its menu. On a control, ↑/↓ move to the same
 *   column's control in the adjacent row; fields keep their keys. Closing the
 *   row's menu or a dialog it opened returns focus to the row (the ⋯ menu to
 *   the ⋯); when an action removes the row, focus moves to the next row, else
 *   the previous one. An expanded row's nested table is one stop of its own.
 *   Native table semantics stay: no grid role. Row height and cell padding
 *   follow the row tokens `--row-h` and `--row-py`.
 * - Grouping (opt-in `groups`): group header rows inside this one table, so
 *   every group shares the column widths and the pinned header row.
 * - Pinned first column (opt-in `stickyFirstColumn`): the selection column
 *   and the first column stay in view while a wide table scrolls sideways,
 *   and so does the row-actions column at the right edge. A soft shade on a
 *   pinned column's inner edge shows content hidden on that side.
 * - Truncation (`truncate` columns): a cell cuts its text with an ellipsis
 *   and shows it in full on hover while it is cut. Its text has no
 *   min-content width, so a frame too narrow for every column's text shrinks
 *   the truncated columns, each in proportion to its width, while the others
 *   keep theirs: the table stays inside its frame wherever the untruncated
 *   columns fit. A `truncateMin` column shrinks no further than its floor
 *   (`name`: a typical record name); past it the table scrolls sideways.
 * - Columns menu (opt-in `hideable` columns): "Columns ▾" in the toolbar
 *   row lists a checkbox per hideable column; `defaultHidden` ones start
 *   hidden. The row header, the selection and the row actions always show
 *   and are not listed. With `columnsId` the choice is kept per table across
 *   reloads (column-choice.ts).
 * - Click to act (opt-in `onRowClick`): a click on the row outside its
 *   controls (links, buttons, inputs, menus) runs the row's primary action,
 *   as does Enter on the row. Controls keep their own action.
 * - Hover: a row that acts (click to act, or a primary row action) tints
 *   under the pointer; a row that does nothing on click stays still.
 */
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, X } from "lucide-react"
import {
  createContext,
  type FocusEvent,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { getPreferences, useMessages } from "@/app/preferences"
import { useStatusSelection } from "./status-selection"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ActionBar, ActionButton, type ActionRunner, isAction, MenuItems, useAction } from "./actions"
import { isColumnHideable, isColumnShown, useColumnChoice } from "./column-choice"
import type { Action, Column, MenuItem } from "./contracts"
import { titleWhenCut } from "./cut-title"
import { FilterChips } from "./data"
import { ActionError } from "./feedback"
import { DisplayMenu } from "./display-menu"
import { type FilterBarProps, FilterControls, TOOLBAR_ROW, useFacetChips } from "./filter-bar"
import { type MenuRow, menuRowAt, openMenuFromKeyboard, RowActions } from "./row-actions"

/** Controls inside a row that keep their own click; a click on them never runs `onRowClick`. */
const ROW_CONTROLS = "a[href], button, input, select, textarea, label, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=combobox], [role=menuitem], [role=option], [contenteditable=true]"

/** What takes focus in a row or its detail: the controls a column renders and the table's own (checkbox, disclosure, inline action, ⋯). */
const ROW_FOCUSABLE = ["a[href]", "button", "input", "select", "textarea", "summary", "iframe", "[tabindex]", "[contenteditable=true]"].map((selector) => `:scope > tbody ${selector}`).join(", ")
/** A control out of the Tab order keeps its own tabindex here ("" for none), to get it back when its row is current again. */
const OWN_TABINDEX = "data-own-tabindex"

/** False inside the detail of a row that is not its table's current row: a nested table there takes no Tab stop. */
const InCurrentRow = createContext(true)

/** Puts a row's control in the Tab order or takes it out, keeping the tabindex it had. */
function setTabbable(control: HTMLElement, tabbable: boolean) {
  const own = control.getAttribute(OWN_TABINDEX)
  if (tabbable) {
    if (own === null) return
    if (own === "") control.removeAttribute("tabindex")
    else control.setAttribute("tabindex", own)
    control.removeAttribute(OWN_TABINDEX)
    return
  }
  const now = control.getAttribute("tabindex")
  if (own !== null && now === "-1") return
  // A first pass, or a re-render that wrote the control's own tabindex again: keep that one.
  control.setAttribute(OWN_TABINDEX, now ?? "")
  control.setAttribute("tabindex", "-1")
}

/** The row after `id` in `order` that is still shown, else the one before it: where focus goes when its row goes (APG). */
function successorOf(order: readonly string[], id: string, shown: (id: string) => boolean): string | null {
  const at = order.indexOf(id)
  if (at < 0) return null
  return order.slice(at + 1).find(shown) ?? order.slice(0, at).reverse().find(shown) ?? null
}

/** Whether focus went nowhere: its element was removed, or nothing has it. */
function focusLost(): boolean {
  return document.activeElement === null || document.activeElement === document.body
}

export interface DataTableSelection<T> {
  selected: string[]
  onChange: (ids: string[]) => void
  /** Accessible name fragment for the row checkbox, e.g. the session name. */
  rowLabel: (row: T) => string
  isSelectable?: (row: T) => boolean
  /** The count as one complete message, when the noun must agree ("3 sessões selecionadas", "12 sessions in the run"); default "3 selected" ("12 included" in membership). */
  countLabel?: (count: number) => string
  /** Shows the selected rows the filters hide (clears the filters, or picks a "Selected" facet); the batch bar or the membership line offers it as Show. */
  onShowHidden?: () => void
  /**
   * The selection is the data (a run's sessions, §5.4): the toolbar row stays, no batch bar replaces it and
   * `batchActions` are not shown. A line under the toolbar row counts the members and the ones the filters hide.
   */
  membership?: boolean
}

export interface DataTableGrouping<T> {
  /** Group of a row, e.g. its observing night. */
  key: (row: T) => string
  /** Group header content, e.g. "Thu 30 Sep · 3 sessions"; `rows` are the group's rows. */
  label: (key: string, rows: T[]) => ReactNode
  /** Order of groups by key; default ascending (`localeCompare`). */
  compare?: (a: string, b: string) => number
}

/** A table's sort: one column, ascending or descending. */
export interface TableSort {
  columnId: string
  direction: "asc" | "desc"
}

/**
 * The rows in the order a DataTable with this sort shows them (groups aside): by the column's
 * `sortValue`, nulls last in either direction; unchanged for no sort, a static column or one without a value.
 */
export function sortRows<T>(rows: T[], columns: readonly Column<T>[], sort: TableSort | null): T[] {
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
}

/**
 * One labelled single choice in the toolbar that is not a filter: no "All" and no chip. Its trigger reads
 * "Destination: Archive NAS ▾"; Archive's destination is the case.
 */
export interface DataTableToolbarSelect {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}

/** The toolbar slot's content: the FilterBar controls, then the select and the toolbar actions. `matchCount` defaults to the rows shown. */
export interface DataTableToolbar extends FilterBarProps {
  select?: DataTableToolbarSelect
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
  columns: Column<T>[]
  getRowId: (row: T) => string
  selection?: DataTableSelection<T>
  /** The first sort of an uncontrolled table. */
  initialSort?: TableSort
  /** A controlled sort (null: unsorted): the host keeps it and gets each header click through `onSortChange`. */
  sort?: TableSort | null
  onSortChange?: (sort: TableSort) => void
  /** Shown instead of the body when there are no rows. */
  empty?: ReactNode
  loading?: boolean
  /** The rows could not load: the body shows the error with Retry. */
  error?: { message: string; onRetry: () => void }
  /** The row whose detail is open; marked `aria-current`. */
  activeRowId?: string | null
  rowClassName?: (row: T) => string | undefined
  className?: string
  /**
   * "frame" (default) scrolls long tables inside their frame with a pinned header; "none" grows with content;
   * "fill" makes the table take the rest of a flex-column parent (a template body) and scroll inside it, with
   * the header row pinned and the toolbar row fixed above it.
   */
  scroll?: "frame" | "none" | "fill"
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
  /** The row's primary action (open, select): a click outside the row's controls, or Enter on the focused row. */
  onRowClick?: (row: T) => void
  /** The toolbar slot above the table; the batch bar replaces it while rows are selected. */
  toolbar?: DataTableToolbar
  /**
   * Actions on the whole selection, the rows the filters hide included; shown in the batch bar (three inline, the
   * rest under More, where a submenu such as "Add to Project ▸" goes after them).
   */
  batchActions?: (selectedIds: string[]) => MenuItem[]
  /**
   * The key the Columns menu's choice is kept under across reloads ("targets"); one per table. Without it the
   * choice lasts while the table is mounted.
   */
  columnsId?: string
}

/** Row actions and expand name each row, so `rowLabel` comes with them. */
type DataTableRowProps<T> =
  | { rowLabel?: undefined; rowActions?: undefined; primaryRowAction?: undefined; primaryRowActionIcon?: undefined; expand?: undefined }
  | {
      /** The row's name ("30 Sep OIII"): it names the row's ⋯ menu, its context menu and its disclosure. */
      rowLabel: (row: T) => string
      /** The row's ⋯ menu; right click, Shift+F10 and the Menu key open the same items. */
      rowActions?: (row: T) => MenuItem[]
      /** At most one inline action beside the ⋯ ("Make default"); null where it does not apply. */
      primaryRowAction?: (row: T) => Action | null
      /** Show the inline action as its icon alone (ActionButton `iconOnly`), where the table must fit its frame. */
      primaryRowActionIcon?: boolean
      expand?: DataTableExpand<T>
    }

export type DataTableProps<T> = DataTableBaseProps<T> & DataTableRowProps<T>

/** What the toolbar slot moves focus to after a swap took the focused control away. */
const SLOT_FOCUSABLE = "button:not([disabled]), input:not([disabled]), [role=checkbox], [tabindex]:not([tabindex='-1'])"

/** The floors of `truncateMin` columns: the 4 px step at or above the widest demo values, "Astro-T7 calibration" 121 px and "Ainda não indexado" 119 px. */
const TRUNCATE_MIN = { name: "min-w-31", date: "min-w-30" } as const

/**
 * The scroll-edge cue of a pinned column: a shade of the scrim colour fading
 * past its inner edge, shown while the frame hides content on that side.
 */
const EDGE_CUE = "after:pointer-events-none after:absolute after:inset-y-0 after:w-2 after:to-transparent after:opacity-0 motion-safe:after:transition-opacity after:from-(--scrim)"
const EDGE_CUE_START = cn(EDGE_CUE, "after:left-full after:bg-linear-to-r group-data-[scroll-start=true]/frame:after:opacity-100")
const EDGE_CUE_END = cn(EDGE_CUE, "after:right-full after:bg-linear-to-l group-data-[scroll-end=true]/frame:after:opacity-100")

/**
 * A truncated cell's content. The grid's one `minmax(0, 1fr)` track gives it no min-content width, so under
 * the table's auto layout a truncated column can give up width down to its header's, while every other
 * column keeps its content width; the cell's `max-w-*` still caps how wide it grows. When the frame is too
 * narrow, the truncated columns share what the other columns leave, each in proportion to its own width,
 * and cut their text with the full text on hover (T2). A `min` floor stops the column shrinking below it,
 * so the table scrolls sideways instead.
 */
function Truncated({ min, children }: { min?: keyof typeof TRUNCATE_MIN; children: ReactNode }) {
  return (
    <div className={cn("grid grid-cols-1", min && TRUNCATE_MIN[min])}>
      <div className="truncate" onPointerEnter={titleWhenCut}>
        {children}
      </div>
    </div>
  )
}

export function DataTable<T>({
  label,
  rows,
  columns: allColumns,
  columnsId,
  getRowId,
  selection,
  initialSort,
  sort: controlledSort,
  onSortChange,
  empty,
  loading,
  error,
  activeRowId,
  rowClassName,
  className,
  scroll = "frame",
  groups,
  stickyFirstColumn = false,
  onRowClick,
  toolbar,
  batchActions,
  rowLabel,
  rowActions,
  primaryRowAction,
  primaryRowActionIcon = false,
  expand,
}: DataTableProps<T>) {
  const m = useMessages()
  const baseId = useId()
  const tableRef = useRef<HTMLTableElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const lastPinnedHeader = useRef<HTMLTableCellElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const slotHadFocus = useRef(false)
  // The rows as last committed, and the order before that, so the row after a removed one can be found.
  const shownOrder = useRef<{ now: string[]; before: string[] }>({ now: [], before: [] })

  /** This table's data rows in order, across groups; a nested table's rows are its own. */
  const ownRows = () => Array.from(tableRef.current?.querySelectorAll<HTMLElement>(":scope > tbody > tr[data-row]") ?? [])
  const rowElement = (id: string) => ownRows().find((row) => row.dataset.row === id) ?? null
  /** The row, or the one that took its place when it went: the next row, else the previous one. */
  const rowOrSuccessor = (id: string): HTMLElement | null => {
    const present = rowElement(id)
    if (present) return present
    const { now, before } = shownOrder.current
    const next = successorOf(now.includes(id) ? now : before, id, (other) => rowElement(other) !== null)
    return next === null ? null : rowElement(next)
  }

  // One runner for the table: the batch bar, the toolbar actions, every row's ⋯ and the context menu.
  // A confirmed batch action usually empties the selection, which takes its own trigger away; focus then
  // goes to the first control of the toolbar row. Cancel and Escape return focus to the button that opened
  // the confirmation, or to the first control of the batch bar (or toolbar row) when that button is gone (WCAG 2.4.3).
  // A row's action returns focus to what ran it (the row, its ⋯ or its inline action), or when the action
  // removed the row, to the row that took its place (P-KBD1).
  const slotFirst = () => slot.current?.querySelector<HTMLElement>(SLOT_FOCUSABLE)
  const origin = useRef<{ id: string; opener: HTMLElement | undefined } | null>(null)
  const afterAction = () => {
    const from = origin.current
    if (from === null) return slotFirst()
    return (from.opener?.isConnected ? from.opener : rowOrSuccessor(from.id)) ?? slotFirst()
  }
  const actions = useAction({ focusAfterConfirm: afterAction, focusAfterCancel: afterAction })
  const runner: ActionRunner = {
    ...actions,
    run: (action, opener) => {
      origin.current = null
      actions.run(action, opener)
    },
  }
  /** The runner for one row's actions; `opener` names what ran them when the trigger passes none (a menu item). */
  const rowRunner = (id: string, opener: () => HTMLElement | null | undefined): ActionRunner => ({
    ...actions,
    run: (action, from) => {
      const element = from ?? opener() ?? undefined
      origin.current = { id, opener: element }
      actions.run(action, element)
    },
  })

  const [ownSort, setOwnSort] = useState(initialSort ?? null)
  const sort = controlledSort === undefined ? ownSort : controlledSort
  const [menuTarget, setMenuTarget] = useState<MenuRow | null>(null)
  const [expanded, setExpanded] = useState(() => new Set(expand?.defaultExpanded ?? []))
  // P-KBD1: the row focused last, while the open row stays the one it was then.
  const [focusedRow, setFocusedRow] = useState<{ id: string; activeRowId: string | null | undefined } | null>(null)
  const rowsHadFocus = useRef(false)
  const inCurrentRow = useContext(InCurrentRow)
  const selectedCount = selection?.selected.length ?? 0
  const membership = selection?.membership === true
  // Members are data, not a selection to act on: the status bar does not count them.
  useStatusSelection(membership ? 0 : selectedCount)
  const [columnChoice, setColumnShown] = useColumnChoice(columnsId)
  // Sorting reads every column, so a sort on a column the user hid keeps the order it gave.
  const columns = allColumns.filter((column) => isColumnShown(column, columnChoice))
  const hideable = allColumns.filter(isColumnHideable)
  const columnsMenu =
    hideable.length > 0 ? (
      <DisplayMenu
        label={m.display_menu_columns()}
        groups={[{ kind: "columns", id: "columns", columns: hideable.map((column) => ({ id: column.id, label: column.header, checked: isColumnShown(column, columnChoice) })), onChange: setColumnShown }]}
      />
    ) : null

  const hasSlot = toolbar !== undefined || membership || (selection !== undefined && batchActions !== undefined) || columnsMenu !== null
  const batchShown = hasSlot && !membership && selectedCount > 0
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

  // Which sides of a pinned table hide scrolled content: `data-scroll-start`
  // and `data-scroll-end` on the frame show the pinned columns' edge cues
  // (overlay scrollbars stay hidden until a scroll). Set on the element, so
  // scrolling never re-renders the table.
  useLayoutEffect(() => {
    const container = frame.current
    const table = tableRef.current
    if (!stickyFirstColumn || !container || !table) return
    const update = () => {
      const end = container.scrollWidth - container.clientWidth
      container.dataset.scrollStart = String(container.scrollLeft > 0)
      container.dataset.scrollEnd = String(container.scrollLeft < end - 1)
    }
    update()
    container.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(table)
    return () => {
      container.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [stickyFirstColumn])

  // The batch bar and the toolbar row swap in place. When the swap removed the
  // focused control (Clear selection, a batch action that empties the
  // selection), focus goes to the first control of what took its place.
  useLayoutEffect(() => {
    const active = document.activeElement
    if (!slotHadFocus.current || (active !== null && active !== document.body)) return
    slot.current?.querySelector<HTMLElement>(SLOT_FOCUSABLE)?.focus()
  }, [batchShown])

  const sorted = useMemo(() => sortRows(rows, allColumns, sort), [rows, allColumns, sort])

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

  // P-KBD1: a table whose rows act is one Tab stop, on its current row: the row focused last while the
  // open row stays the same, else the open row, else the first.
  const roving = selection !== undefined || rowActions !== undefined || onRowClick !== undefined || primaryRowAction !== undefined || expand !== undefined
  const shownIds = bodies.flatMap((body) => body.rows.map(getRowId))
  const shownKey = shownIds.join("\n")
  const remembered = focusedRow !== null && focusedRow.activeRowId === activeRowId && shownIds.includes(focusedRow.id) ? focusedRow.id : null
  const currentRowId = roving ? (remembered ?? (activeRowId != null && shownIds.includes(activeRowId) ? activeRowId : (shownIds[0] ?? null))) : null

  useLayoutEffect(() => {
    shownOrder.current = { now: shownIds, before: shownOrder.current.now }
  }, [shownKey])

  // When the current row goes (an action removed it, a filter hid it), the next row takes its place, else
  // the previous one, and takes focus when focus went with the row (APG). A new open row from the host wins.
  // With no row left, focus goes to the first control of the toolbar row, as after a batch action (WCAG 2.4.3).
  const committed = useRef<{ row: string | null; activeRowId: string | null | undefined }>({ row: null, activeRowId })
  useLayoutEffect(() => {
    const previous = committed.current
    committed.current = { row: currentRowId, activeRowId }
    if (previous.row === null || shownIds.includes(previous.row)) return
    const next = previous.activeRowId !== activeRowId && currentRowId !== null ? rowElement(currentRowId) : rowOrSuccessor(previous.row)
    const id = next?.dataset.row
    if (next === null) {
      if (rowsHadFocus.current && focusLost()) slotFirst()?.focus()
      return
    }
    if (id === undefined) return
    if (id !== currentRowId) setFocusedRow({ id, activeRowId })
    if (rowsHadFocus.current && focusLost()) next.focus()
  })

  // Only the current row's controls, and those of its detail, stay in the Tab order; a nested table's rows are its own.
  useLayoutEffect(() => {
    for (const control of tableRef.current?.querySelectorAll<HTMLElement>(ROW_FOCUSABLE) ?? []) {
      const row = ownerRow(control)
      const inner = control.closest("tr[data-row]")
      if (row === null || control === row || (inner !== null && inner !== row)) continue
      setTabbable(control, inCurrentRow && (!roving || row.dataset.row === currentRowId))
    }
  })

  /** The data row an element in the body belongs to: its own row, or the row whose detail holds it. */
  function ownerRow(element: Element): HTMLElement | null {
    let row = element.closest<HTMLElement>("tr")
    while (row !== null && row.parentElement?.parentElement !== tableRef.current) row = row.parentElement?.closest<HTMLElement>("tr") ?? null
    if (row === null || row.parentElement?.tagName !== "TBODY") return null
    const owner = row.hasAttribute("data-row-detail") ? row.previousElementSibling : row
    return owner instanceof HTMLElement && owner.hasAttribute("data-row") ? owner : null
  }

  /** A click or focus on a row, or on anything in it, makes that row current (APG). */
  function makeCurrent(target: EventTarget) {
    const id = target instanceof Element ? ownerRow(target)?.dataset.row : undefined
    if (id !== undefined && id !== currentRowId) setFocusedRow({ id, activeRowId })
  }

  const rowFocus = {
    onFocus: (event: FocusEvent<HTMLTableSectionElement>) => {
      rowsHadFocus.current = true
      makeCurrent(event.target)
    },
    onBlur: (event: FocusEvent<HTMLTableSectionElement>) => {
      // Focus that moved somewhere else; a row removed with focus in it blurs to nothing.
      if (event.relatedTarget !== null && !tableRef.current?.contains(event.relatedTarget)) rowsHadFocus.current = false
    },
    // WebKit does not focus a button it clicks.
    onPointerDown: (event: PointerEvent<HTMLTableSectionElement>) => makeCurrent(event.target),
  }

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

  /** The rows one screen of the frame holds (of the window, for a table that does not scroll), under the pinned header. */
  function rowsPerPage(row: HTMLElement): number {
    const screen = scroll === "none" ? window.innerHeight : (frame.current?.clientHeight ?? 0)
    const header = tableRef.current?.tHead?.offsetHeight ?? 0
    return row.offsetHeight > 0 ? Math.max(1, Math.floor((screen - header) / row.offsetHeight)) : 1
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableSectionElement>) {
    // A nested table (an expanded row's detail), or the row itself, handled the key already.
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>("tr[data-row]")
    if (!row || row.parentElement?.parentElement !== tableRef.current) return
    // Data rows of the whole table, so the keys also cross group boundaries.
    const rows = ownRows()
    const at = rows.indexOf(row)
    if (target === row) {
      if (event.shiftKey) return
      const page = event.key === "PageDown" || event.key === "PageUp" ? rowsPerPage(row) : 0
      const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1, PageDown: at + page, PageUp: at - page }
      const to: number | undefined = moves[event.key]
      if (to === undefined) return
      event.preventDefault()
      rows[Math.min(rows.length - 1, Math.max(0, to))]?.focus()
      return
    }
    // On a control, ↑/↓ move to the same column's control in the adjacent row; fields, menus and lists keep their arrows.
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    if (target.closest("input, textarea, select, [role=listbox], [role=menu]") && target.tagName !== "BUTTON") return
    const cell = target.closest("td, th")
    const sibling = rows[at + (event.key === "ArrowDown" ? 1 : -1)]
    if (!cell || !sibling) return
    const index = Array.from(row.children).indexOf(cell)
    const focusable = "a[href], button:not([disabled]), [role=checkbox], input:not([disabled])"
    const next = sibling.children[index]?.querySelector<HTMLElement>(focusable) ?? sibling.querySelector<HTMLElement>(focusable) ?? (roving ? sibling : null)
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
  /** Enter on the row opens it (`onRowClick`, else its primary action); Space selects it. Its controls keep both keys. */
  const rowKey = (row: T, id: string, primary: Action | null, canSelect: boolean, isSelected: boolean) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const element = event.currentTarget
    if (event.key === "Enter" && (onRowClick || primary)) {
      event.preventDefault()
      if (onRowClick) onRowClick(row)
      else if (primary) rowRunner(id, () => element).run(primary, element)
    } else if (event.key === " " && selection && getPreferences().singleKeyShortcuts) {
      // A single-key shortcut (WCAG 2.1.4): the switch turns it off with the app's others.
      event.preventDefault()
      if (canSelect) toggleRow(id, !isSelected)
    }
  }

  const hasRowActions = rowActions !== undefined || primaryRowAction !== undefined
  const nameOf = (row: T) => rowLabel?.(row) ?? selection?.rowLabel(row) ?? getRowId(row)
  const columnCount = columns.length + (selection ? 1 : 0) + (hasRowActions ? 1 : 0)
  // Pinned cells are opaque (card plus the row's tint, `--row-bg`) and sit
  // under the sticky header (z-10). The last pinned cell draws the edge, and
  // a soft shade past it while content is scrolled away under it (the
  // frame's `data-scroll-start`); the row-actions column mirrors it
  // (`data-scroll-end`).
  const pinned = (position: "first" | "only" | "last", head = false) =>
    stickyFirstColumn
      ? cn(
          "sticky",
          head ? "bg-card" : "z-1 bg-card [background-image:linear-gradient(var(--row-bg),var(--row-bg))]",
          position === "last" ? "left-10" : "left-0",
          position !== "first" && "shadow-[inset_-1px_0_0_var(--border)]",
          position !== "first" && EDGE_CUE_START,
          !head && position !== "last" && "group-aria-[current=true]/row:shadow-[inset_2px_0_0_var(--primary)]",
          !head && position === "only" && "group-aria-[current=true]/row:shadow-[inset_2px_0_0_var(--primary),inset_-1px_0_0_var(--border)]",
        )
      : undefined
  const pinnedEnd = (head = false) =>
    stickyFirstColumn
      ? cn("sticky right-0 shadow-[inset_1px_0_0_var(--border)]", EDGE_CUE_END, head ? "bg-card" : "z-1 bg-card [background-image:linear-gradient(var(--row-bg),var(--row-bg))]")
      : undefined
  const columnPin = selection ? "last" : "only"

  const menuEnabled = rowActions !== undefined
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
  const menuItems =
    menuRow === undefined || menuTarget === null || !rowActions ? null : <MenuItems items={rowActions(menuRow)} runner={rowRunner(menuTarget.key, () => rowElement(menuTarget.key))} />
  // Closing the row's menu returns focus to the row, or to the row that took its place when an item removed it.
  const menuFinalFocus = () => (menuTarget === null ? null : rowOrSuccessor(menuTarget.key)) ?? true
  const frameClass = cn(
    // The frame is the scroll container in both axes so the header row
    // stays pinned while long tables scroll inside it. Scroll padding the
    // height of that header keeps a focused row out from under it (WCAG 2.4.11).
    "relative scroll-pt-[calc(var(--row-h)+1px)] overflow-auto rounded-md border bg-background",
    stickyFirstColumn && "group/frame scroll-pl-(--pinned-w) bg-card",
    scroll === "frame" && "max-h-[calc(100dvh-14rem)]",
    scroll === "fill" && "min-h-0 flex-1",
    className,
  )

  const sortHeader = (column: Column<T>, active: boolean, direction: "asc" | "desc") => {
    const Arrow = active && direction === "desc" ? ArrowDown : ArrowUp
    return (
      <button
        type="button"
        className={cn("group/sort inline-flex h-6 items-center gap-1 rounded-sm hover:text-foreground", column.align === "right" && "flex-row-reverse", active && "text-foreground")}
        onClick={() => {
          const next: TableSort = sort?.columnId === column.id ? { columnId: column.id, direction: sort.direction === "asc" ? "desc" : "asc" } : { columnId: column.id, direction: "asc" }
          if (controlledSort === undefined) setOwnSort(next)
          onSortChange?.(next)
        }}
      >
        {column.header}
        {/* Only the active column shows its arrow; the others keep its room, and hint it on hover and focus. */}
        <Arrow aria-hidden="true" className={cn("size-3", !active && "opacity-0 group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50")} />
      </button>
    )
  }

  const table = (
    <Table
      ref={tableRef}
      onContextMenu={menuEnabled ? onContextMenu : undefined}
      onKeyDown={menuEnabled ? (event) => !event.defaultPrevented && openMenuFromKeyboard(event, "data-row-id") : undefined}
    >
      <TableCaption>{loading ? m.table_loading({ name: label }) : label}</TableCaption>
      <TableHeader>
        <tr>
          {selection ? (
            <TableHead data-column-kind="selection" className={cn("w-10", pinned("first", true))}>
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
                // The census counts unmarked headers as data columns, which must all sort (P4).
                data-column-kind={column.static ? "static" : undefined}
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
            <TableHead data-column-kind="action" className={cn("w-px", pinnedEnd(true))}>
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
          <TableBody key={body.key ?? "rows"} onKeyDown={onKeyDown} {...(roving ? rowFocus : {})}>
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
                    data-row={id}
                    data-row-id={menuEnabled ? id : undefined}
                    data-alt={rowIndex % 2 === 1 || undefined}
                    data-selected={isSelected || undefined}
                    aria-current={activeRowId === id ? "true" : undefined}
                    // A row that acts (click to act, or a primary action) tints under the pointer; the others stay still.
                    interactive={onRowClick !== undefined || primary !== null}
                    tabIndex={roving ? (inCurrentRow && id === currentRowId ? 0 : -1) : undefined}
                    onClick={onRowClick ? rowClick(row) : undefined}
                    onKeyDown={roving ? rowKey(row, id, primary, canSelect, isSelected) : undefined}
                    className={cn(roving && "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", rowClassName?.(row))}
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
                      const content = column.truncate ? <Truncated min={column.truncateMin}>{column.cell(row)}</Truncated> : column.cell(row)
                      const disclosure = columnIndex === 0 && expand !== undefined
                      return (
                        <TableCell
                          key={column.id}
                          rowHeader={column.rowHeader}
                          // The disclosure's own name stays out of the row header's name ("Details for … 30 Sep").
                          aria-label={disclosure && column.rowHeader ? nameOf(row) : undefined}
                          className={cn(
                            column.truncate ? "max-w-72" : "whitespace-nowrap",
                            column.align === "right" && "text-right",
                            column.className,
                            columnIndex === 0 && pinned(columnPin),
                          )}
                        >
                          {disclosure ? (
                            <div className="flex min-w-0 items-center gap-1">
                              {canExpand ? (
                                <Button
                                  size="icon-sm"
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
                              <div className="min-w-0">{content}</div>
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
                          {primary ? <ActionButton action={primary} size="xs" iconOnly={primaryRowActionIcon} runner={rowRunner(id, () => rowElement(id))} /> : null}
                          {rowActions ? <RowActions name={nameOf(row)} items={rowActions(row)} runner={rowRunner(id, () => rowElement(id)?.querySelector<HTMLElement>("[data-row-actions]"))} /> : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                  {isExpanded ? (
                    <TableRow kind="detail" data-row-detail="">
                      <td id={detailId} colSpan={columnCount} className="px-3 py-2">
                        <InCurrentRow.Provider value={inCurrentRow && (!roving || id === currentRowId)}>{expand.render(row)}</InCurrentRow.Provider>
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
      <ContextMenuContent aria-label={menuRow === undefined ? undefined : nameOf(menuRow)} finalFocus={menuFinalFocus}>
        {menuItems}
      </ContextMenuContent>
    </ContextMenu>
  )
  if (!hasSlot) {
    return (
      <>
        {/* A refused or failed row action shows above the table it came from. */}
        {runner.feedback}
        {framed}
        {runner.dialog}
      </>
    )
  }

  const hidden = selection ? selection.selected.length - shownSelectedOf(rows, getRowId, selectedSet) : 0
  const countLabel =
    selection?.countLabel?.(selectedCount) ??
    (membership ? m.table_membership_count({ count: selectedCount, n: formatCount(selectedCount) }) : m.table_selected_count({ count: selectedCount, n: formatCount(selectedCount) }))
  return (
    <div className={scroll === "fill" ? "flex min-h-0 flex-1 flex-col gap-1.5" : "space-y-1.5"}>
      <div
        ref={slot}
        className={cn("flex min-w-0 shrink-0 items-center gap-2", TOOLBAR_ROW)}
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
            items={batchActions?.(selection.selected) ?? []}
            runner={runner}
          />
        ) : toolbar ? (
          <>
            <FilterControls {...toolbar} />
            {columnsMenu || toolbar.select || (toolbar.actions && toolbar.actions.length > 0) ? (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {columnsMenu}
                {toolbar.select ? <ToolbarSelect {...toolbar.select} /> : null}
                {toolbar.actions && toolbar.actions.length > 0 ? <ActionBar actions={toolbar.actions} runner={runner} /> : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">{m.table_row_count({ count: rows.length, n: formatCount(rows.length) })}</span>
            {columnsMenu ? <div className="ml-auto flex shrink-0 items-center">{columnsMenu}</div> : null}
          </>
        )}
        <span className="sr-only" aria-live="polite">
          {batchShown ? countLabel : null}
        </span>
      </div>
      {membership && selection ? <MembershipLine countLabel={countLabel} hidden={hidden} onShowHidden={selection.onShowHidden} /> : null}
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

/** The toolbar's one labelled choice: "Destination: Archive NAS ▾" with a radio list; picking closes it. */
function ToolbarSelect({ label, value, options, onChange, disabled = false }: DataTableToolbarSelect) {
  const m = useMessages()
  const chosen = options.find((option) => option.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} render={<Button size="sm" variant="outline" className="shrink-0" />}>
        {chosen ? m.filter_bar_facet_value({ label, value: chosen.label }) : label}
        <ChevronDown data-icon="inline-end" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Membership mode's count line under the toolbar row: "12 sessions in the run · 2 hidden by filters [Show]". Always shown, so a change moves nothing. */
function MembershipLine({ countLabel, hidden, onShowHidden }: { countLabel: string; hidden: number; onShowHidden?: () => void }) {
  const m = useMessages()
  return (
    <div data-membership="" className="flex h-6 shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <span aria-live="polite" className="font-medium text-foreground tabular-nums">
        {countLabel}
      </span>
      {hidden > 0 ? (
        <>
          <span className="truncate">· {m.table_selection_hidden({ count: hidden, n: formatCount(hidden) })}</span>
          {onShowHidden ? (
            <Button size="xs" variant="ghost" onClick={onShowHidden}>
              {m.table_selection_show()}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** The toolbar row while rows are selected: the count, what the filters hide, the batch actions and Clear selection. */
function BatchBar({
  countLabel,
  hidden,
  onShowHidden,
  onClear,
  items,
  runner,
}: {
  countLabel: string
  hidden: number
  onShowHidden?: () => void
  onClear: () => void
  items: MenuItem[]
  runner: ActionRunner
}) {
  const m = useMessages()
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
      {/* ActionBar keeps one primary and three standard inline and the rest under More, so the bar stays one row. */}
      <div className="ml-auto min-w-0">
        <ActionBar actions={items.filter(isAction)} overflow={items.filter((item) => !isAction(item))} runner={runner} />
      </div>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={onClear}>
        <X data-icon="inline-start" aria-hidden="true" />
        {m.selection_clear()}
      </Button>
    </div>
  )
}
