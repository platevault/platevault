/**
 * Per-record actions in Settings tables (Equipment, Observing sites): one
 * "More actions for <name>" menu, the same pattern as Settings › Locations
 * rows. Its column stays pinned to the table's right edge, so the actions stay
 * in view when a wide table scrolls sideways inside its frame at 1024 px.
 */
import { MoreHorizontal } from "lucide-react"
import { Fragment, useRef } from "react"
import type { Column } from "@/components/app/data-table"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export interface RowMenuItem {
  label: string
  /** Receives the menu trigger, so a dialog opened from the item can return focus to it. */
  onSelect: (trigger: HTMLElement | null) => void
  destructive?: boolean
}

/** Row class that lets the pinned cell follow the row's hover surface. */
export const ROW_MENU_ROW = "group/row"

/**
 * The pinned column. Opaque surfaces stop scrolled cells showing through: the
 * header keeps the table head's card surface, and body cells mix the row hover
 * colour over the page background exactly as `hover:bg-muted/60` composites.
 */
export function rowMenuColumn<T>(name: (row: T) => string, items: (row: T) => RowMenuItem[]): Column<T> {
  return {
    id: "actions",
    header: "Actions",
    align: "right",
    className:
      "sticky right-0 w-px bg-background shadow-[inset_1px_0_0_var(--border)] [&:is(th)]:bg-card group-hover/row:bg-[color-mix(in_srgb,var(--muted)_60%,var(--background))]",
    cell: (row) => <RowMenu name={name(row)} items={items(row)} />,
  }
}

function RowMenu({ name, items }: { name: string; items: RowMenuItem[] }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const destructiveFrom = items.findIndex((item) => item.destructive)
  return (
    <DropdownMenu>
      {/* -my-1 keeps the 28 px trigger inside the row's --row-h height instead of growing the row. */}
      <DropdownMenuTrigger render={<Button ref={trigger} size="icon-sm" variant="ghost" className="-my-1" aria-label={`More actions for ${name}`} />}>
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {index === destructiveFrom && index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem variant={item.destructive ? "destructive" : "default"} onClick={() => item.onSelect(trigger.current)}>
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
