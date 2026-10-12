/**
 * Row actions (L2; design/R9-COMPOSITION-PLAN.md P2). Every row with actions
 * shows a visible ⋯ button, and its right-click menu holds the same list:
 * one `MenuItem[]` renders both through `MenuItems` (actions.tsx), so the
 * labels, shortcuts, unavailable reasons and order are identical, with
 * destructive actions last after one separator.
 *
 * - `RowActions`: the ⋯ (ghost `icon-sm`, named "Actions for {row}"), in the
 *   Tab order like any button.
 * - `RowContextMenu`: one row outside a DataTable. Right click, long press,
 *   Shift+F10 and the Menu key open the same items; the menu is named after
 *   its row. DataTable renders its own one-per-table context menu with
 *   `MenuItems` (`rowActions`).
 *
 * A row's host runs one `useAction()` runner for both, so a confirm dialog
 * and a refusal belong to the row's host, not to whichever menu opened them:
 *
 *   const runner = useAction()
 *   <RowContextMenu name={rig.name} items={items} runner={runner}>
 *     <li>… <RowActions name={rig.name} items={items} runner={runner} /></li>
 *   </RowContextMenu>
 *   {runner.feedback}{runner.dialog}
 */
import { MoreHorizontal } from "lucide-react"
import type { KeyboardEvent, ReactElement } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { type ActionRunner, hasAction, MenuItems, useAction } from "./actions"
import type { MenuItem } from "./contracts"

export interface RowActionsProps {
  /** The row's name; the button is named "Actions for {name}". */
  name: string
  items: MenuItem[]
  /** The host's runner, shared with the row's context menu. Without one the ⋯ keeps its own and renders its feedback and dialog after itself. */
  runner?: ActionRunner
}

/** The ⋯ of a row. Renders nothing when the row has no action. */
export function RowActions({ runner, ...props }: RowActionsProps) {
  return runner ? <RowActionsView {...props} runner={runner} /> : <OwnRowActions {...props} />
}

function OwnRowActions(props: Omit<RowActionsProps, "runner">) {
  const runner = useAction()
  return (
    <>
      <RowActionsView {...props} runner={runner} />
      {runner.feedback}
      {runner.dialog}
    </>
  )
}

function RowActionsView({ name, items, runner }: Omit<RowActionsProps, "runner"> & { runner: ActionRunner }) {
  const m = useMessages()
  if (!hasAction(items)) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={m.actions_for({ name })} data-row-actions="" />}>
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <MenuItems items={items} runner={runner} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface RowContextMenuProps {
  /** The row's name, the menu's accessible name. */
  name: string
  items: MenuItem[]
  runner: ActionRunner
  /** The row element; it must accept a ref (a DOM element). */
  children: ReactElement
}

/** One row's context menu, with the items of its ⋯. Without an action the row renders as it is. */
export function RowContextMenu({ name, items, runner, children }: RowContextMenuProps) {
  if (!hasAction(items)) return children
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} onKeyDown={openMenuFromKeyboard} />
      <ContextMenuContent aria-label={name}>
        <MenuItems items={items} runner={runner} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ---------------------------------------------------------------------------
// Keyboard and row lookup, shared with DataTable's one-per-table menu
// ---------------------------------------------------------------------------

/** The row a menu opens for: its key, and its name for the menu's accessible name. */
export interface MenuRow {
  key: string
  name: string
}

/** A row's name: its own label, else its row header, else its first link or button, else its text. */
function rowName(row: HTMLElement): string {
  const named = row.hasAttribute("aria-label") ? row : (row.querySelector<HTMLElement>("th[scope=row]") ?? row.querySelector<HTMLElement>("a[href], button:not([role=checkbox])") ?? row)
  const label = named.getAttribute("aria-label")
  if (label) return label
  // Its visible words only: a note's glyph number and screen-reader-only text are no part of the name.
  const words = named.cloneNode(true) as HTMLElement
  for (const extra of words.querySelectorAll(".sr-only, [aria-hidden=true]")) extra.remove()
  return (words.textContent ?? "").replace(/\s+/g, " ").trim()
}

/** The row an event comes from, marked by `keyAttribute` (`data-menu-key`, `data-row-id`); null outside a row. */
export function menuRowAt(target: EventTarget | null, keyAttribute: string): MenuRow | null {
  const row = target instanceof Element ? target.closest<HTMLElement>(`[${keyAttribute}]`) : null
  const key = row?.getAttribute(keyAttribute)
  return row && key != null ? { key, name: rowName(row) } : null
}

/**
 * Shift+F10 or the Menu key on a focused row, or on a control in it such as
 * its ⋯, opens the row's menu (WCAG 2.1.1). macOS browsers fire no
 * `contextmenu` for either, so the focused element gets one at its
 * lower-left corner: the menu opens anchored there, through the same path as
 * a right click. With `keyAttribute` the element must sit in a row marked by
 * it; without, in the element that handles the event (keys pressed in an open
 * menu, which React bubbles through its portal, are not the row's).
 */
export function openMenuFromKeyboard(event: KeyboardEvent, keyAttribute?: string): void {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const inRow = keyAttribute === undefined ? event.currentTarget instanceof Node && event.currentTarget.contains(target) : target.closest(`[${keyAttribute}]`) !== null
  if (!inRow) return
  event.preventDefault()
  const box = target.getBoundingClientRect()
  target.dispatchEvent(new globalThis.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom }))
}
