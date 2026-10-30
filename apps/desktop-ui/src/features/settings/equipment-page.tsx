/**
 * Settings › Equipment: saved rigs and cameras, filters, bands and camera defaults.
 * Rigs and cameras have independent revision-checked edit dialogs.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { type Camera, type ColorKind, type EquipmentInput, library, type Rig } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { Column, MenuItem } from "@/components/app/contracts"
import { NumberField, SelectField, SwitchField, TextField } from "@/components/app/fields"
import { blockedByErrors, type FieldPaths, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { formatList, numberText } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { Read } from "./parts"
import { RigFiltersDialog } from "./rig-filters-dialog"
import { camerasQuery, rigsQuery, settingsWrite } from "./queries"


type ColorChoice = ColorKind | "unknown"

function colorText(m: Messages, kind: ColorKind | null): string {
  return kind === "mono" ? m.equipment_mono() : kind === "osc" ? m.equipment_osc() : m.status_not_set()
}

const dash = (value: number | null) => (value === null ? "–" : numberText(value))

function rigColumns(m: Messages): Column<Rig>[] {
  return [
    { id: "name", header: m.equipment_name(), rowHeader: true, truncate: true, truncateMin: "name", sortValue: (r) => r.equipment.name, cell: (r) => r.equipment.name },
    { id: "camera", header: m.equipment_camera(), truncate: true, sortValue: (r) => r.equipment.camera, cell: (r) => r.equipment.camera ?? "–" },
    { id: "telescope", header: m.equipment_telescope(), truncate: true, sortValue: (r) => r.equipment.telescope, cell: (r) => r.equipment.telescope ?? "–" },
    { id: "focal", header: m.equipment_native_focal_length(), align: "right", sortValue: (r) => r.equipment.focalLengthMm, cell: (r) => dash(r.equipment.focalLengthMm) },
    { id: "kind", header: m.equipment_camera_kind(), sortValue: (r) => r.equipment.colorKind, cell: (r) => colorText(m, r.equipment.colorKind) },
    { id: "filters", header: m.equipment_filters(), truncate: true, sortValue: (r) => r.filters.filters.length, cell: (r) => (r.filters.filters.length > 0 ? formatList(r.filters.filters.map((f) => f.name)) : "–") },
    { id: "bands", header: m.equipment_bands(), sortValue: (r) => r.bands.length, cell: (r) => (r.bands.length > 0 ? formatList(r.bands) : "–") },
  ]
}

function cameraColumns(m: Messages): Column<Camera>[] {
  const yes = (on: boolean) => (on ? m.equipment_rotator_yes() : m.equipment_rotator_no())
  return [
    { id: "model", header: m.equipment_camera(), rowHeader: true, truncate: true, truncateMin: "name", sortValue: (c) => c.model, cell: (c) => c.model },
    { id: "alias", header: m.equipment_camera_alias(), truncate: true, sortValue: (c) => c.alias, cell: (c) => c.alias ?? "–" },
    { id: "darks", header: m.equipment_no_darks(), sortValue: (c) => (c.noDarks ? 1 : 0), cell: (c) => yes(c.noDarks) },
    { id: "bias", header: m.equipment_no_bias(), sortValue: (c) => (c.noBias ? 1 : 0), cell: (c) => yes(c.noBias) },
  ]
}

export function EquipmentPage() {
  const m = useMessages()
  const client = useQueryClient()
  const rigs = useQuery(rigsQuery())
  const cameras = useQuery(camerasQuery())
  // Only the id: the dialog reads the rig from the current read, so a Save after `conflict` names the revision read again.
  const [editing, setEditing] = useState<string | null>(null)
  const [editingCamera, setEditingCamera] = useState<string | null>(null)
  const editedCamera = editingCamera && editingCamera !== "new" ? cameras.data?.find((camera: Camera) => camera.id === editingCamera) : undefined
  const editedRig = editing && editing !== "new" ? rigs.data?.find((r: Rig) => r.equipment.id === editing) : undefined
  const [filtersOf, setFiltersOf] = useState<string | null>(null)
  const filtersRig = filtersOf ? rigs.data?.find((r) => r.equipment.id === filtersOf) : undefined
  const rigActions = (rig: Rig): MenuItem[] => [
    { id: "edit-rig", label: m.settings_edit(), opensDialog: true, run: () => setEditing(rig.equipment.id) },
    { id: "edit-rig-filters", label: m.equipment_edit_filters(), opensDialog: true, run: () => setFiltersOf(rig.equipment.id) },
    { separator: true },
    {
      id: "delete-rig",
      label: m.settings_remove(),
      kind: "destructive",
      confirm: { title: m.settings_remove_title({ name: rig.equipment.name }), confirm: { label: m.settings_remove(), kind: "destructive" } },
      run: () => settingsWrite(client, () => library.libraryDeleteEquipment(rig.equipment.id, rig.equipment.decisionRevision)),
    },
  ]
  const cameraActions = (camera: Camera): MenuItem[] => [
    { id: "edit-camera", label: m.settings_edit(), opensDialog: true, run: () => setEditingCamera(camera.id) },
    { separator: true },
    {
      id: "delete-camera",
      label: m.settings_remove(),
      kind: "destructive",
      confirm: { title: m.settings_remove_title({ name: camera.alias ?? camera.model }), confirm: { label: m.settings_remove(), kind: "destructive" } },
      run: () => settingsWrite(client, () => library.libraryDeleteCamera(camera.id, camera.revision)),
    },
  ]
  return (
    <SettingsPage title={m.settings_equipment()}>
      <Read query={rigs} label={m.project_rigs()}>
        {(rows) => (
          <ListSection
            title={m.project_rigs()}
            add={{ id: "add-rig", label: m.settings_add_rig(), icon: Plus, opensDialog: true, run: () => setEditing("new") }}
            table={{ label: m.project_rigs(), rows, columns: rigColumns(m), getRowId: (r) => r.equipment.id, rowLabel: (r) => r.equipment.name, rowActions: rigActions, stickyFirstColumn: true, empty: m.equipment_no_rigs() }}
          />
        )}
      </Read>
      <Read query={cameras} label={m.equipment_cameras()}>
        {(rows) => (
          <ListSection
            title={m.equipment_cameras()}
            table={{ label: m.equipment_cameras(), rows, columns: cameraColumns(m), getRowId: (c) => c.id, rowLabel: (c) => c.alias ?? c.model, rowActions: cameraActions, empty: m.equipment_no_cameras() }}
            add={{ id: "add-camera", label: m.equipment_add_camera(), icon: Plus, opensDialog: true, run: () => setEditingCamera("new") }}
          />
        )}
      </Read>
      {editingCamera === "new" || editedCamera ? <CameraDialog camera={editedCamera ?? null} open onOpenChange={(open) => !open && setEditingCamera(null)} /> : null}
      {editing === "new" || editedRig ? <RigDialog rig={editedRig ?? null} open onOpenChange={(open) => !open && setEditing(null)} /> : null}
      {filtersRig ? <RigFiltersDialog rig={filtersRig} open onOpenChange={(open) => !open && setFiltersOf(null)} /> : null}
    </SettingsPage>
  )
}

interface RigDraft {
  name: string
  camera: string
  telescope: string
  focalLengthMm: number | null
  pixelSizeUm: number | null
  sensorWidthPx: number | null
  sensorHeightPx: number | null
  colorKind: ColorChoice
}
const RIG_PATHS: FieldPaths<keyof RigDraft> = {
  name: "name",
  focalLengthMm: "focalLengthMm",
  pixelSizeUm: "pixelSizeUm",
  sensorWidthPx: "sensorWidthPx",
  sensorHeightPx: "sensorHeightPx",
}


function draftOf(rig: Rig | null): RigDraft {
  const e = rig?.equipment
  return {
    name: e?.name ?? "",
    camera: e?.camera ?? "",
    telescope: e?.telescope ?? "",
    focalLengthMm: e?.focalLengthMm ?? null,
    pixelSizeUm: e?.pixelSizeUm ?? null,
    sensorWidthPx: e?.sensorWidthPx ?? null,
    sensorHeightPx: e?.sensorHeightPx ?? null,
    colorKind: e?.colorKind ?? "unknown",
  }
}

function inputOf(rig: Rig | null, draft: RigDraft): EquipmentInput {
  const text = (value: string) => value.trim() || null
  return {
    id: rig?.equipment.id ?? null,
    name: draft.name.trim(),
    camera: text(draft.camera),
    telescope: text(draft.telescope),
    focalLengthMm: draft.focalLengthMm,
    pixelSizeUm: draft.pixelSizeUm,
    sensorWidthPx: draft.sensorWidthPx,
    sensorHeightPx: draft.sensorHeightPx,
    colorKind: draft.colorKind === "unknown" ? null : draft.colorKind,
  }
}

const positive = (value: number | null) => value === null || (Number.isFinite(value) && value > 0)
const wholePositive = (value: number | null) => value === null || (Number.isInteger(value) && value > 0)

/** Add rig… or Edit…: the rig's name, camera and optics; every measurement is optional and positive. */
function RigDialog({ rig, open, onOpenChange }: { rig: Rig | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown, refusing } = useDialogForm<RigDraft>(open, () => draftOf(rig))
  const label = m.settings_save()
  const errors = {
    name: values.name.trim() ? undefined : m.settings_name_required(),
    focalLengthMm: positive(values.focalLengthMm) ? undefined : m.equipment_error_mm(),
    pixelSizeUm: positive(values.pixelSizeUm) ? undefined : m.equipment_error_microns(),
    sensorWidthPx: wholePositive(values.sensorWidthPx) ? undefined : m.equipment_error_whole_pixels(),
    sensorHeightPx: wholePositive(values.sensorHeightPx) ? undefined : m.equipment_error_whole_pixels(),
  }
  const kinds: { value: ColorChoice; label: string }[] = [
    { value: "unknown", label: m.status_not_set() },
    { value: "mono", label: m.equipment_mono() },
    { value: "osc", label: m.equipment_osc_colour() },
  ]
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={rig ? m.settings_edit_title({ name: rig.equipment.name }) : m.settings_add_rig()}
      confirm={{
        id: "save-rig",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => refusing(settingsWrite(client, () => library.librarySaveEquipment(inputOf(rig, values), rig ? rig.equipment.decisionRevision : null)), RIG_PATHS),
      }}
    >
      <TextField label={m.equipment_rig_name()} value={values.name} onChange={(name) => set({ name })} error={shown(errors, "name")} autoFocus />
      <TextField label={m.equipment_camera()} value={values.camera} onChange={(camera) => set({ camera })} />
      <SelectField<ColorChoice> label={m.equipment_camera_kind()} value={values.colorKind} options={kinds} onChange={(colorKind) => set({ colorKind })} />
      <TextField label={m.equipment_telescope()} value={values.telescope} onChange={(telescope) => set({ telescope })} />
      <NumberField label={m.equipment_native_focal_length()} min={1} step={1} value={values.focalLengthMm} onChange={(focalLengthMm) => set({ focalLengthMm })} error={shown(errors, "focalLengthMm")} />
      <NumberField label={m.equipment_pixel_size()} min={0.1} step={0.01} value={values.pixelSizeUm} onChange={(pixelSizeUm) => set({ pixelSizeUm })} error={shown(errors, "pixelSizeUm")} />
      <NumberField label={m.equipment_sensor_width()} min={1} step={1} value={values.sensorWidthPx} onChange={(sensorWidthPx) => set({ sensorWidthPx })} error={shown(errors, "sensorWidthPx")} />
      <NumberField label={m.equipment_sensor_height()} min={1} step={1} value={values.sensorHeightPx} onChange={(sensorHeightPx) => set({ sensorHeightPx })} error={shown(errors, "sensorHeightPx")} />
    </FormDialog>
  )
}

