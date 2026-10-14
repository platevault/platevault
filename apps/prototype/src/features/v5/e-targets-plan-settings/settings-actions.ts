/**
 * Settings › Equipment writes (slice E; ngm9g, C E1-E8): cameras,
 * telescopes, reducers and filters are records; a rig selects one camera,
 * one telescope, an optional reducer and any filters by id, and editing a rig
 * never changes them. Gear not yet imaged with is added by hand ("manual",
 * Round 6). Each write is one `commit()`, so a failed write stays unsaved
 * with Retry and the saved value stays in effect.
 *
 * Remove follows one rule for every record: refused while anything uses it
 * (rigs use cameras, telescopes, reducers and filters; sessions, Projects
 * and masters use rigs), confirmed otherwise. Sessions keep their header
 * evidence either way.
 */
import { type StepLink, sessionRigId } from "@/domain/derive"
import type { Camera, CameraId, Catalog, Filter, FilterId, OpticalTrain, OpticalTrainId, Reducer, ReducerId, Telescope, TelescopeId } from "@/domain/types"
import { type MessageRef, msg, verbatim } from "@/lib/i18n"
import { freshId, MISSING, recordSaved, refuse } from "@/store/actions/shared"
import { type CommitResult, commit, store, withCatalog } from "@/store/core"

/** "Ha + OIII": the bands a filter passes. */
export function bandsLine(filter: Pick<Filter, "bands">): string {
  return filter.bands.join(" + ") || "–"
}

/** A filter's name where several are listed together, followed by its FILTER matches when another of `among` has the same name ("Ha · Ha, H-alpha"). */
export function filterName(filter: Filter, among: readonly Filter[]): string {
  const twin = among.some((f) => f.id !== filter.id && f.name.toLowerCase() === filter.name.toLowerCase())
  return twin ? `${filter.name} · ${filter.matches.join(", ")}` : filter.name
}

const HREF = "/settings/equipment"

/** A renamed record keeps its old name as an alias, so headers that carry it still match. */
function aliasesAfterRename(previous: { name: string; aliases: string[] } | undefined, name: string): string[] {
  if (!previous || previous.name === name) return previous?.aliases ?? []
  return [...new Set([...previous.aliases, previous.name])].filter((a) => a !== name)
}

export type CameraInput = Pick<Camera, "name" | "kind" | "widthPx" | "heightPx" | "pixelSizeUm">

/** Add a camera by hand (`id` null; it is Manual) or edit one, detected ones included. */
export function saveCamera(id: CameraId | null, input: CameraInput): CommitResult {
  const previous = id ? store.getState().catalog.cameras[id] : undefined
  if (id && !previous) return MISSING
  const cameraId = id ?? freshId("cam", input.name)
  const camera: Camera = { id: cameraId, source: previous?.source ?? "manual", ...input, aliases: aliasesAfterRename(previous, input.name) }
  const label = previous ? msg("settings_edit_title", { name: previous.name }) : msg("equipment_add_camera")
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, cameras: { ...c.cameras, [cameraId]: camera } })), { href: HREF })
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: camera.name }), null, HREF)
  return result
}

export type TelescopeInput = Pick<Telescope, "name" | "focalLengthMm" | "apertureMm">

/** Add a telescope by hand (`id` null; it is Manual) or edit one, detected ones included. */
export function saveTelescope(id: TelescopeId | null, input: TelescopeInput): CommitResult {
  const previous = id ? store.getState().catalog.telescopes[id] : undefined
  if (id && !previous) return MISSING
  const telescopeId = id ?? freshId("tel", input.name)
  const telescope: Telescope = { id: telescopeId, source: previous?.source ?? "manual", ...input, aliases: aliasesAfterRename(previous, input.name) }
  const label = previous ? msg("settings_edit_title", { name: previous.name }) : msg("equipment_add_telescope")
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, telescopes: { ...c.telescopes, [telescopeId]: telescope } })), { href: HREF })
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: telescope.name }), null, HREF)
  return result
}

/** Reducer factors a rig accepts: 0.2× to 3× (a 2× Barlow is an extender). */
export const REDUCER_LIMITS = { min: 0.2, max: 3 } as const

export type ReducerInput = Pick<Reducer, "name" | "factor">

