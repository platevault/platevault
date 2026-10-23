/**
 * S16 Settings › Equipment (slice E; D-W31, PLAN-EQ-FR-01 to PLAN-EQ-FR-08;
 * plan §4a, C E1-E8, ngm9g). One ListSection each for Cameras, Telescopes,
 * Reducers, Filters and Rigs (equipment-records.tsx holds the others), and
 * one Add equipment ▾ in the page header for all of them (Camera, Telescope,
 * Reducer, Filter, Rig; the owner's answer of 2026-10-23); an empty section
 * keeps its own Add… in its empty state. The matching thresholds have their
 * own page, Settings › Matching (settings-matching.tsx). A
 * filter is a record: its name, the bands it passes and the FITS FILTER
 * values it matches; rigs select it in their editor, and its Rigs column
 * says which do. A rig's filters drive the Targets band strip, the
 * narrowband presets and Fit; they never filter Goal templates (D-W30).
 * Mono or OSC comes from the camera, never from a filter.
 *
 * A FILTER value on a rig's sessions that matches none of its filters is
 * listed under Unknown filters (PLAN-EQ-AC-03/04): "Add {filter} to {rig}"
 * when a filter record already matches it, else "Add filter…" prefilled
 * from the value, which creates the record on that rig. A session offers
 * the same dialog as "Add {value} to {rig}" (`AddFilterToRigDialog`, D-W127).
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Camera as CameraIcon, Filter as FilterIcon, Telescope as TelescopeIcon, Waypoints, ZoomIn } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton, ActionMenu, onSuccess } from "@/components/app/actions"
import type { Action, AddFilterToRigProps, Column, MenuItem } from "@/components/app/contracts"
import { EmptyState } from "@/components/app/feedback"
import { ChoiceListField, TextField } from "@/components/app/fields"
import { blockedByErrors, type FieldErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { liveLightSessions, sessionRigId, unknownFilterValues } from "@/domain/derive"
import { BANDS } from "@/domain/labels"
import type { Band, Catalog, Filter, OpticalTrain } from "@/domain/types"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import { CameraDialog, CamerasSection, ReducerDialog, ReducersSection, RigDialog, RigsSection, RigsUsing, recordMenu, TelescopeDialog, TelescopesSection } from "./equipment-records"
import { addFilterToRig, bandsLine, filterName, saveFilter } from "./settings-actions"

/** Bands a header value most likely passes, to prefill "Add filter" from it. The user confirms them. */
function guessBands(value: string): Band[] {
  const v = value.toLowerCase()
  const found = new Set<Band>()
  if (/h-?a|halpha|h-alpha/.test(v)) found.add("Ha")
  if (/o-?iii|oiii|o3/.test(v)) found.add("OIII")
  if (/s-?ii|sii|s2/.test(v)) found.add("SII")
  if (/extreme|enhance|dual|duo/.test(v)) {
    found.add("Ha")
    found.add("OIII")
  }
  if (found.size === 0) {
    if (/^l$|lum/.test(v)) found.add("L")
    else if (/^r$|red/.test(v)) found.add("R")
    else if (/^g$|green/.test(v)) found.add("G")
    else if (/^b$|blue/.test(v)) found.add("B")
  }
  return BANDS.filter((band) => found.has(band))
}

/** Comma-separated FILTER values, trimmed and once each. */
function parseMatches(value: string): string[] {
  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))]
}

/** What the filter dialog opens with: a filter to edit, or a new one, possibly from a header value on a rig. */
interface FilterDraft {
  filter: Filter | null
  prefill?: { name: string; bands: Band[] }
  /** The new filter goes onto this rig too ("Add Halpha to <rig>"). */
  onRig?: OpticalTrain
}

interface FilterForm {
  name: string
  matches: string
  bands: Band[]
}

