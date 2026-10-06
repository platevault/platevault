/**
 * Row context menu (HARNESS V1): right-click, ⇧F10 or the Menu key on a
 * table row opens an AppKit context menu at the pointer (or under the row
 * from the keyboard). Items list the key equivalent that also runs the
 * command, right-aligned as in macOS menus, and expose it through
 * `aria-keyshortcuts`. Escape or choosing an item returns focus to where it
 * was (WCAG 2.4.3). Every item duplicates an action the row or page already
 * offers, so the menu is never the only way to reach a command.
 */
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { Fragment, useEffect, useMemo, useRef } from "react"
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from "@/components/ui/dropdown-menu"

export interface RowMenuItem {
  label: string
  onSelect: () => void
  /** Key equivalent as shown, e.g. "X" or "⌘↓". */
  shortcut?: string
  /** The same key in `aria-keyshortcuts` syntax, e.g. "X" or "Meta+ArrowDown". */
  keys?: string
  disabled?: boolean
  destructive?: boolean
  /** Draw a separator above this item. */
  group?: boolean
}

export interface RowMenuRequest {
  /** Accessible name of the menu, e.g. "Actions for M31_L_0042.fits". */
  label: string
  items: RowMenuItem[]
  x: number
  y: number
  /** Where focus returns when the menu closes. */
  returnFocus: HTMLElement | null
  /** Opened from the keyboard: highlight the first item. */
  keyboard: boolean
}

export function RowMenu({ request, onClose }: { request: RowMenuRequest | null; onClose: () => void }) {
  const finalFocus = useRef<HTMLElement | null>(null)
  finalFocus.current = request?.returnFocus ?? null
  const popup = useRef<HTMLDivElement>(null)
  const anchor = useMemo(
    () => (request ? { getBoundingClientRect: () => DOMRect.fromRect({ x: request.x, y: request.y, width: 0, height: 0 }) } : null),
    [request],
  )
  useEffect(() => {
    if (!request?.keyboard) return
    const frame = requestAnimationFrame(() => popup.current?.querySelector<HTMLElement>("[role=menuitem]:not([data-disabled])")?.focus())
    return () => cancelAnimationFrame(frame)
  }, [request])
  return (
    <MenuPrimitive.Root open={request !== null} onOpenChange={(open) => (open ? undefined : onClose())} modal={false}>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner anchor={anchor} side="bottom" align="start" sideOffset={2} collisionPadding={8} className="isolate z-50 outline-none">
          <MenuPrimitive.Popup
            ref={popup}
            aria-label={request?.label}
            finalFocus={finalFocus}
            data-slot="dropdown-menu-content"
            className="z-50 max-h-(--available-height) min-w-48 overflow-y-auto rounded-[7px] bg-popover/95 p-[5px] text-popover-foreground shadow-[0_0_0_0.5px_rgb(0_0_0/0.22),0_8px_24px_rgb(0_0_0/0.22)] backdrop-blur-xl outline-none"
          >
            {request?.items.map((item, index) => (
              <Fragment key={item.label}>
                {item.group && index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem disabled={item.disabled} variant={item.destructive ? "destructive" : "default"} aria-keyshortcuts={item.keys} onClick={item.onSelect}>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.shortcut ? (
                    <DropdownMenuShortcut aria-hidden="true" className="num text-xs">
                      {item.shortcut}
                    </DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  )
}
