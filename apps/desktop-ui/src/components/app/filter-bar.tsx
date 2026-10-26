/**
 * FilterBar (foundation-owned, plan P5): one controlled filter row.
 *
 * - Search: clearable; `/` focuses it (`ClearableInput search`).
 * - Facets: a named pull-down per facet. A single facet is a radio list with
 *   "All" first (its `value` is "" for All); a multi facet is a checkbox
 *   list whose trigger counts the values picked.
 * - Presets ▾: built-in presets, then the saved ones, "Save current…" and a
 *   Delete submenu, whose items confirm before the preset goes. The host
 *   applies a preset; its filter values stay there.
 * - Under the row, removable chips for the active facet values with the
 *   match count and Clear filters (`FilterChips`).
 *
 * No tooltips on filters (plan §6.2). DataTable renders the row and the chips
 * line through `FilterControls` and `useFacetChips`, so its batch bar can
 * replace the row in place; use `FilterBar` for a list that is not a table.
 */
import { ChevronDown } from "lucide-react"
import { type FormEvent, type RefObject, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ClearableInput } from "./clearable-input"
import { ConfirmDialog } from "./confirm-dialog"
import type { Facet, Preset } from "./contracts"
import { type FilterChip, FilterChips, type FilterChipsProps } from "./data"
import { CountBadge } from "./pill"

/** A facet value change, as a patch of facet id → value, so a reset of several facets is one update. */
export type FacetPatch = Record<string, string | string[]>

export interface FilterPresets {
  items: Preset[]
  /** The preset whose filters are applied now; it shows checked and names the trigger. */
  active?: string | null
  apply: (id: string) => void
  /** Saves the current filters under a new name; adds "Save current…". */
  save?: (name: string) => void
  /** Deletes a saved preset; adds the Delete submenu. */
  remove?: (id: string) => void
}

export interface FilterBarProps {
  search?: { label: string; placeholder?: string; value: string; onChange: (value: string) => void }
  facets?: { items: Facet[]; onChange: (patch: FacetPatch) => void }
  presets?: FilterPresets
  /** Rows the filters match, shown with the active filters. */
  matchCount?: number
}

/** Height of a toolbar row: the row height plus room around its controls. DataTable's batch bar takes the same height. */
export const TOOLBAR_ROW = "h-[calc(var(--row-h)+0.5rem)]"

/** One controlled filter row with its active-filter chips under it. */
export function FilterBar(props: FilterBarProps) {
  return (
    <div className="space-y-1.5">
      <div className={cn("flex items-center", TOOLBAR_ROW)}>
        <FilterControls {...props} />
      </div>
      <FilterChips {...useFacetChips(props)} />
    </div>
  )
}

/** The filter controls on one line: search, a pull-down per facet, Presets ▾. */
export function FilterControls({ search, facets, presets }: FilterBarProps) {
  const m = useMessages()
  return (
    <div role="group" aria-label={m.filter_bar_label()} className="flex min-w-0 items-center gap-2">
      {search ? (
        <ClearableInput
          search
          wrapperClassName="w-56 min-w-28 shrink"
          className="h-7"
          aria-label={search.label}
          placeholder={search.placeholder}
          value={search.value}
          onValueChange={search.onChange}
        />
      ) : null}
      {facets?.items.map((facet) => <FacetMenu key={facet.id} facet={facet} onChange={(value) => facets.onChange({ [facet.id]: value })} />)}
      {presets ? <PresetsMenu presets={presets} /> : null}
    </div>
  )
}

function facetValues(facet: Facet): string[] {
  if (Array.isArray(facet.value)) return facet.value
  return facet.value === "" ? [] : [facet.value]
}

/** The FilterChips props for a FilterBar's facets: one chip per picked value; Clear empties the search and every facet. */
export function useFacetChips({ search, facets, matchCount }: FilterBarProps): FilterChipsProps {
  const m = useMessages()
  const items = facets?.items ?? []
  const chips: FilterChip[] = items.flatMap((facet) =>
    facetValues(facet).map((value) => ({
      id: JSON.stringify([facet.id, value]),
      label: m.filter_bar_facet_value({ label: facet.label, value: facet.options.find((option) => option.value === value)?.label ?? value }),
    })),
  )
  return {
    chips,
    active: chips.length > 0 || (search?.value ?? "") !== "",
    matchLabel: matchCount === undefined ? "" : m.filter_bar_matches({ count: matchCount, n: formatCount(matchCount) }),
    onRemove: (id) => {
      const [facetId, value] = JSON.parse(id) as [string, string]
      const facet = items.find((f) => f.id === facetId)
      if (!facet || !facets) return
      facets.onChange({ [facetId]: facet.kind === "single" ? "" : facetValues(facet).filter((v) => v !== value) })
    },
    onClear: () => {
      if (search && search.value !== "") search.onChange("")
      const reset: FacetPatch = {}
      for (const facet of items) if (facetValues(facet).length > 0) reset[facet.id] = facet.kind === "single" ? "" : []
      if (facets && Object.keys(reset).length > 0) facets.onChange(reset)
    },
  }
}

function OptionCount({ count }: { count?: number }) {
  return count === undefined ? null : <span className="ml-auto pl-4 text-xs text-muted-foreground tabular-nums">{formatCount(count)}</span>
}