/** Add filter… or Edit a filter: its name, the FILTER values it matches and the bands it passes. Which rigs carry it is set on each rig. */
function FilterDialog({ draft, onClose, focusAfterConfirm }: { draft: FilterDraft | null; onClose: () => void; focusAfterConfirm?: () => HTMLElement | null }) {
  const m = useMessages()
  const open = draft !== null
  const filter = draft?.filter ?? null
  const { values, set, shown } = useDialogForm<FilterForm>(open, () => ({
    name: filter?.name ?? draft?.prefill?.name ?? "",
    matches: (filter?.matches ?? (draft?.prefill ? [draft.prefill.name] : [])).join(", "),
    bands: filter?.bands ?? draft?.prefill?.bands ?? [],
  }))
  const name = values.name.trim()
  const errors: FieldErrors<keyof FilterForm> = {
    name: name ? undefined : m.settings_name_required(),
    bands: values.bands.length > 0 ? undefined : m.equipment_pick_band(),
  }
  const title = filter ? m.settings_edit_title({ name: filter.name }) : draft?.onRig ? m.equipment_add_value_to_rig({ value: name || (draft.prefill?.name ?? ""), rig: draft.onRig.name }) : m.equipment_add_filter()
  const label = filter ? m.settings_save() : m.equipment_add_filter()
  const confirm: Action = {
    id: "filter-save",
    label,
    kind: "primary",
    unavailable: blockedByErrors(label, errors),
    run: () => {
      const matches = parseMatches(values.matches)
      return saveFilter(filter?.id ?? null, { name, bands: values.bands, matches: matches.length > 0 ? matches : [name] }, draft?.onRig?.id ?? null).result
    },
  }
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={title} confirm={confirm} focusAfterConfirm={focusAfterConfirm}>
      <TextField label={m.equipment_name()} value={values.name} onChange={(next) => set({ name: next })} error={shown(errors, "name")} autoFocus />
      <TextField label={m.equipment_matches_filter()} description={m.equipment_comma_separated()} value={values.matches} onChange={(matches) => set({ matches })} placeholder={name || undefined} mono />
      <ChoiceListField label={m.equipment_bands()} value={values.bands} options={BANDS.map((band) => ({ value: band, label: band }))} onChange={(bands) => set({ bands })} error={shown(errors, "bands")} />
    </FormDialog>
  )
}

/** A new filter for a FILTER value no filter of `rig` matches: named and matching the value, with its guessed bands, going onto that rig. */
function unknownValueDraft(value: string, rig: OpticalTrain): FilterDraft {
  return { filter: null, prefill: { name: value, bands: guessBands(value) }, onRig: rig }
}

/** Filter records that already match a FILTER value by name or match, case-insensitively, whichever rigs carry them. */
function filtersMatching(catalog: Catalog, value: string): Filter[] {
  const key = value.toLowerCase()
  return Object.values(catalog.filters).filter((f) => [f.name, ...f.matches].some((x) => x.toLowerCase() === key))
}

/**
 * What a FILTER value no filter of `rig` matches offers (PLAN-EQ-AC-03): "Add
 * {filter}" for each record that already matches it, which reuses that record
 * instead of a duplicate, then a new filter (`newLabel`) through the dialog.
 */
function unknownValueActions(m: Messages, catalog: Catalog, rig: OpticalTrain, value: string, newLabel: string, onAdd: (draft: FilterDraft) => void, afterAdd: () => void = () => {}): Action[] {
  const known = filtersMatching(catalog, value)
  return [
    ...known.map((f): Action => ({ id: `add-${f.id}`, label: m.equipment_add_value({ value: filterName(f, known) }), run: () => onSuccess(addFilterToRig(rig.id, f.id), afterAdd) })),
    { id: "add-filter", label: newLabel, opensDialog: true, run: () => onAdd(unknownValueDraft(value, rig)) },
  ]
}

/** "Add {value} to {rig}" in a session (D-W127, PLAN-EQ-FR-04): the same offers and dialog as Unknown filters, injected by the route. */
export function AddFilterToRig({ unknown, children, focusAfterAdd }: AddFilterToRigProps) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [draft, setDraft] = useState<FilterDraft | null>(null)
  const rig = unknown ? catalog.opticalTrains[unknown.rigId] : undefined
  // Reusing a record commits at once and removes its button, so focus moves the way the dialog's does.
  const focusTarget = () => {
    const target = focusAfterAdd()
    if (!target) return
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1
    target.focus()
  }
  const actions = unknown && rig ? unknownValueActions(m, catalog, rig, unknown.value, m.equipment_add_value_to_rig({ value: unknown.value, rig: rig.name }), setDraft, focusTarget) : []
  return (
    <>
      {children(actions)}
      {/* Mounted while the value is known again, so the closing dialog can still move focus. */}
      <FilterDialog draft={draft} onClose={() => setDraft(null)} focusAfterConfirm={focusAfterAdd} />
    </>
  )
}