/** Add a reducer (`id` null) or edit one. A rig on it keeps its focal length until the rig is edited. */
export function saveReducer(id: ReducerId | null, input: ReducerInput): CommitResult {
  const previous = id ? store.getState().catalog.reducers[id] : undefined
  if (id && !previous) return MISSING
  const reducerId = id ?? freshId("red", input.name)
  const reducer: Reducer = { id: reducerId, ...input }
  const label = previous ? msg("settings_edit_title", { name: previous.name }) : msg("equipment_add_reducer")
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, reducers: { ...c.reducers, [reducerId]: reducer } })), { href: HREF })
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: reducer.name }), verbatim(`${input.factor}×`), HREF)
  return result
}

export type FilterInput = Pick<Filter, "name" | "matches" | "bands">

/**
 * Add a filter (`id` null) or edit one. `onRig` also adds the new filter to
 * that rig in the same write: "Add Halpha to <rig>" from a FILTER value no
 * filter of the rig matches (PLAN-EQ-AC-03); the header stays as read.
 */
export function saveFilter(id: FilterId | null, input: FilterInput, onRig: OpticalTrainId | null = null): { result: CommitResult; id: FilterId } {
  const { catalog } = store.getState()
  const previous = id ? catalog.filters[id] : undefined
  const filterId = id ?? freshId("flt", input.name)
  if (id && !previous) return { result: MISSING, id: filterId }
  const rig = onRig ? catalog.opticalTrains[onRig] : undefined
  if (onRig && !rig) return { result: MISSING, id: filterId }
  const filter: Filter = { id: filterId, ...input }
  const label = previous ? msg("settings_edit_title", { name: previous.name }) : rig ? msg("equipment_add_value_to_rig", { value: filter.name, rig: rig.name }) : msg("equipment_add_filter")
  const result = commit(
    label,
    (s) =>
      withCatalog(s, (c) => {
        const filters = { ...c.filters, [filterId]: filter }
        const current = rig ? c.opticalTrains[rig.id] : undefined
        if (!current || current.filterIds.includes(filterId)) return { ...c, filters }
        return { ...c, filters, opticalTrains: { ...c.opticalTrains, [current.id]: { ...current, filterIds: [...current.filterIds, filterId] } } }
      }),
    { href: HREF },
  )
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: filter.name }), rig ? verbatim(rig.name) : null, HREF)
  return { result, id: filterId }
}

/** "Add {filter} to {rig}": a filter record that already matches a FILTER value goes onto a rig whose filters do not (PLAN-EQ-AC-03). */
export function addFilterToRig(rigId: OpticalTrainId, filterId: FilterId): CommitResult {
  const { catalog } = store.getState()
  const rig = catalog.opticalTrains[rigId]
  const filter = catalog.filters[filterId]
  if (!rig || !filter) return MISSING
  if (rig.filterIds.includes(filterId)) return { ok: true }
  const href = `${HREF}?rig=${rigId}`
  const result = commit(msg("equipment_add_value_to_rig", { value: filter.name, rig: rig.name }), (s) => withCatalog(s, (c) => ({ ...c, opticalTrains: { ...c.opticalTrains, [rigId]: { ...c.opticalTrains[rigId]!, filterIds: [...c.opticalTrains[rigId]!.filterIds, filterId] } } })), { href })
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: rig.name }), verbatim(filter.name), href)
  return result
}

export interface RigInput {
  name: string
  cameraId: CameraId
  telescopeId: TelescopeId
  reducerId: ReducerId | null
  /** The focal length the rig uses before its reducer: the telescope's, or what the rig's headers gave it. */
  focalLengthMm: number
  filterIds: FilterId[]
}

/** The reducer factor of a rig: 1 without a reducer, or with one no longer in the catalog. */
export function rigReducerFactor(catalog: Catalog, rig: Pick<OpticalTrain, "reducerId">): number {
  return (rig.reducerId ? catalog.reducers[rig.reducerId]?.factor : undefined) ?? 1
}

/**
 * Add a rig by hand (`id` null; it is Manual) or change what an existing rig
 * is made of: it selects its camera, telescope, reducer and filters, and its
 * focal length follows from the telescope and the reducer's factor. The
 * records themselves never change here.
 */
