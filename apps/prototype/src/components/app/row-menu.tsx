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
 * Right click, long press, Shift+F10 and the Menu key open it.
 */
import type { LucideIcon } from "lucide-react"
import { Fragment, type MouseEvent, type ReactElement, type ReactNode, useState } from "react"
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

/**
 * One menu for a whole list: the row under the pointer (or the focused row
 * for Shift+F10) picks the entries. Outside a row the browser's menu stays.
 */
export function ContextMenuArea({ menu, children, className }: { menu: (key: string) => MenuEntry[]; children: ReactNode; className?: string }) {
  const [key, setKey] = useState<string | null>(null)
  const onContextMenu = (event: MouseEvent) => {
    const found = (event.target as HTMLElement).closest("[data-menu-key]")?.getAttribute("data-menu-key") ?? null
    if (found === null) event.stopPropagation()
    else setKey(found)
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger className={className}>
        {/* The row lookup runs before the trigger, so outside a row the browser's menu stays (as in DataTable). */}
        <div className="contents" onContextMenu={onContextMenu}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>{key !== null ? <MenuEntries entries={menu(key)} /> : null}</ContextMenuContent>
    </ContextMenu>
  )
}