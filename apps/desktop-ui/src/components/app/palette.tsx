/**
 * Command palette (L2; plan §3.3 P14, A SH13): ⌘K / Ctrl+K. One searchable
 * list of grouped commands in a dialog: places to go, records, and the
 * registered Actions (`actionCommand`, actions.tsx), so a palette entry has
 * the same label, shortcut and unavailable reason as its button or menu item.
 *
 * - Built on the shared Combobox primitive, inline: typing filters by label,
 *   keywords and group heading; ↑/↓ move, Enter or a click runs.
 * - An unavailable command stays listed, dimmed, with its reason as its
 *   description; choosing it does nothing.
 * - `PaletteTrigger`: the toolbar's search field look. Below 1200 px it is
 *   an icon button with the same name.
 */
import { CornerDownLeft, Search } from "lucide-react"
import { useMessages } from "@/app/preferences"
import type { PaletteCommand } from "./contracts"
import { IconButton } from "@/components/app/actions"
import { Button } from "@/components/ui/button"
import { Combobox, ComboboxCollection, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { InputGroupAddon } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"

export interface PaletteGroup {
  value: string
  /** The heading: "Go to", "Actions". Typing it finds the group's commands. */
  label: string
  items: PaletteCommand[]
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: PaletteGroup[]
  /** Runs a chosen command that is available; the host navigates or runs it and closes the palette. */
  onRun: (command: PaletteCommand) => void
}

function matches(command: PaletteCommand, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = `${command.label} ${command.keywords ?? ""} ${command.group}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

export function CommandPalette({ open, onOpenChange, groups, onRun }: CommandPaletteProps) {
  const m = useMessages()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} size="lg" className="top-24 translate-y-0 gap-0 overflow-hidden p-0" data-palette="">
        <DialogTitle className="sr-only">{m.palette_title()}</DialogTitle>
        <DialogDescription className="sr-only">{m.palette_description()}</DialogDescription>
        <Combobox
          inline
          items={groups}
          value={null}
          autoHighlight
          filter={(item: PaletteCommand, query: string) => matches(item, query)}
          itemToStringLabel={(item: PaletteCommand) => item.label}
          onValueChange={(item: PaletteCommand | null) => {
            if (item && item.unavailable === undefined) onRun(item)
          }}
        >
          <ComboboxInput
            showTrigger={false}
            data-palette-input=""
            aria-label={m.palette_search_label()}
            placeholder={m.shell_search_or_jump_ellipsis()}
            className="h-11 w-full rounded-none border-0 border-b shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:shadow-[inset_0_-2px_0_var(--ring)]"
          >
            <InputGroupAddon align="inline-start">
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              <Kbd>{m.key_escape()}</Kbd>
            </InputGroupAddon>
          </ComboboxInput>
          <ComboboxEmpty className="flex py-6">{m.palette_empty()}</ComboboxEmpty>
          <ComboboxList className="max-h-104">
            {(group: PaletteGroup) => (
              <ComboboxGroup key={group.value} items={group.items} className="pb-1">
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(item: PaletteCommand) => {
                    const unavailable = item.unavailable !== undefined
                    const reasonId = `palette-reason-${item.id}`
                    return (
                      <ComboboxItem
                        key={item.id}
                        value={item}
                        aria-disabled={unavailable || undefined}
                        // The name is the label alone; the reason is its description and the shortcut stays visual.
                        aria-label={item.shortcut !== undefined || unavailable ? item.label : undefined}
                        aria-describedby={unavailable ? reasonId : undefined}
                        className="min-h-8 px-2 data-highlighted:shadow-[inset_2px_0_0_var(--primary)]"
                        data-command={item.id}
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className={unavailable ? "truncate opacity-50" : "truncate"}>{item.label}</span>
                          {unavailable ? (
                            <span id={reasonId} className="truncate text-xs text-muted-foreground">
                              {item.unavailable}
                            </span>
                          ) : null}
                        </span>
                        {item.shortcut ? <Kbd className={unavailable ? "opacity-50" : undefined}>{item.shortcut}</Kbd> : null}
                        {unavailable ? null : <CornerDownLeft aria-hidden="true" className="size-3.5 text-muted-foreground opacity-0 in-data-highlighted:opacity-100" />}
                      </ComboboxItem>
                    )
                  }}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </Combobox>
      </DialogContent>
    </Dialog>
  )
}

export interface PaletteTriggerProps {
  /** "Search or jump to…". */
  label: string
  /** "⌘ K". */
  shortcut: string
  /** The icon button, for narrow toolbars. */
  compact?: boolean
  onOpen: () => void
}

/** The toolbar's way into the palette: a search-field-like button with the shortcut, or an icon button with the same name. */
export function PaletteTrigger({ label, shortcut, compact = false, onOpen }: PaletteTriggerProps) {
  if (compact) return <IconButton label={label} icon={Search} shortcut={shortcut} onClick={onOpen} data-palette-trigger="" />
  return (
    <Button variant="outline" size="sm" className="w-60 min-w-0 justify-start text-muted-foreground 2xl:w-72" onClick={onOpen} data-palette-trigger="">
      <Search data-icon="inline-start" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <Kbd>{shortcut}</Kbd>
    </Button>
  )
}
