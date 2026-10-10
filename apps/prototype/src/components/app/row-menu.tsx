/**
 * Context-menu helpers (foundation primitives), so right-click works on
 * every list the same way. A menu is a list of `MenuEntry` values; every
 * item must also be reachable from the row itself.
 *
 * - DataTable: return entries from `contextMenu={(row) => [...]}`.
 * - One row: `<RowContextMenu entries={[...]}>{<li>…</li>}</RowContextMenu>`.
 * - A long list (one menu for all rows): wrap it in
 *   `<ContextMenuArea menu={(key) => [...]}>` and spread `menuKey(id)` on
 *   each row. Outside a row the browser's own menu stays.
 *
 * Right click, long press, Shift+F10 and the Menu key open it; the menu is
 * named after its row.
 */
import type { LucideIcon } from "lucide-react"
import { Fragment, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, useState } from "react"
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"

type MenuItemEntry = { label: string; onSelect: () => void; icon?: LucideIcon; shortcut?: string; destructive?: boolean; disabled?: boolean }

export type MenuEntry = MenuItemEntry | { separator: true } | { heading: string }

function MenuItemView({ entry }: { entry: MenuItemEntry }) {
  const Icon = entry.icon
  return (
    <ContextMenuItem disabled={entry.disabled} onClick={entry.onSelect} className={cn(entry.destructive && "text-destructive")}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {entry.label}
      {entry.shortcut ? <ContextMenuShortcut>{entry.shortcut}</ContextMenuShortcut> : null}
    </ContextMenuItem>
  )
}

/**
 * A heading labels the items after it up to the next separator or heading:
 * they render as one group, as a Base UI group label must sit in a group.
 */
export function MenuEntries({ entries }: { entries: MenuEntry[] }) {
  const blocks: Array<{ key: string; separator: true } | { key: string; heading: string | null; items: MenuItemEntry[] }> = []
  for (const [index, entry] of entries.entries()) {
    const last = blocks.at(-1)
    if ("separator" in entry) blocks.push({ key: `sep-${index}`, separator: true })
    else if ("heading" in entry) blocks.push({ key: `head-${index}-${entry.heading}`, heading: entry.heading, items: [] })
    else if (last && "items" in last) last.items.push(entry)
    else blocks.push({ key: `items-${index}`, heading: null, items: [entry] })
  }
  return (
    <>
      {blocks.map((block) => {
        if ("separator" in block) return <ContextMenuSeparator key={block.key} />
        const items = block.items.map((entry) => <MenuItemView key={entry.label} entry={entry} />)
        if (block.heading === null) return <Fragment key={block.key}>{items}</Fragment>
        return (
          <ContextMenuGroup key={block.key}>
            <ContextMenuLabel>{block.heading}</ContextMenuLabel>
            {items}
          </ContextMenuGroup>
        )
      })}
    </>
  )
}

/** Render a menu result that is either entries or ready-made items. */
export function menuContent(content: ReactNode | MenuEntry[]): ReactNode {
  return Array.isArray(content) ? <MenuEntries entries={content as MenuEntry[]} /> : content
}

/** One row with its own menu; the child must accept a ref (a DOM element). */
export function RowContextMenu({ entries, children }: { entries: MenuEntry[]; children: ReactElement }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent>
        <MenuEntries entries={entries} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Mark a row of a `ContextMenuArea`. */
export function menuKey(key: string): { "data-menu-key": string } {
  return { "data-menu-key": key }
}

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
 * Shift+F10 or the Menu key on a focused row opens its menu (WCAG 2.1.1).
 * macOS browsers fire no `contextmenu` for either, so the focused element
 * gets one at its lower-left corner: the menu opens anchored there, through
 * the same path as a right click.
 */
export function openMenuFromKeyboard(event: KeyboardEvent, keyAttribute: string): void {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return
  const target = event.target
  if (!(target instanceof HTMLElement) || !target.closest(`[${keyAttribute}]`)) return
  event.preventDefault()
  const box = target.getBoundingClientRect()
  target.dispatchEvent(new globalThis.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom }))
}

/**
 * One menu for a whole list: the row under the pointer (or the focused row
 * for Shift+F10) picks the entries. Outside a row the browser's menu stays.
 */
export function ContextMenuArea({ menu, children, className }: { menu: (key: string) => MenuEntry[]; children: ReactNode; className?: string }) {
  const [row, setRow] = useState<MenuRow | null>(null)
  const onContextMenu = (event: MouseEvent) => {
    const found = menuRowAt(event.target, "data-menu-key")
    if (found === null) event.stopPropagation()
    else setRow(found)
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger className={className}>
        {/* The row lookup runs before the trigger, so outside a row the browser's menu stays (as in DataTable). */}
        <div className="contents" onContextMenu={onContextMenu} onKeyDown={(event) => openMenuFromKeyboard(event, "data-menu-key")}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={row?.name}>{row !== null ? <MenuEntries entries={menu(row.key)} /> : null}</ContextMenuContent>
    </ContextMenu>
  )
}