interface CameraDraft {
  model: string
  alias: string
  noDarks: boolean
  noBias: boolean
}
const CAMERA_PATHS: FieldPaths<keyof CameraDraft> = { model: "0.model", alias: "0.alias" }

function cameraDraftOf(camera: Camera | null): CameraDraft {
  return {
    model: camera?.model ?? "",
    alias: camera?.alias ?? "",
    noDarks: camera?.noDarks ?? false,
    noBias: camera?.noBias ?? false,
  }
}

function CameraDialog({ camera, open, onOpenChange }: { camera: Camera | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown, refusing } = useDialogForm<CameraDraft>(open, () => cameraDraftOf(camera))
  const label = m.settings_save()
  const errors = { model: values.model.trim() ? undefined : m.settings_name_required() }
  const save = () => settingsWrite(client, () => library.librarySaveCamera({
    id: camera?.id ?? null,
    model: values.model.trim(),
    alias: values.alias.trim() || null,
    noDarks: values.noDarks,
    noBias: values.noBias,
  }, camera?.revision ?? null))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={camera ? m.settings_edit_title({ name: camera.alias ?? camera.model }) : m.equipment_add_camera()}
      confirm={{ id: "save-camera", label, kind: "primary", unavailable: blockedByErrors(m, label, errors), run: () => refusing(save(), CAMERA_PATHS) }}
    >
      <TextField label={m.equipment_camera()} value={values.model} onChange={(model) => set({ model })} error={shown(errors, "model")} autoFocus />
      <TextField label={m.equipment_camera_alias()} value={values.alias} onChange={(alias) => set({ alias })} error={shown(errors, "alias")} />
      <SwitchField label={m.equipment_no_darks()} checked={values.noDarks} onChange={(noDarks) => set({ noDarks })} />
      <SwitchField label={m.equipment_no_bias()} checked={values.noBias} onChange={(noBias) => set({ noBias })} />
    </FormDialog>
  )
}
