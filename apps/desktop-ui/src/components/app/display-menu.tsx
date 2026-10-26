/**
 * DisplayMenu (L2, plan §3.3 P13): the "Display ▾" menu of a view: how it
 * shows its data, never what the data is. One named pull-down holds radio
 * groups (Stretch, Frame names), check groups (Overlays, Show the inspector)
 * and the column choice of a table. Frame review (plate, Compare, Corners),
 * the Targets columns and any DataTable with optional columns use it.
 *
 * Every group is controlled: the host owns the values and gets each change.
 * Check items keep the menu open, so several can be set in one visit; a
 * radio choice closes it. A required column stays checked and disabled.
 */
import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { Fragment } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface DisplayRadioOption<V extends string = string> {
  value: V
  label: string
  /** A second line: the template behind a frame-name preset. */
  detail?: string
  disabled?: boolean
}

export interface DisplayCheckItem {
  id: string
  label: string
  checked: boolean
  /** The key that toggles it outside the menu: "I". */
  shortcut?: string
  disabled?: boolean
}

export interface DisplayColumn {
  id: string
  label: string
  checked: boolean
  /** Always shown: checked and disabled. */
  required?: boolean
}

export type DisplayGroup =
  | { kind: "radio"; id: string; label: string; value: string; options: readonly DisplayRadioOption[]; onChange: (value: string) => void }
  | { kind: "check"; id: string; label?: string; items: readonly DisplayCheckItem[]; onChange: (id: string, checked: boolean) => void }
  | { kind: "columns"; id: string; label?: string; columns: readonly DisplayColumn[]; onChange: (id: string, checked: boolean) => void }

export interface DisplayMenuProps {
  /** The menu's name; "Display" by default. */
  label?: string
  /** Rendered in order with a separator between groups; no group renders nothing. */
  groups: readonly DisplayGroup[]
  disabled?: boolean
  align?: "start" | "end"
}

export function DisplayMenu({ label, groups, disabled = false, align = "end" }: DisplayMenuProps) {
  const m = useMessages()
  if (groups.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={disabled} data-display-menu />}>
        <SlidersHorizontal aria-hidden="true" data-icon="inline-start" />
        {label ?? m.display_menu_label()}
        <ChevronDown aria-hidden="true" data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-auto min-w-56">
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DisplayGroupItems group={group} />
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DisplayGroupItems({ group }: { group: DisplayGroup }) {
  const m = useMessages()
  if (group.kind === "radio") {
    return (
      <DropdownMenuGroup>
        <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={group.value} onValueChange={(value) => group.onChange(String(value))}>
          {group.options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} disabled={option.disabled} closeOnClick>
              {option.detail ? (
                <span className="flex min-w-0 flex-col">
                  <span>{option.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{option.detail}</span>
                </span>
              ) : (
                option.label
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    )
  }
  if (group.kind === "check") {
    return (
      <DropdownMenuGroup>
        {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
        {group.items.map((item) => (
          <DropdownMenuCheckboxItem key={item.id} checked={item.checked} disabled={item.disabled} closeOnClick={false} onCheckedChange={(checked) => group.onChange(item.id, checked)}>
            {item.label}
            {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuGroup>
    )
  }
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{group.label ?? m.display_menu_columns()}</DropdownMenuLabel>
      {group.columns.map((column) => (
        <DropdownMenuCheckboxItem
          key={column.id}
          checked={column.required ? true : column.checked}
          disabled={column.required}
          closeOnClick={false}
          onCheckedChange={(checked) => group.onChange(column.id, checked)}
        >
          {column.label}
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuGroup>
  )
}
