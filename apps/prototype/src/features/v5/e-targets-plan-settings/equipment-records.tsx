/**
 * Settings › Equipment, the records (slice E; plan §4a, C E1-E8, ngm9g,
 * PLAN-EQ-FR-07, PLAN-EQ-FR-08): cameras, telescopes, reducers and rigs,
 * each a ListSection whose ⋯ holds Edit… and Remove, and the FormDialogs
 * that add or edit them. Gear not yet imaged with is added by hand (Manual,
 * Round 6); detected records edit the same way. A camera, telescope or
 * reducer holds its own properties; a camera also holds its physical alias
 * (needed once two cameras share a model) and its "Don't use darks" / "Don't
 * use bias" defaults. A rig only selects what it is made of: Camera ▾ ·
 * Telescope ▾ · Reducer ▾ · Filters (C E2) and whether it has a rotator. Its
 * focal length and field of view follow from those, editing a rig never
 * changes a camera, and an edit to what it is made of appends a version from
 * the night picked in the dialog; the row's disclosure lists every version.
 */
import { Camera as CameraIcon, Pencil, Telescope as TelescopeIcon, Trash2, Waypoints, ZoomIn } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { ChoiceListField, Field, FieldGroup, NumberField, SegmentedField, SelectField, SwitchField, TextField } from "@/components/app/fields"
import { blockedByErrors, type FieldErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { NightPicker } from "@/components/app/pickers"
import { UsedByPreview } from "@/components/app/previews"
import { StatusBadge } from "@/components/app/status"
import { ListSection } from "@/components/templates/settings-page"
import { rigFieldOfView, rigFilters, type StepLink } from "@/domain/derive"
import { nightOf, rigVersions } from "@/domain/indexing"
import { shiftNight } from "@/domain/planning"
import { fieldOfView } from "@/domain/sky"
import type { Camera, CameraKind, Catalog, OpticalTrain, Reducer, RigVersion, Telescope } from "@/domain/types"
import { formatCount, formatDecimal, formatDegrees, formatNight } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { cameraAliasRefusal, setCameraAlias } from "@/store/actions/settings"
import { nowIso, store, useStore } from "@/store/core"
import {
  bandsLine,
  cameraLabel,
  camerasNeedingAlias,
  type EquipmentKind,
  equipmentUsers,
  filterName,
  REDUCER_LIMITS,
  removeEquipment,
  rigReducerFactor,
  rigVersionSessionCounts,
  saveCamera,
  saveReducer,
  saveRig,
  saveTelescope,
} from "./settings-actions"

// ---------------------------------------------------------------------------
// Shared by the Equipment sections
// ---------------------------------------------------------------------------

/** "1.23° × 0.82° · 1.45″/px" ("1,23° × 0,82° · 1,45″/px" in pt-BR): units only, not translated. */
export function formatFov(fov: { widthDeg: number; heightDeg: number; pixelScaleArcsec: number } | null): string {
  return fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)} · ${formatDecimal(fov.pixelScaleArcsec, 2)}″/px` : "–"
}

/** "1600 mm", or "–" without a value: units only, not translated. */
function formatMm(value: number | null): string {
  return value ? `${formatDecimal(value, value % 1 === 0 ? 0 : 1)} mm` : "–"
}

/** "0.8×": a reducer's factor, units only. */
function formatFactor(factor: number): string {
  return `${formatDecimal(factor, factor % 1 === 0 ? 0 : 2)}×`
}

const positive = (v: number | null, whole = false): v is number => v !== null && !Number.isNaN(v) && v > 0 && (!whole || Number.isInteger(v))

/** "Used by 2 rigs ▸": the users, each linked to its place; "–" without one. */
function UsedBy({ label, items }: { label: string; items: { label: string; link: StepLink }[] }) {
  const first = items[0]
  if (!first) return "–"
  return <UsedByPreview label={label} link={first.link} items={items} />
}

/** The rigs a camera, telescope, reducer or filter is on, as a Used by preview. */
export function RigsUsing({ kind, id }: { kind: Exclude<EquipmentKind, "rig">; id: string }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const users = equipmentUsers(catalog, kind, id)
  return <UsedBy label={m.equipment_used_by_rigs({ count: users.length })} items={users.map((u) => ({ label: say(m, u.label), link: u.link }))} />
}

/** Edit…, the one editor of a record. */
export function editAction(m: Messages, run: () => void): Action {
  return { id: "edit", label: m.settings_edit(), icon: Pencil, opensDialog: true, run }
}

/** Remove, with the trash icon: refused while the record is in use (its users listed), confirmed otherwise. */
export function removeAction(m: Messages, catalog: Catalog, kind: EquipmentKind, record: { id: string; name: string }): Action {
  const users = equipmentUsers(catalog, kind, record.id)
  const label = m.settings_remove()
  return {
    id: "remove",
    label,
    icon: Trash2,
    kind: "destructive",
    unavailable: users.length > 0 ? { action: m.actions_blocked({ action: label }), reason: m.equipment_in_use(), blockers: users.map((u) => ({ label: say(m, u.label), link: u.link })) } : undefined,
    confirm: { title: m.settings_remove_title({ name: record.name }), confirm: { label, kind: "destructive" } },
    run: () => removeEquipment(kind, record.id),
  }
}

/** A record's ⋯: Edit…, then Remove. */
export function recordMenu(m: Messages, catalog: Catalog, kind: EquipmentKind, record: { id: string; name: string }, edit: () => void): MenuItem[] {
  return [editAction(m, edit), { separator: true }, removeAction(m, catalog, kind, record)]
}

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

interface CameraForm {
  name: string
  kind: CameraKind
  width: number | null
  height: number | null
  pixel: number | null
  alias: string
  /** Aliases typed for the other cameras of this model that have none yet, by camera id; a key appears once its field is typed in (PLAN-EQ-AC-10). */
  twinAliases: Record<string, string>
  noDarks: boolean
  noBias: boolean
  /** The camera an earlier try added, so a retry after a refused alias edits it instead of adding another. */
  added: string | null
}

/** The id a camera not yet added is checked under: it names no camera in the catalog. */
const NEW_CAMERA = ""

/**
 * Add a camera (`camera` null) or edit one: name, kind, sensor and pixel
 * size, its alias and its "Don't use darks" / "Don't use bias" defaults
 * (PLAN-EQ-FR-08). While another camera of the same model has no alias, the
 * dialog asks for that one too, and Save names it through `setCameraAlias`
 * before it saves this camera; every alias is checked inline by the rule the
 * writers apply (`cameraAliasRefusal`), so Save stays unavailable until each
 * camera of the model has its own.
 */
function CameraDialog({ open, camera, onClose }: { open: boolean; camera: Camera | null; onClose: () => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const { values, set, shown } = useDialogForm<CameraForm>(open, () => ({
    name: camera?.name ?? "",
    kind: camera?.kind ?? "mono",
    width: camera?.widthPx ?? null,
    height: camera?.heightPx ?? null,
    pixel: camera?.pixelSizeUm ?? null,
    alias: camera?.physicalAlias ?? "",
    twinAliases: {},
    noDarks: camera?.noDarks ?? false,
    noBias: camera?.noBias ?? false,
    added: null,
  }))
  const model = values.name.trim()
  const selfId = camera?.id ?? values.added ?? NEW_CAMERA
  const twins = model ? camerasNeedingAlias(catalog, selfId, model) : []
  const typed = [{ id: selfId, alias: values.alias.trim() }, ...twins.map((t) => ({ id: t.id, alias: (values.twinAliases[t.id] ?? "").trim() }))]
  const typedTwice = (id: string, alias: string) => alias !== "" && typed.some((other) => other.id !== id && other.alias.toLowerCase() === alias.toLowerCase())
  const aliasError = (id: string, name: string, alias: string): string | undefined => {
    const refusal = cameraAliasRefusal(catalog, id, name, alias)
    if (refusal) return say(m, refusal)
    return typedTwice(id, alias.trim()) ? m.equipment_alias_twice() : undefined
  }
  const twinError = (twin: Camera): string | undefined => {
    const alias = values.twinAliases[twin.id] ?? ""
    return alias.trim() ? aliasError(twin.id, twin.name, alias) : m.settings_camera_alias_needed({ name: twin.name })
  }
  const errors: FieldErrors<keyof CameraForm> = {
    name: model ? undefined : m.targets_name_empty({ label: m.equipment_name() }),
    width: positive(values.width, true) ? undefined : m.equipment_error_whole_pixels(),
    height: positive(values.height, true) ? undefined : m.equipment_error_whole_pixels(),
    pixel: positive(values.pixel) ? undefined : m.equipment_error_microns(),
    alias: model ? aliasError(selfId, model, values.alias) : undefined,
  }
  const blockers: FieldErrors<string> = { ...errors, ...Object.fromEntries(twins.map((t) => [`twin-${t.id}`, twinError(t)])) }
  const twinHelp = (twin: Camera) => {
    const rigs = equipmentUsers(catalog, "camera", twin.id).map((u) => say(m, u.label))
    return rigs.length > 0 ? m.equipment_twin_alias_help({ rigs: rigs.join(", ") }) : m.equipment_twin_alias_help_no_rig()
  }
  const label = camera ? m.settings_save() : m.equipment_add_camera()
  const confirm: Action = {
    id: "camera-save",
    label,
    kind: "primary",
    unavailable: blockedByErrors(label, blockers),
    run: () => {
      for (const twin of twins) {
        const named = setCameraAlias(twin.id, values.twinAliases[twin.id] ?? "")
        if (!named.ok) return named
      }
      const input = { name: model, kind: values.kind, widthPx: values.width ?? 0, heightPx: values.height ?? 0, pixelSizeUm: values.pixel ?? 0, physicalAlias: values.alias, noDarks: values.noDarks, noBias: values.noBias }
      const saved = saveCamera(camera?.id ?? values.added, input)
      if (!camera && store.getState().catalog.cameras[saved.id]) set({ added: saved.id })
      return saved.result
    },
  }
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={camera ? m.settings_edit_title({ name: cameraLabel(camera) }) : m.equipment_add_camera()} confirm={confirm}>
      <TextField label={m.equipment_name()} value={values.name} onChange={(name) => set({ name })} error={shown(errors, "name")} autoFocus />
      <SegmentedField
        label={m.equipment_camera_kind()}
        value={values.kind}
        options={[
          { value: "mono", label: m.equipment_mono() },
          { value: "osc", label: m.equipment_osc_colour() },
        ]}
        onChange={(kind) => set({ kind })}
      />
      <FieldGroup label={m.equipment_sensor()}>
        <NumberField label={m.equipment_sensor_width()} value={values.width} min={1} step={1} onChange={(width) => set({ width })} error={shown(errors, "width")} />
        <NumberField label={m.equipment_sensor_height()} value={values.height} min={1} step={1} onChange={(height) => set({ height })} error={shown(errors, "height")} />
        <NumberField label={m.equipment_pixel_size()} value={values.pixel} min={0.1} step={0.01} onChange={(pixel) => set({ pixel })} error={shown(errors, "pixel")} />
      </FieldGroup>
      <TextField label={m.equipment_camera_alias()} description={m.equipment_camera_alias_help()} value={values.alias} onChange={(alias) => set({ alias })} error={shown(errors, "alias")} />
      {twins.map((twin) => (
        <TextField
          key={twin.id}
          label={m.equipment_twin_alias({ name: twin.name })}
          description={twinHelp(twin)}
          value={values.twinAliases[twin.id] ?? ""}
          onChange={(alias) => set({ twinAliases: { ...values.twinAliases, [twin.id]: alias } })}
          error={twin.id in values.twinAliases ? twinError(twin) : undefined}
        />
      ))}
      <FieldGroup label={m.equipment_calibration_defaults()}>
        <SwitchField label={m.equipment_no_darks()} description={m.equipment_no_calibration_help()} checked={values.noDarks} onChange={(noDarks) => set({ noDarks })} />
        <SwitchField label={m.equipment_no_bias()} checked={values.noBias} onChange={(noBias) => set({ noBias })} />
      </FieldGroup>
    </FormDialog>
  )
}

/** "Don't use darks · Don't use bias": the defaults a camera's sessions settle by; "–" with neither. */
function calibrationDefaultsLine(m: Messages, camera: Camera): string {
  return [camera.noDarks ? m.equipment_no_darks() : null, camera.noBias ? m.equipment_no_bias() : null].filter(Boolean).join(" · ") || "–"
}

/** Every camera, detected or Manual: kind, alias, sensor, pixel size, its calibration defaults and the rigs it is on. */
export function CamerasSection() {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [editing, setEditing] = useState<{ camera: Camera | null } | null>(null)
  const rigCount = (c: Camera) => equipmentUsers(catalog, "camera", c.id).length
  const add: Action = { id: "add-camera", label: m.equipment_add_camera(), opensDialog: true, run: () => setEditing({ camera: null }) }
  const columns: Column<Camera>[] = [
    { id: "name", header: m.equipment_name(), rowHeader: true, sortValue: (c) => c.name, cell: (c) => c.name },
    { id: "kind", header: m.equipment_camera_kind(), sortValue: (c) => c.kind, cell: (c) => (c.kind === "osc" ? m.equipment_osc() : m.equipment_mono()) },
    { id: "alias", header: m.equipment_camera_alias(), truncate: true, sortValue: (c) => c.physicalAlias ?? "", cell: (c) => c.physicalAlias ?? "–" },
    { id: "sensor", header: m.equipment_sensor(), align: "right", sortValue: (c) => c.widthPx * c.heightPx, cell: (c) => `${c.widthPx} × ${c.heightPx} px` },
    { id: "pixel", header: m.equipment_pixel_size_short(), align: "right", sortValue: (c) => c.pixelSizeUm, cell: (c) => `${formatDecimal(c.pixelSizeUm, 2)} µm` },
    { id: "defaults", header: m.equipment_calibration_defaults(), truncate: true, sortValue: (c) => calibrationDefaultsLine(m, c), cell: (c) => calibrationDefaultsLine(m, c) },
    { id: "rigs", header: m.project_rigs(), sortValue: rigCount, cell: (c) => <RigsUsing kind="camera" id={c.id} /> },
    { id: "source", header: m.equipment_source(), sortValue: (c) => c.source, cell: (c) => <StatusBadge kind="source" value={c.source} /> },
  ]
  return (
    <>
      <ListSection<Camera>
        title={m.equipment_cameras()}
        add={add}
        table={{
          label: m.equipment_cameras(),
          rows: Object.values(catalog.cameras),
          columns,
          getRowId: (c) => c.id,
          // Two cameras of one model read apart by their aliases, in their ⋯ menus too.
          rowLabel: cameraLabel,
          initialSort: { columnId: "name", direction: "asc" },
          stickyFirstColumn: true,
          empty: <EmptyState icon={CameraIcon} title={m.equipment_no_cameras()} action={<ActionButton action={add} />} />,
          rowActions: (c) => recordMenu(m, catalog, "camera", { id: c.id, name: cameraLabel(c) }, () => setEditing({ camera: c })),
        }}
      />
      <CameraDialog open={editing !== null} camera={editing?.camera ?? null} onClose={() => setEditing(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Telescopes
// ---------------------------------------------------------------------------

interface TelescopeForm {
  name: string
  focal: number | null
  aperture: number | null
}

/** Add a telescope (`telescope` null) or edit one: name, focal length and aperture. */
function TelescopeDialog({ open, telescope, onClose }: { open: boolean; telescope: Telescope | null; onClose: () => void }) {
  const m = useMessages()
  const { values, set, shown } = useDialogForm<TelescopeForm>(open, () => ({ name: telescope?.name ?? "", focal: telescope?.focalLengthMm ?? null, aperture: telescope?.apertureMm ?? null }))
  const errors: FieldErrors<keyof TelescopeForm> = {
    name: values.name.trim() ? undefined : m.targets_name_empty({ label: m.equipment_name() }),
    focal: positive(values.focal) ? undefined : m.equipment_error_mm(),
    aperture: values.aperture === null || positive(values.aperture) ? undefined : m.equipment_error_mm(),
  }
  const label = telescope ? m.settings_save() : m.equipment_add_telescope()
  const confirm: Action = {
    id: "telescope-save",
    label,
    kind: "primary",
    unavailable: blockedByErrors(label, errors),
    run: () => saveTelescope(telescope?.id ?? null, { name: values.name.trim(), focalLengthMm: values.focal ?? 0, apertureMm: values.aperture }),
  }
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={telescope ? m.settings_edit_title({ name: telescope.name }) : m.equipment_add_telescope()} size="sm" confirm={confirm}>
      <TextField label={m.equipment_name()} value={values.name} onChange={(name) => set({ name })} error={shown(errors, "name")} autoFocus />
      <FieldGroup label={m.equipment_optics()}>
        <NumberField label={m.equipment_native_focal_length()} value={values.focal} min={1} step={1} onChange={(focal) => set({ focal })} error={shown(errors, "focal")} />
        <NumberField label={m.equipment_aperture()} value={values.aperture} min={1} step={1} onChange={(aperture) => set({ aperture })} error={shown(errors, "aperture")} />
      </FieldGroup>
    </FormDialog>
  )
}

/** Every telescope, detected or Manual: focal length, aperture and the rigs it is on. */
export function TelescopesSection() {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [editing, setEditing] = useState<{ telescope: Telescope | null } | null>(null)
  const rigCount = (t: Telescope) => equipmentUsers(catalog, "telescope", t.id).length
  const add: Action = { id: "add-telescope", label: m.equipment_add_telescope(), opensDialog: true, run: () => setEditing({ telescope: null }) }
  const columns: Column<Telescope>[] = [
    { id: "name", header: m.equipment_name(), rowHeader: true, truncate: true, sortValue: (t) => t.name, cell: (t) => t.name },
    { id: "focal", header: m.run_field_focal_length(), align: "right", sortValue: (t) => t.focalLengthMm, cell: (t) => formatMm(t.focalLengthMm) },
    { id: "aperture", header: m.equipment_aperture_short(), align: "right", sortValue: (t) => t.apertureMm, cell: (t) => formatMm(t.apertureMm) },
    { id: "rigs", header: m.project_rigs(), sortValue: rigCount, cell: (t) => <RigsUsing kind="telescope" id={t.id} /> },
    { id: "source", header: m.equipment_source(), sortValue: (t) => t.source, cell: (t) => <StatusBadge kind="source" value={t.source} /> },
  ]
  return (
    <>
      <ListSection<Telescope>
        title={m.equipment_telescopes()}
        add={add}
        table={{
          label: m.equipment_telescopes(),
          rows: Object.values(catalog.telescopes),
          columns,
          getRowId: (t) => t.id,
          rowLabel: (t) => t.name,
          initialSort: { columnId: "name", direction: "asc" },
          empty: <EmptyState icon={TelescopeIcon} title={m.equipment_no_telescopes()} action={<ActionButton action={add} />} />,
          rowActions: (t) => recordMenu(m, catalog, "telescope", t, () => setEditing({ telescope: t })),
        }}
      />
      <TelescopeDialog open={editing !== null} telescope={editing?.telescope ?? null} onClose={() => setEditing(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

interface ReducerForm {
  name: string
  factor: number | null
}

/** Add a reducer or extender (`reducer` null) or edit one: its name and factor. */
function ReducerDialog({ open, reducer, onClose }: { open: boolean; reducer: Reducer | null; onClose: () => void }) {
  const m = useMessages()
  const { values, set, shown } = useDialogForm<ReducerForm>(open, () => ({ name: reducer?.name ?? "", factor: reducer?.factor ?? null }))
  const errors: FieldErrors<keyof ReducerForm> = {
    name: values.name.trim() ? undefined : m.targets_name_empty({ label: m.equipment_name() }),
    factor: values.factor !== null && values.factor >= REDUCER_LIMITS.min && values.factor <= REDUCER_LIMITS.max ? undefined : m.equipment_error_reducer(),
  }
  const label = reducer ? m.settings_save() : m.equipment_add_reducer()
  const confirm: Action = { id: "reducer-save", label, kind: "primary", unavailable: blockedByErrors(label, errors), run: () => saveReducer(reducer?.id ?? null, { name: values.name.trim(), factor: values.factor ?? 1 }) }
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={reducer ? m.settings_edit_title({ name: reducer.name }) : m.equipment_add_reducer()} size="sm" confirm={confirm}>
      <TextField label={m.equipment_name()} value={values.name} onChange={(name) => set({ name })} error={shown(errors, "name")} autoFocus />
      <NumberField label={m.equipment_reducer_field()} value={values.factor} min={REDUCER_LIMITS.min} max={REDUCER_LIMITS.max} step={0.01} onChange={(factor) => set({ factor })} error={shown(errors, "factor")} />
    </FormDialog>
  )
}

/** Every reducer and extender: its factor and the rigs it is on. */
export function ReducersSection() {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [editing, setEditing] = useState<{ reducer: Reducer | null } | null>(null)
  const add: Action = { id: "add-reducer", label: m.equipment_add_reducer(), opensDialog: true, run: () => setEditing({ reducer: null }) }
  const columns: Column<Reducer>[] = [
    { id: "name", header: m.equipment_name(), rowHeader: true, truncate: true, sortValue: (r) => r.name, cell: (r) => r.name },
    { id: "factor", header: m.equipment_factor(), align: "right", sortValue: (r) => r.factor, cell: (r) => formatFactor(r.factor) },
    { id: "rigs", header: m.project_rigs(), sortValue: (r) => equipmentUsers(catalog, "reducer", r.id).length, cell: (r) => <RigsUsing kind="reducer" id={r.id} /> },
  ]
  return (
    <>
      <ListSection<Reducer>
        title={m.equipment_reducers()}
        add={add}
        table={{
          label: m.equipment_reducers(),
          rows: Object.values(catalog.reducers),
          columns,
          getRowId: (r) => r.id,
          rowLabel: (r) => r.name,
          initialSort: { columnId: "name", direction: "asc" },
          empty: <EmptyState icon={ZoomIn} title={m.equipment_no_reducers()} action={<ActionButton action={add} />} />,
          rowActions: (r) => recordMenu(m, catalog, "reducer", r, () => setEditing({ reducer: r })),
        }}
      />
      <ReducerDialog open={editing !== null} reducer={editing?.reducer ?? null} onClose={() => setEditing(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Rigs
// ---------------------------------------------------------------------------

/** No record chosen yet in a rig Select. */
const NONE = ""
/** The rig has no reducer. */
const NO_REDUCER = "none"

interface RigForm {
  name: string
  /** The user typed the name; until then it follows the camera and telescope. */
  named: boolean
  cameraId: string
  telescopeId: string
  reducerId: string
  filterIds: string[]
  rotator: boolean
  /** The night a new rig, or an edit to what a rig is made of, applies from (PLAN-EQ-FR-07), as YYYY-MM-DD: an edit's picker starts the night after the current version's first night. */
  from: string
}

/** "Ha, OIII, SII"; "No filters · OSC" for an OSC camera without one. */
export function rigFiltersLine(m: Messages, catalog: Catalog, rig: OpticalTrain): string {
  const filters = rigFilters(catalog, rig)
  if (filters.length > 0) return filters.map((f) => f.name).join(", ")
  const camera = rig.cameraId ? catalog.cameras[rig.cameraId] : undefined
  return camera?.kind === "osc" ? m.equipment_no_filters_osc() : m.tonight_no_filters()
}

/** The earliest first night a rig added by hand can take, so its calendar has an end; its first version also covers the nights before it (provisional). */
const FIRST_NIGHT_FLOOR = "2000-01-01"

/** A night as a form field: the Field's label and description name the NightPicker's group, and the picker, Today included, keeps the night on or after `min`. */
function NightField({ label, description, value, onChange, today, min }: { label: string; description: string; value: string; onChange: (night: string) => void; today: string; min: string }) {
  return (
    <Field label={label} description={description}>
      {(control) => <NightPicker id={control.id} aria-labelledby={control["aria-labelledby"]} aria-describedby={control["aria-describedby"]} value={value} onChange={onChange} today={today < min ? min : today} min={min} />}
    </Field>
  )
}

/**
 * Add rig… (`rig` null) or Edit a rig: Camera ▾ · Telescope ▾ · Reducer ▾ ·
 * Filters (C E2) and its rotator. The focal length is the telescope's times
 * the reducer's factor; an existing rig keeps the focal length its headers
 * gave it while its telescope stays the same. Editing what an existing rig
 * is made of starts a new version from the night picked here, after its
 * current version's first night (PLAN-EQ-FR-07); a rename starts none.
 */
function RigDialog({ open, rig, onClose, onSaved }: { open: boolean; rig: OpticalTrain | null; onClose: () => void; onSaved: (rigId: string) => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const byName = <T extends { name: string }>(records: Record<string, T>) => Object.values(records).sort((a, b) => a.name.localeCompare(b.name))
  const cameras = byName(catalog.cameras)
  const telescopes = byName(catalog.telescopes)
  const reducers = byName(catalog.reducers)
  const filters = byName(catalog.filters)
  const { values, set, shown } = useDialogForm<RigForm>(open, () => ({
    name: rig?.name ?? "",
    named: rig !== null,
    cameraId: rig?.cameraId ?? NONE,
    telescopeId: rig?.telescopeId ?? NONE,
    reducerId: rig?.reducerId ?? NO_REDUCER,
    filterIds: rig?.filterIds ?? [],
    rotator: rig?.rotator ?? false,
    from: rig && nightOf(nowIso()) <= rig.versionFrom ? shiftNight(rig.versionFrom, 1) : nightOf(nowIso()),
  }))
  const camera = catalog.cameras[values.cameraId]
  const telescope = catalog.telescopes[values.telescopeId]
  const reducerId = values.reducerId === NO_REDUCER ? null : values.reducerId
  const suggested = camera && telescope ? m.equipment_rig_suggested({ telescope: telescope.name, camera: camera.name }) : ""
  const name = values.named ? values.name : suggested
  const keepsFocal = rig !== null && rig.telescopeId === values.telescopeId
  const baseFocal = keepsFocal ? rig.effectiveFocalLengthMm / rigReducerFactor(catalog, rig) : (telescope?.focalLengthMm ?? null)
  const effective = baseFocal === null ? null : Math.round(baseFocal * rigReducerFactor(catalog, { reducerId }) * 10) / 10
  const fov = camera && effective ? fieldOfView({ id: "draft", name, source: "manual", cameraId: camera.id, telescopeId: values.telescopeId, effectiveFocalLengthMm: effective, notes: "", filterIds: [], rotator: values.rotator, versionId: "draft", versionFrom: values.from, history: [] }, camera) : null
  const trimmed = name.trim()
  const taken = Object.values(catalog.opticalTrains).some((r) => r.id !== rig?.id && r.name.toLowerCase() === trimmed.toLowerCase())
  const picked = values.filterIds.flatMap((id) => catalog.filters[id] ?? [])
  const twin = picked.find((f, i) => picked.findIndex((g) => g.name.toLowerCase() === f.name.toLowerCase()) !== i)
  const errors: FieldErrors<keyof RigForm> = {
    name: !trimmed ? m.targets_name_empty({ label: m.equipment_rig_name() }) : taken ? m.targets_name_taken({ label: m.equipment_rig_name(), name: trimmed }) : undefined,
    cameraId: camera ? undefined : m.equipment_error_choose(),
    telescopeId: telescope ? undefined : m.equipment_error_choose(),
    filterIds: twin ? m.equipment_filter_twin({ name: twin.name }) : undefined,
  }
  const label = rig ? m.settings_save() : m.project_add_rig()
  const confirm: Action = {
    id: "rig-save",
    label,
    kind: "primary",
    unavailable: blockedByErrors(label, errors),
    run: () => {
      if (!camera || !telescope || baseFocal === null) return
      const saved = saveRig(rig?.id ?? null, { name: trimmed, cameraId: camera.id, telescopeId: telescope.id, reducerId, focalLengthMm: baseFocal, filterIds: values.filterIds, rotator: values.rotator, from: values.from })
      if (saved.result.ok) onSaved(saved.id)
      return saved.result
    },
  }
  const choose = { value: NONE, label: m.fields_choose_ellipsis(), disabled: true }
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={rig ? m.settings_edit_title({ name: rig.name }) : m.project_add_rig()} size="lg" confirm={confirm}>
      <TextField label={m.equipment_rig_name()} value={name} onChange={(next) => set({ name: next, named: next.trim() !== "" })} error={shown(errors, "name")} autoFocus />
      <FieldGroup label={m.equipment_rig_parts()}>
        <SelectField label={m.equipment_camera()} value={camera ? values.cameraId : NONE} options={[choose, ...cameras.map((c) => ({ value: c.id, label: cameraLabel(c) }))]} onChange={(cameraId) => set({ cameraId })} error={shown(errors, "cameraId")} />
        <SelectField label={m.equipment_telescope()} value={telescope ? values.telescopeId : NONE} options={[choose, ...telescopes.map((t) => ({ value: t.id, label: t.name }))]} onChange={(telescopeId) => set({ telescopeId })} error={shown(errors, "telescopeId")} />
        <SelectField
          label={m.equipment_reducer()}
          value={reducerId && catalog.reducers[reducerId] ? reducerId : NO_REDUCER}
          options={[{ value: NO_REDUCER, label: m.equipment_no_reducer() }, ...reducers.map((r) => ({ value: r.id, label: `${r.name} · ${formatFactor(r.factor)}` }))]}
          onChange={(next) => set({ reducerId: next })}
        />
        <SwitchField label={m.equipment_rotator()} description={m.equipment_rotator_help()} checked={values.rotator} onChange={(rotator) => set({ rotator })} />
      </FieldGroup>
      <KeyValueList
        columns={2}
        items={[
          { label: m.run_field_focal_length(), value: formatMm(effective) },
          { label: m.equipment_field_of_view(), value: formatFov(fov) },
        ]}
      />
      <ChoiceListField
        label={m.equipment_filters()}
        value={values.filterIds}
        options={filters.map((f) => ({ value: f.id, label: `${filterName(f, filters)} · ${bandsLine(f)}` }))}
        onChange={(filterIds) => set({ filterIds })}
        error={shown(errors, "filterIds")}
        empty={m.tonight_no_filters()}
      />
      <NightField
        label={rig ? m.equipment_version_from() : m.equipment_first_night()}
        description={rig ? m.equipment_version_from_help({ night: formatNight(rig.versionFrom, true) }) : m.equipment_first_night_help()}
        value={values.from}
        onChange={(from) => set({ from })}
        today={nightOf(nowIso())}
        min={rig ? shiftNight(rig.versionFrom, 1) : FIRST_NIGHT_FLOOR}
      />
    </FormDialog>
  )
}

/**
 * A rig's versions, newest first (PLAN-EQ-FR-07, PLAN-EQ-AC-08): the night
 * each began, what it was made of and how many sessions hold it. Editing the
 * rig appends one through `addRigVersion`; none is ever edited or removed, so
 * a session keeps the version it was captured with. The provisional rules
 * for nights outside the versions follow the backend's `RigVersion::for_night`
 * and `rigVersionAt`: a night before the first version reads the first, and a
 * session with no capture date reads a version only while the rig has one.
 */
function RigVersions({ rig }: { rig: OpticalTrain }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const sessions = rigVersionSessionCounts(catalog, rig.id)
  const camera = (v: RigVersion) => {
    const record = v.cameraId ? catalog.cameras[v.cameraId] : undefined
    return record ? cameraLabel(record) : "–"
  }
  const reducer = (v: RigVersion) => {
    const record = v.reducerId ? catalog.reducers[v.reducerId] : undefined
    return record ? `${record.name} · ${formatFactor(record.factor)}` : "–"
  }
  const telescope = (v: RigVersion) => (v.telescopeId ? catalog.telescopes[v.telescopeId]?.name : undefined) ?? "–"
  const filtersOf = (v: RigVersion) => v.filterIds.flatMap((id) => catalog.filters[id]?.name ?? []).join(", ") || "–"
  const rotator = (v: RigVersion) => (v.rotator ? m.equipment_rotator_yes() : m.equipment_rotator_no())
  const held = (v: RigVersion) => sessions.get(v.id) ?? 0
  const columns: Column<RigVersion>[] = [
    { id: "from", header: m.equipment_first_night(), rowHeader: true, sortValue: (v) => v.from, cell: (v) => (v.id === rig.versionId ? m.equipment_version_current({ night: formatNight(v.from, true) }) : formatNight(v.from, true)) },
    { id: "camera", header: m.equipment_camera(), sortValue: camera, cell: camera },
    { id: "telescope", header: m.equipment_telescope(), sortValue: telescope, cell: telescope },
    { id: "reducer", header: m.equipment_reducer(), sortValue: reducer, cell: reducer },
    { id: "focal", header: m.run_field_focal_length(), align: "right", sortValue: (v) => v.effectiveFocalLengthMm, cell: (v) => formatMm(v.effectiveFocalLengthMm) },
    { id: "filters", header: m.equipment_filters(), sortValue: filtersOf, cell: filtersOf },
    { id: "rotator", header: m.equipment_rotator(), sortValue: rotator, cell: rotator },
    { id: "sessions", header: m.nav_sessions(), align: "right", sortValue: held, cell: (v) => formatCount(held(v)) },
  ]
  return (
    <>
      <DataTable label={m.equipment_versions_of({ name: rig.name })} rows={rigVersions(rig)} columns={columns} getRowId={(v) => v.id} initialSort={{ columnId: "from", direction: "desc" }} scroll="none" />
      <KeyValueList items={[{ label: m.status_provisional(), value: m.equipment_version_rules() }]} />
    </>
  )
}

/** Every rig: what it is made of, its focal length, field of view and filters, the Projects that use it, and its versions under its disclosure. */
export function RigsSection({ activeRigId, onSaved }: { activeRigId: string | null; onSaved: (rigId: string) => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [editing, setEditing] = useState<{ rig: OpticalTrain | null } | null>(null)
  const projectsOf = (rig: OpticalTrain) =>
    Object.values(catalog.projects)
      .filter((p) => p.rigIds.includes(rig.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  const recordName = (record: { name: string } | undefined) => record?.name ?? "–"
  const cameraName = (r: OpticalTrain) => {
    const camera = r.cameraId ? catalog.cameras[r.cameraId] : undefined
    return camera ? cameraLabel(camera) : "–"
  }
  const telescopeName = (r: OpticalTrain) => recordName(r.telescopeId ? catalog.telescopes[r.telescopeId] : undefined)
  const reducerName = (r: OpticalTrain) => recordName(r.reducerId ? catalog.reducers[r.reducerId] : undefined)
  const add: Action = { id: "add-rig", label: m.project_add_rig(), opensDialog: true, run: () => setEditing({ rig: null }) }
  const columns: Column<OpticalTrain>[] = [
    { id: "name", header: m.equipment_name(), rowHeader: true, sortValue: (r) => r.name, cell: (r) => r.name },
    { id: "camera", header: m.equipment_camera(), truncate: true, sortValue: cameraName, cell: cameraName },
    { id: "telescope", header: m.equipment_telescope(), truncate: true, sortValue: telescopeName, cell: telescopeName },
    { id: "reducer", header: m.equipment_reducer(), truncate: true, sortValue: reducerName, cell: reducerName },
    { id: "focal", header: m.run_field_focal_length(), align: "right", sortValue: (r) => r.effectiveFocalLengthMm, cell: (r) => formatMm(r.effectiveFocalLengthMm) },
    { id: "fov", header: m.equipment_field_of_view(), sortValue: (r) => rigFieldOfView(catalog, r)?.widthDeg ?? null, cell: (r) => formatFov(rigFieldOfView(catalog, r)) },
    { id: "filters", header: m.equipment_filters(), truncate: true, sortValue: (r) => r.filterIds.length, cell: (r) => rigFiltersLine(m, catalog, r) },
    { id: "version", header: m.equipment_version_since(), sortValue: (r) => r.versionFrom, cell: (r) => formatNight(r.versionFrom, true) },
    {
      id: "projects",
      header: m.calibration_used_by(),
      sortValue: (r) => projectsOf(r).length,
      cell: (r) => <UsedBy label={m.equipment_used_by_projects({ count: projectsOf(r).length })} items={projectsOf(r).map((p) => ({ label: p.name, link: { to: "/projects/$projectId", params: { projectId: p.id } } }))} />,
    },
    { id: "source", header: m.equipment_source(), sortValue: (r) => r.source, cell: (r) => <StatusBadge kind="source" value={r.source} /> },
  ]
  return (
    <>
      <ListSection<OpticalTrain>
        title={m.project_rigs()}
        add={add}
        table={{
          label: m.project_rigs(),
          rows: Object.values(catalog.opticalTrains),
          columns,
          getRowId: (r) => r.id,
          rowLabel: (r) => r.name,
          activeRowId: activeRigId,
          initialSort: { columnId: "name", direction: "asc" },
          stickyFirstColumn: true,
          expand: { render: (r) => <RigVersions rig={r} /> },
          empty: <EmptyState icon={Waypoints} title={m.equipment_no_rigs()} action={<ActionButton action={add} />} />,
          rowActions: (r) => recordMenu(m, catalog, "rig", r, () => setEditing({ rig: r })),
        }}
      />
      <RigDialog open={editing !== null} rig={editing?.rig ?? null} onClose={() => setEditing(null)} onSaved={onSaved} />
    </>
  )
}