function FacetMenu({ facet, onChange }: { facet: Facet; onChange: (value: string | string[]) => void }) {
  const m = useMessages()
  const values = facetValues(facet)
  const chosen = facet.kind === "single" ? facet.options.find((option) => option.value === facet.value) : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="shrink-0" />}>
        {chosen ? m.filter_bar_facet_value({ label: facet.label, value: chosen.label }) : facet.label}
        {facet.kind === "multi" && values.length > 0 ? <CountBadge count={values.length} /> : null}
        <ChevronDown data-icon="inline-end" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-48">
        {facet.kind === "single" ? (
          <DropdownMenuRadioGroup value={facet.value as string} onValueChange={(value) => onChange(value as string)}>
            <DropdownMenuRadioItem value="" closeOnClick>
              {m.filter_bar_all()}
            </DropdownMenuRadioItem>
            {facet.options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                {option.label}
                <OptionCount count={option.count} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          facet.options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={values.includes(option.value)}
              onCheckedChange={(checked) => onChange(checked ? [...values, option.value] : values.filter((value) => value !== option.value))}
            >
              {option.label}
              <OptionCount count={option.count} />
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PresetItems({ items }: { items: Preset[] }) {
  return items.map((preset) => (
    <DropdownMenuRadioItem key={preset.id} value={preset.id} disabled={preset.unavailable !== undefined} closeOnClick>
      {preset.label}
      {preset.unavailable !== undefined ? <span className="ml-auto pl-4 text-xs text-muted-foreground">{preset.unavailable}</span> : null}
    </DropdownMenuRadioItem>
  ))
}

function PresetsMenu({ presets }: { presets: FilterPresets }) {
  const m = useMessages()
  const trigger = useRef<HTMLButtonElement>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Preset | null>(null)
  const builtIn = presets.items.filter((preset) => preset.source === "builtin")
  const saved = presets.items.filter((preset) => preset.source === "custom")
  const active = presets.items.find((preset) => preset.id === presets.active)
  const apply = (id: unknown) => presets.apply(id as string)
  const remove = presets.remove && saved.length > 0 ? presets.remove : undefined
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button ref={trigger} size="sm" variant="outline" className="shrink-0" />}>
          {active ? m.filter_bar_facet_value({ label: m.filter_bar_presets(), value: active.label }) : m.filter_bar_presets()}
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-auto min-w-56">
          {builtIn.length > 0 ? (
            <DropdownMenuRadioGroup value={presets.active ?? null} onValueChange={apply}>
              <PresetItems items={builtIn} />
            </DropdownMenuRadioGroup>
          ) : null}
          {saved.length > 0 ? (
            <>
              {builtIn.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{m.filter_bar_presets_saved()}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={presets.active ?? null} onValueChange={apply}>
                  <PresetItems items={saved} />
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          ) : null}
          {presets.save || remove ? <DropdownMenuSeparator /> : null}
          {presets.save ? <DropdownMenuItem onClick={() => setSaving(true)}>{m.filter_bar_preset_save_ellipsis()}</DropdownMenuItem> : null}
          {remove ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{m.filter_bar_preset_delete()}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {saved.map((preset) => (
                  <DropdownMenuItem key={preset.id} variant="destructive" onClick={() => setDeleting(preset)}>
                    {preset.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {presets.save ? <SavePresetDialog open={saving} onOpenChange={setSaving} taken={presets.items.map((preset) => preset.label)} onSave={presets.save} returnFocus={trigger} /> : null}
      {presets.remove ? (
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={m.filter_bar_preset_delete_title({ name: deleting?.label ?? "" })}
          confirm={{ label: m.filter_bar_preset_delete(), kind: "destructive" }}
          onConfirm={() => {
            if (deleting) presets.remove?.(deleting.id)
          }}
          focusAfterConfirm={() => trigger.current}
          focusAfterCancel={() => trigger.current}
        />
      ) : null}
    </>
  )
}

/** Names the current filters; a name already in the menu is refused beside the field. */
function SavePresetDialog({
  open,
  onOpenChange,
  taken,
  onSave,
  returnFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  taken: string[]
  onSave: (name: string) => void
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const m = useMessages()
  const nameId = useId()
  const errorId = useId()
  const [name, setName] = useState("")
  const trimmed = name.trim()
  const clash = taken.some((label) => label.localeCompare(trimmed, undefined, { sensitivity: "base" }) === 0)
  const setOpen = (next: boolean) => {
    if (!next) setName("")
    onOpenChange(next)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (trimmed === "" || clash) return
    onSave(trimmed)
    setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent finalFocus={returnFocus}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{m.filter_bar_preset_new_title()}</DialogTitle>
          </DialogHeader>
          <Field data-invalid={clash || undefined}>
            <FieldLabel htmlFor={nameId}>{m.filter_bar_preset_name()}</FieldLabel>
            <Input id={nameId} autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-invalid={clash || undefined} aria-describedby={clash ? errorId : undefined} />
            {clash ? <FieldError id={errorId}>{m.filter_bar_preset_name_taken()}</FieldError> : null}
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{m.verb_cancel()}</DialogClose>
            <Button type="submit" disabled={trimmed === "" || clash}>
              {m.filter_bar_preset_create()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