/** Every filter record: name, bands, the FILTER values it matches and the rigs that carry it. */
function FiltersSection({ onEdit }: { onEdit: (draft: FilterDraft) => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const add: Action = { id: "add-filter", label: m.equipment_add_filter(), opensDialog: true, run: () => onEdit({ filter: null }) }
  const matches = (f: Filter) => f.matches.join(", ")
  const columns: Column<Filter>[] = [
    { id: "name", header: m.equipment_name(), rowHeader: true, truncate: true, sortValue: (f) => f.name, cell: (f) => f.name },
    { id: "bands", header: m.equipment_bands(), sortValue: bandsLine, cell: bandsLine },
    { id: "matches", header: m.equipment_matches_filter(), truncate: true, sortValue: matches, cell: matches },
    { id: "rigs", header: m.project_rigs(), sortValue: (f) => Object.values(catalog.opticalTrains).filter((r) => r.filterIds.includes(f.id)).length, cell: (f) => <RigsUsing kind="filter" id={f.id} /> },
  ]
  return (
    <ListSection<Filter>
      title={m.equipment_filters()}
      table={{
        label: m.equipment_filters(),
        rows: Object.values(catalog.filters),
        columns,
        getRowId: (f) => f.id,
        rowLabel: (f) => f.name,
        initialSort: { columnId: "name", direction: "asc" },
        empty: <EmptyState icon={FilterIcon} title={m.tonight_no_filters()} action={<ActionButton action={add} />} />,
        rowActions: (f) => recordMenu(m, catalog, "filter", f, () => onEdit({ filter: f })),
      }}
    />
  )
}

/** A FILTER value a rig's sessions carry that none of its filters matches. */
interface UnknownValue {
  rig: OpticalTrain
  value: string
  sessions: number
}

/** FILTER values that match no filter of their rig, each offering to add a filter for it to that rig. Hidden while there are none. */
function UnknownFiltersSection({ onAdd }: { onAdd: (draft: FilterDraft) => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const sessions = liveLightSessions(catalog)
  const rows: UnknownValue[] = Object.values(catalog.opticalTrains).flatMap((rig) =>
    unknownFilterValues(catalog, rig.id).map((value) => ({
      rig,
      value,
      sessions: sessions.filter((s) => sessionRigId(s) === rig.id && s.channel === value).length,
    })),
  )
  if (rows.length === 0) return null
  const actionsFor = (u: UnknownValue): Action[] => unknownValueActions(m, catalog, u.rig, u.value, m.equipment_add_filter(), onAdd)
  const columns: Column<UnknownValue>[] = [
    { id: "value", header: m.equipment_filter_value(), rowHeader: true, truncate: true, sortValue: (u) => u.value, cell: (u) => u.value },
    { id: "rig", header: m.project_col_rig(), truncate: true, sortValue: (u) => u.rig.name, cell: (u) => u.rig.name },
    { id: "sessions", header: m.nav_sessions(), align: "right", sortValue: (u) => u.sessions, cell: (u) => formatCount(u.sessions) },
  ]
  return (
    <ListSection<UnknownValue>
      title={m.equipment_unknown_filters()}
      table={{
        label: m.equipment_unknown_filters(),
        rows,
        columns,
        getRowId: (u) => `${u.rig.id}|${u.value}`,
        rowLabel: (u) => `${u.value} · ${u.rig.name}`,
        initialSort: { columnId: "sessions", direction: "desc" },
        primaryRowAction: (u) => actionsFor(u)[0] ?? null,
        rowActions: (u): MenuItem[] => actionsFor(u),
      }}
    />
  )
}

/** A record kind the page's add dialogs open for; filters add through `FilterDialog`. */
type AddKind = "camera" | "telescope" | "reducer" | "rig"

export function EquipmentSettingsPage() {
  const m = useMessages()
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const [filterDraft, setFilterDraft] = useState<FilterDraft | null>(null)
  const [adding, setAdding] = useState<AddKind | null>(null)
  const closeAdd = () => setAdding(null)
  const addFilter = () => setFilterDraft({ filter: null })
  const onRigSaved = (rig: string) => void navigate({ to: "/settings/equipment", search: { rig } as never, replace: true })
  const addItems: MenuItem[] = [
    { id: "add-camera", label: m.equipment_camera(), icon: CameraIcon, opensDialog: true, run: () => setAdding("camera") },
    { id: "add-telescope", label: m.equipment_telescope(), icon: TelescopeIcon, opensDialog: true, run: () => setAdding("telescope") },
    { id: "add-reducer", label: m.equipment_reducer(), icon: ZoomIn, opensDialog: true, run: () => setAdding("reducer") },
    { id: "add-filter", label: m.equipment_filter(), icon: FilterIcon, opensDialog: true, run: addFilter },
    { id: "add-rig", label: m.equipment_rig(), icon: Waypoints, opensDialog: true, run: () => setAdding("rig") },
  ]
  return (
    <SettingsPage title={m.settings_equipment()} actions={<ActionMenu label={m.equipment_add_menu()} items={addItems} />}>
      <CamerasSection onAdd={() => setAdding("camera")} />
      <TelescopesSection onAdd={() => setAdding("telescope")} />
      <ReducersSection onAdd={() => setAdding("reducer")} />
      <FiltersSection onEdit={setFilterDraft} />
      <UnknownFiltersSection onAdd={setFilterDraft} />
      <RigsSection activeRigId={search.rig ?? null} onSaved={onRigSaved} onAdd={() => setAdding("rig")} />
      <CameraDialog open={adding === "camera"} camera={null} onClose={closeAdd} />
      <TelescopeDialog open={adding === "telescope"} telescope={null} onClose={closeAdd} />
      <ReducerDialog open={adding === "reducer"} reducer={null} onClose={closeAdd} />
      <RigDialog open={adding === "rig"} rig={null} onClose={closeAdd} onSaved={onRigSaved} />
      <FilterDialog draft={filterDraft} onClose={() => setFilterDraft(null)} />
    </SettingsPage>
  )
}