export function saveRig(id: OpticalTrainId | null, input: RigInput): { result: CommitResult; id: OpticalTrainId } {
  const { catalog } = store.getState()
  const previous = id ? catalog.opticalTrains[id] : undefined
  const rigId = id ?? freshId("rig", input.name)
  if (id && !previous) return { result: MISSING, id: rigId }
  const factor = rigReducerFactor(catalog, input)
  const effectiveFocalLengthMm = Math.round(input.focalLengthMm * factor * 10) / 10
  const composition = { name: input.name, cameraId: input.cameraId, telescopeId: input.telescopeId, reducerId: input.reducerId, effectiveFocalLengthMm, filterIds: input.filterIds.filter((f) => catalog.filters[f]) }
  const rig: OpticalTrain = previous ? { ...previous, ...composition } : { id: rigId, source: "manual", notes: "", ...composition }
  const href = `${HREF}?rig=${rigId}`
  const result = commit(previous ? msg("settings_edit_title", { name: previous.name }) : msg("project_add_rig"), (s) => withCatalog(s, (c) => ({ ...c, opticalTrains: { ...c.opticalTrains, [rigId]: rig } })), { href })
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: rig.name }), verbatim(`${effectiveFocalLengthMm} mm`), href)
  return { result, id: rigId }
}

// ---------------------------------------------------------------------------
// Remove: refused while in use
// ---------------------------------------------------------------------------

export type EquipmentKind = "camera" | "telescope" | "reducer" | "filter" | "rig"

/** One user of a record, linked to where it can be changed. */
export interface EquipmentUser {
  label: MessageRef
  link: StepLink
}

/** Where a rig opens: its row on Settings › Equipment, marked as the current one. */
export function rigLink(rig: Pick<OpticalTrain, "id">): StepLink {
  return { to: HREF, search: { rig: rig.id } }
}

function rigsWhere(catalog: Catalog, uses: (rig: OpticalTrain) => boolean): EquipmentUser[] {
  return Object.values(catalog.opticalTrains)
    .filter(uses)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((rig) => ({ label: verbatim(rig.name), link: rigLink(rig) }))
}

/** What uses a record, so Remove is refused while it is in use: each user rig, or a rig's Projects, sessions and masters. */
export function equipmentUsers(catalog: Catalog, kind: EquipmentKind, id: string): EquipmentUser[] {
  switch (kind) {
    case "camera":
      return rigsWhere(catalog, (rig) => rig.cameraId === id)
    case "telescope":
      return rigsWhere(catalog, (rig) => rig.telescopeId === id)
    case "reducer":
      return rigsWhere(catalog, (rig) => rig.reducerId === id)
    case "filter":
      return rigsWhere(catalog, (rig) => rig.filterIds.includes(id))
    case "rig": {
      const projects = Object.values(catalog.projects)
        .filter((p) => p.rigIds.includes(id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p): EquipmentUser => ({ label: verbatim(p.name), link: { to: "/projects/$projectId", params: { projectId: p.id } } }))
      const sessions = Object.values(catalog.sessions).filter((s) => !s.supersededBy && sessionRigId(s) === id).length
      const masters = Object.values(catalog.masters).filter((x) => x.opticalTrainId === id).length
      return [
        ...projects,
        ...(sessions > 0 ? [{ label: msg("equipment_used_by_sessions", { count: sessions }), link: { to: "/sessions" } }] : []),
        ...(masters > 0 ? [{ label: msg("equipment_used_by_masters", { count: masters }), link: { to: "/calibration" } }] : []),
      ]
    }
  }
}

function recordOf(catalog: Catalog, kind: EquipmentKind, id: string): { name: string } | undefined {
  switch (kind) {
    case "camera":
      return catalog.cameras[id]
    case "telescope":
      return catalog.telescopes[id]
    case "reducer":
      return catalog.reducers[id]
    case "filter":
      return catalog.filters[id]
    case "rig":
      return catalog.opticalTrains[id]
  }
}

const COLLECTION = { camera: "cameras", telescope: "telescopes", reducer: "reducers", filter: "filters", rig: "opticalTrains" } as const

/** Remove a record nothing uses; refused, with each user named, while something does. */
export function removeEquipment(kind: EquipmentKind, id: string): CommitResult {
  const { catalog } = store.getState()
  const record = recordOf(catalog, kind, id)
  if (!record) return MISSING
  const label = msg("settings_remove_title", { name: record.name })
  const users = equipmentUsers(catalog, kind, id)
  if (users.length > 0) return refuse(msg("store_refused", { label }), users.map((u) => u.label), HREF)
  const collection = COLLECTION[kind]
  const result = commit(
    label,
    (s) =>
      withCatalog(s, (c) => {
        const { [id]: _removed, ...rest } = c[collection]
        return { ...c, [collection]: rest }
      }),
    { href: HREF },
  )
  if (result.ok) recordSaved(msg("store_saved_removed", { name: record.name }), null, HREF)
  return result
}
