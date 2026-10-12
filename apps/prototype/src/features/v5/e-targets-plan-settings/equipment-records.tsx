/**
 * Settings › Equipment, by hand (slice E, Round 6): gear not yet imaged with
 * is added as Manual (Add camera…, Add telescope…, Add rig…), and detected
 * cameras and telescopes are renamed and edited here too. A rig is a camera
 * on a telescope with the telescope's focal length and a reducer; its
 * effective focal length is their product. Cameras and telescopes list in
 * tables whose rows open their editor on click.
 */
import { type FormEvent, useEffect, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { type Column, DataTable } from "@/components/app/data-table"
import { ActionError } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fieldOfView } from "@/domain/sky"
import type { Camera, CameraKind, Telescope } from "@/domain/types"
import { FieldMessage, focusFirstInvalid, parseNumber, TextField } from "@/features/t1/components/form-field"
import { formatDecimal, formatDegrees } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { addRig, saveCamera, saveTelescope } from "./settings-actions"

/** "1.23° × 0.82° · 1.45″/px": units only, not translated. */
export function formatFov(fov: { widthDeg: number; heightDeg: number; pixelScaleArcsec: number } | null): string {
  return fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)} · ${fov.pixelScaleArcsec.toFixed(2)}″/px` : "–"
}

const positive = (v: number | null, whole = false) => v !== null && !Number.isNaN(v) && v > 0 && (!whole || Number.isInteger(v))

/** "1600 mm", or "–" without a value: units only, not translated. */
function formatMm(value: number | null): string {
  return value ? `${formatDecimal(value, value % 1 === 0 ? 0 : 1)} mm` : "–"
}

/** Mono or OSC (colour), a two-option radio group. */
export function CameraKindField({ value, onChange }: { value: CameraKind; onChange: (kind: CameraKind) => void }) {
  const m = useMessages()
  const id = useId()
  return (
    <fieldset className="space-y-1.5">
      <legend id={id} className="text-sm font-medium">
        {m.equipment_camera_kind()}
      </legend>
      <div role="radiogroup" aria-labelledby={id} className="inline-flex rounded-md border border-separator p-px">
        {(["mono", "osc"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} className={cn("h-6 rounded-[4px] px-2 text-sm", value === k ? "bg-selected text-selected-foreground" : "hover:bg-foreground/[0.06]")}>
            {k === "mono" ? m.equipment_mono() : m.equipment_osc_colour()}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** Add a camera (`camera` null) or edit one: name, kind, sensor and pixel size. */
export function CameraDialog({ open, camera, onClose }: { open: boolean; camera: Camera | null; onClose: () => void }) {
  const m = useMessages()
  const init = () => ({ name: camera?.name ?? "", kind: camera?.kind ?? ("mono" as CameraKind), width: camera ? String(camera.widthPx) : "", height: camera ? String(camera.heightPx) : "", pixel: camera ? String(camera.pixelSizeUm) : "" })
  const [values, setValues] = useState(init)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const ids = { name: useId(), width: useId(), height: useId(), pixel: useId() }
  useEffect(() => {
    if (open) {
      setValues(init())
      setErrors({})
      setFailure(null)
    }
    // Reset only when the dialog opens.
  }, [open])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const [width, height, pixel] = [values.width, values.height, values.pixel].map(parseNumber)
    const next = {
      name: values.name.trim() ? undefined : m.targets_name_empty({ label: m.equipment_name() }),
      width: positive(width ?? null, true) ? undefined : m.equipment_error_whole_pixels(),
      height: positive(height ?? null, true) ? undefined : m.equipment_error_whole_pixels(),
      pixel: positive(pixel ?? null) ? undefined : m.equipment_error_microns(),
    }
    setErrors(next)
    if (Object.values(next).some(Boolean)) return focusFirstInvalid(event.currentTarget)
    const result = saveCamera(camera?.id ?? null, { name: values.name.trim(), kind: values.kind, widthPx: width!, heightPx: height!, pixelSizeUm: pixel! })
    if (result.ok) onClose()
    else setFailure(result.message)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg" data-camera-dialog>
        <form onSubmit={submit} noValidate className="space-y-3">
          <DialogHeader>
            <DialogTitle>{camera ? m.settings_edit_title({ name: camera.name }) : m.equipment_add_camera()}</DialogTitle>
          </DialogHeader>
          <TextField id={ids.name} label={m.equipment_name()} value={values.name} onChange={(name) => setValues({ ...values, name })} error={errors.name} autoFocus />
          <CameraKindField value={values.kind} onChange={(kind) => setValues({ ...values, kind })} />
          <div className="grid grid-cols-3 gap-3">
            <TextField id={ids.width} label={m.equipment_sensor_width()} inputMode="numeric" value={values.width} onChange={(width) => setValues({ ...values, width })} error={errors.width} />
            <TextField id={ids.height} label={m.equipment_sensor_height()} inputMode="numeric" value={values.height} onChange={(height) => setValues({ ...values, height })} error={errors.height} />
            <TextField id={ids.pixel} label={m.equipment_pixel_size()} inputMode="decimal" value={values.pixel} onChange={(pixel) => setValues({ ...values, pixel })} error={errors.pixel} />
          </div>
          {failure ? <ActionError message={failure} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {m.verb_cancel()}
            </Button>
            <Button type="submit">{failure ? m.verb_retry() : camera ? m.settings_save() : m.equipment_add_camera()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Add a telescope (`telescope` null) or edit one: name, focal length and aperture. */
export function TelescopeDialog({ open, telescope, onClose }: { open: boolean; telescope: Telescope | null; onClose: () => void }) {
  const m = useMessages()
  const init = () => ({ name: telescope?.name ?? "", focal: telescope ? String(telescope.focalLengthMm) : "", aperture: telescope?.apertureMm ? String(telescope.apertureMm) : "" })
  const [values, setValues] = useState(init)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const ids = { name: useId(), focal: useId(), aperture: useId() }
  useEffect(() => {
    if (open) {
      setValues(init())
      setErrors({})
      setFailure(null)
    }
    // Reset only when the dialog opens.
  }, [open])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const focal = parseNumber(values.focal)
    const aperture = parseNumber(values.aperture)
    const next = {
      name: values.name.trim() ? undefined : m.targets_name_empty({ label: m.equipment_name() }),
      focal: positive(focal) ? undefined : m.equipment_error_mm(),
      aperture: aperture === null || positive(aperture) ? undefined : m.equipment_error_mm(),
    }
    setErrors(next)
    if (Object.values(next).some(Boolean)) return focusFirstInvalid(event.currentTarget)
    const result = saveTelescope(telescope?.id ?? null, { name: values.name.trim(), focalLengthMm: focal!, apertureMm: aperture })
    if (result.ok) onClose()
    else setFailure(result.message)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" data-telescope-dialog>
        <form onSubmit={submit} noValidate className="space-y-3">
          <DialogHeader>
            <DialogTitle>{telescope ? m.settings_edit_title({ name: telescope.name }) : m.equipment_add_telescope()}</DialogTitle>
          </DialogHeader>
          <TextField id={ids.name} label={m.equipment_name()} value={values.name} onChange={(name) => setValues({ ...values, name })} error={errors.name} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <TextField id={ids.focal} label={m.equipment_native_focal_length()} inputMode="decimal" value={values.focal} onChange={(focal) => setValues({ ...values, focal })} error={errors.focal} />
            <TextField id={ids.aperture} label={m.equipment_aperture()} inputMode="decimal" value={values.aperture} onChange={(aperture) => setValues({ ...values, aperture })} error={errors.aperture} />
          </div>
          {failure ? <ActionError message={failure} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {m.verb_cancel()}
            </Button>
            <Button type="submit">{failure ? m.verb_retry() : telescope ? m.settings_save() : m.equipment_add_telescope()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A select of records by name; `error` marks it invalid after a submit. */
function RecordSelect({ id, label, value, items, onChange, error }: { id: string; label: string; value: string | null; items: Array<{ value: string; label: string }>; onChange: (value: string) => void; error?: string }) {
  return (
    <div className="space-y-1.5">
      <Label id={`${id}-label`}>{label}</Label>
      <Select items={items} value={value} onValueChange={(next) => onChange(String(next))}>
        <SelectTrigger id={id} aria-labelledby={`${id}-label`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldMessage id={`${id}-error`} message={error} />
    </div>
  )
}

/** Add rig…: a camera on a telescope with a focal length and reducer. The rig is Manual; returns its id through `onAdded`. */
export function AddRigDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (rigId: string) => void }) {
  const m = useMessages()
  const cameras = useStore((s) => Object.values(s.catalog.cameras).sort((a, b) => a.name.localeCompare(b.name)))
  const telescopes = useStore((s) => Object.values(s.catalog.telescopes).sort((a, b) => a.name.localeCompare(b.name)))
  const init = () => ({ name: "", named: false, cameraId: null as string | null, telescopeId: null as string | null, focal: "", reducer: "1" })
  const [values, setValues] = useState(init)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const ids = { name: useId(), camera: useId(), telescope: useId(), focal: useId(), reducer: useId() }
  useEffect(() => {
    if (open) {
      setValues(init())
      setErrors({})
      setFailure(null)
    }
    // Reset only when the dialog opens.
  }, [open])

  const camera = cameras.find((c) => c.id === values.cameraId)
  const telescope = telescopes.find((t) => t.id === values.telescopeId)
  const focal = parseNumber(values.focal)
  const reducer = parseNumber(values.reducer)
  const effective = positive(focal) && positive(reducer) ? Math.round(focal! * reducer! * 10) / 10 : null
  const fov = camera && effective ? fieldOfView({ id: "draft", name: values.name, source: "manual", cameraId: camera.id, telescopeId: values.telescopeId, effectiveFocalLengthMm: effective, notes: "", filters: [] }, camera) : null
  /** The suggested name follows the picks until the user types one. */
  const suggested = (cam: Camera | undefined, tel: Telescope | undefined) => (cam && tel ? m.equipment_rig_suggested({ telescope: tel.name, camera: cam.name }) : "")

  function pick(patch: Partial<typeof values>) {
    setValues((prev) => {
      const next = { ...prev, ...patch }
      const tel = telescopes.find((t) => t.id === next.telescopeId)
      if (patch.telescopeId && tel) next.focal = String(tel.focalLengthMm)
      if (!next.named) next.name = suggested(cameras.find((c) => c.id === next.cameraId), tel)
      return next
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = {
      name: values.name.trim() ? undefined : m.targets_name_empty({ label: m.equipment_rig_name() }),
      camera: camera ? undefined : m.equipment_error_choose(),
      telescope: telescope ? undefined : m.equipment_error_choose(),
      focal: positive(focal) ? undefined : m.equipment_error_mm(),
      reducer: reducer !== null && reducer >= 0.2 && reducer <= 3 ? undefined : m.equipment_error_reducer(),
    }
    setErrors(next)
    if (Object.values(next).some(Boolean)) return focusFirstInvalid(event.currentTarget)
    const { result, id } = addRig({ name: values.name.trim(), cameraId: camera!.id, telescopeId: telescope!.id, focalLengthMm: focal!, reducer: reducer! })
    if (!result.ok) return setFailure(result.message)
    onClose()
    onAdded(id)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg" data-rig-dialog>
        <form onSubmit={submit} noValidate className="space-y-3">
          <DialogHeader>
            <DialogTitle>{m.project_add_rig()}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <RecordSelect id={ids.camera} label={m.equipment_camera()} value={values.cameraId} items={cameras.map((c) => ({ value: c.id, label: c.name }))} onChange={(cameraId) => pick({ cameraId })} error={errors.camera} />
            <RecordSelect id={ids.telescope} label={m.equipment_telescope()} value={values.telescopeId} items={telescopes.map((t) => ({ value: t.id, label: t.name }))} onChange={(telescopeId) => pick({ telescopeId })} error={errors.telescope} />
            <TextField id={ids.focal} label={m.equipment_native_focal_length()} inputMode="decimal" value={values.focal} onChange={(f) => setValues({ ...values, focal: f })} error={errors.focal} />
            <TextField id={ids.reducer} label={m.equipment_reducer_field()} inputMode="decimal" value={values.reducer} onChange={(r) => setValues({ ...values, reducer: r })} error={errors.reducer} />
          </div>
          <TextField id={ids.name} label={m.equipment_rig_name()} value={values.name} onChange={(name) => setValues({ ...values, name, named: name.trim() !== "" })} error={errors.name} />
          <p className="text-sm tabular-nums" aria-live="polite" data-rig-preview>
            <span className="text-muted-foreground">{m.equipment_focal_length()} </span>
            {formatMm(effective)}
            <span className="text-muted-foreground"> · {m.equipment_field_of_view()} </span>
            {formatFov(fov)}
          </p>
          {failure ? <ActionError message={failure} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {m.verb_cancel()}
            </Button>
            <Button type="submit">{failure ? m.verb_retry() : m.project_add_rig()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Every camera, detected or Manual; a row opens its editor. */
export function CamerasTable() {
  const m = useMessages()
  const cameras = useStore((s) => Object.values(s.catalog.cameras))
  const rigs = useStore((s) => s.catalog.opticalTrains)
  const [editing, setEditing] = useState<Camera | null>(null)
  const usedBy = (id: string) => Object.values(rigs).filter((r) => r.cameraId === id).length
  const columns: Column<Camera>[] = [
    { id: "name", header: m.equipment_name(), cell: (c) => c.name, sortValue: (c) => c.name, rowHeader: true, truncate: true },
    { id: "kind", header: m.equipment_camera_kind(), cell: (c) => (c.kind === "osc" ? m.equipment_osc() : m.equipment_mono()), sortValue: (c) => c.kind },
    { id: "sensor", header: m.equipment_sensor(), cell: (c) => `${c.widthPx} × ${c.heightPx} px · ${formatDecimal(c.pixelSizeUm, 2)} µm`, className: "tabular-nums" },
    { id: "rigs", header: m.project_rigs(), cell: (c) => usedBy(c.id), sortValue: (c) => usedBy(c.id), align: "right" },
    { id: "source", header: m.equipment_source(), cell: (c) => <StatusBadge kind="source" value={c.source} />, sortValue: (c) => c.source },
  ]
  return (
    <>
      <DataTable label={m.equipment_cameras()} rows={cameras} columns={columns} getRowId={(c) => c.id} initialSort={{ columnId: "name", direction: "asc" }} scroll="none" onRowClick={setEditing} contextMenu={(c) => [{ label: m.settings_edit(), onSelect: () => setEditing(c) }]} empty={<p className="p-3 text-sm text-muted-foreground">–</p>} />
      <CameraDialog open={editing !== null} camera={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/** Every telescope, detected or Manual; a row opens its editor. */
export function TelescopesTable() {
  const m = useMessages()
  const telescopes = useStore((s) => Object.values(s.catalog.telescopes))
  const rigs = useStore((s) => s.catalog.opticalTrains)
  const [editing, setEditing] = useState<Telescope | null>(null)
  const usedBy = (id: string) => Object.values(rigs).filter((r) => r.telescopeId === id).length
  const columns: Column<Telescope>[] = [
    { id: "name", header: m.equipment_name(), cell: (t) => t.name, sortValue: (t) => t.name, rowHeader: true, truncate: true },
    { id: "focal", header: m.run_field_focal_length(), cell: (t) => `${formatDecimal(t.focalLengthMm, 0)} mm`, sortValue: (t) => t.focalLengthMm, align: "right", className: "tabular-nums" },
    { id: "aperture", header: m.equipment_aperture_short(), cell: (t) => (t.apertureMm ? `${formatDecimal(t.apertureMm, 0)} mm` : "–"), sortValue: (t) => t.apertureMm, align: "right", className: "tabular-nums" },
    { id: "rigs", header: m.project_rigs(), cell: (t) => usedBy(t.id), sortValue: (t) => usedBy(t.id), align: "right" },
    { id: "source", header: m.equipment_source(), cell: (t) => <StatusBadge kind="source" value={t.source} />, sortValue: (t) => t.source },
  ]
  return (
    <>
      <DataTable label={m.equipment_telescopes()} rows={telescopes} columns={columns} getRowId={(t) => t.id} initialSort={{ columnId: "name", direction: "asc" }} scroll="none" onRowClick={setEditing} contextMenu={(t) => [{ label: m.settings_edit(), onSelect: () => setEditing(t) }]} empty={<p className="p-3 text-sm text-muted-foreground">–</p>} />
      <TelescopeDialog open={editing !== null} telescope={editing} onClose={() => setEditing(null)} />
    </>
  )
}
