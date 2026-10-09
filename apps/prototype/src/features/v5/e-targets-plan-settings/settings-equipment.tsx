/**
 * S16 Settings › Equipment (slice E; D-W31, PLAN-EQ-FR-01 to PLAN-EQ-FR-06).
 * A rig is one optical train: a camera (mono or OSC, sensor size, pixel
 * size), a telescope and its effective focal length, the derived field of
 * view, and a plain filter list where each filter names the FITS FILTER
 * values it matches and the bands it passes. The list drives the Targets band
 * strip, the narrowband presets and Fit; it never filters Goal templates.
 * A FILTER value seen on a rig's sessions that matches no filter prompts
 * "Add {value} to {rig}"; declining keeps the prompt available.
 */
import { useSearch } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList } from "@/components/app/data"
import { ActionError, Notice, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { liveLightSessions, rigBands, rigCameraKind, rigFieldOfView, sessionRigId, unknownFilterValues } from "@/domain/derive"
import { BANDS, NARROW_BANDS } from "@/domain/labels"
import { fieldOfView } from "@/domain/sky"
import type { Band, CameraKind, Catalog, OpticalTrain, RigFilter } from "@/domain/types"
import { TextField, parseAliases, parseNumber } from "@/features/t1/components/form-field"
import { ReturnNotice } from "@/features/t1/settings/settings-layout"
import { formatDegrees, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { addFilterToRig, renameRig, setRigFilters } from "@/store/actions/settings"
import { freshId } from "@/store/actions/shared"
import { type CommitResult, useStore } from "@/store/core"
import { NameDialog } from "./dialogs"
import { updateRigOptics } from "./settings-actions"

/** Bands a header value most likely passes, to prefill "Add {value}". The user confirms them. */
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
  return [...found]
}

function sessionsWithValue(catalog: Catalog, rigId: string, value: string): number {
  return liveLightSessions(catalog).filter((s) => sessionRigId(s) === rigId && s.channel === value).length
}

interface FilterDraft {
  /** The filter edited, or null to add one. */
  id: string | null
  name: string
  matches: string
  bands: Band[]
  /** Set when the dialog came from an unknown header value. */
  fromHeader: string | null
}

function FilterDialog({ rig, draft, onClose }: { rig: OpticalTrain; draft: FilterDraft | null; onClose: () => void }) {
  const [values, setValues] = useState<FilterDraft | null>(draft)
  const [errors, setErrors] = useState<{ name?: string; bands?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const ids = { name: useId(), matches: useId(), bands: useId() }
  useEffect(() => {
    setValues(draft)
    setErrors({})
    setFailure(null)
  }, [draft])
  if (!values) return null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!values) return
    const name = values.name.trim()
    const next: typeof errors = {}
    if (!name) next.name = "Name: enter the filter's name, for example Ha."
    else if (rig.filters.some((f) => f.id !== values.id && f.name.toLowerCase() === name.toLowerCase())) next.name = `Name: ${rig.name} already has a filter named ${name}.`
    if (values.bands.length === 0) next.bands = "Bands: choose at least one band the filter passes."
    setErrors(next)
    if (next.name || next.bands) return
    const matches = parseAliases(values.matches)
    let result: CommitResult
    if (values.fromHeader && values.id === null) result = addFilterToRig(rig.id, name, values.bands)
    else {
      const record: RigFilter = { id: values.id ?? freshId("flt", `${rig.id}|${name}`), name, matches: matches.length > 0 ? matches : [name], bands: values.bands }
      result = setRigFilters(rig.id, values.id ? rig.filters.map((f) => (f.id === values.id ? record : f)) : [...rig.filters, record])
    }
    if (result.ok) onClose()
    else setFailure(result.message)
  }

  const title = values.fromHeader ? `Add ${values.fromHeader} to ${rig.name}` : values.id ? `Edit filter ${values.name}` : `Add a filter to ${rig.name}`
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {values.fromHeader
                ? "Only this rig's settings change. The sessions' header bytes and observed values stay as read."
                : "A filter names the FITS FILTER values it matches and the bands it passes. A dual-band filter passes two."}
            </DialogDescription>
          </DialogHeader>
          <TextField id={ids.name} label="Name" value={values.name} onChange={(name) => setValues({ ...values, name })} error={errors.name} readOnly={Boolean(values.fromHeader)} />
          {values.fromHeader ? null : (
            <TextField id={ids.matches} label="Matches FILTER values" description="Comma-separated, compared case-insensitively. Empty: the name only." value={values.matches} onChange={(matches) => setValues({ ...values, matches })} mono />
          )}
          <fieldset className="space-y-1.5" aria-describedby={errors.bands ? `${ids.bands}-error` : undefined}>
            <legend className="text-sm font-medium">Bands it passes</legend>
            <div className="flex flex-wrap gap-3">
              {BANDS.map((band) => (
                <label key={band} className="inline-flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={values.bands.includes(band)}
                    onCheckedChange={(checked) => setValues({ ...values, bands: checked ? [...values.bands, band] : values.bands.filter((b) => b !== band) })}
                  />
                  {band}
                </label>
              ))}
            </div>
            {errors.bands ? <ActionError id={`${ids.bands}-error`} message={errors.bands} /> : null}
          </fieldset>
          {failure ? <ActionError message={failure} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{failure ? "Retry" : values.fromHeader ? `Add ${values.fromHeader}` : "Save filter"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function OpticsDialog({ rig, open, onClose }: { rig: OpticalTrain; open: boolean; onClose: () => void }) {
  const catalog = useStore((s) => s.catalog)
  const camera = rig.cameraId ? catalog.cameras[rig.cameraId] : undefined
  const sharing = camera ? Object.values(catalog.opticalTrains).filter((r) => r.cameraId === camera.id) : []
  const init = () => ({ kind: camera?.kind ?? "mono", width: camera ? String(camera.widthPx) : "", height: camera ? String(camera.heightPx) : "", pixel: camera ? String(camera.pixelSizeUm) : "", focal: String(rig.effectiveFocalLengthMm) })
  const [values, setValues] = useState(init)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const ids = { width: useId(), height: useId(), pixel: useId(), focal: useId(), kind: useId() }
  useEffect(() => {
    if (open) {
      setValues(init())
      setErrors({})
      setFailure(null)
    }
    // Reset only when the dialog opens.
  }, [open])

  const num = (v: string) => parseNumber(v)
  const width = num(values.width)
  const height = num(values.height)
  const pixel = num(values.pixel)
  const focal = num(values.focal)
  const preview =
    camera && width && height && pixel && focal && width > 0 && height > 0 && pixel > 0 && focal > 0
      ? fieldOfView({ ...rig, effectiveFocalLengthMm: focal }, { ...camera, widthPx: width, heightPx: height, pixelSizeUm: pixel })
      : null

  function submit(event: FormEvent) {
    event.preventDefault()
    const positive = (v: number | null, whole: boolean) => v !== null && !Number.isNaN(v) && v > 0 && (!whole || Number.isInteger(v))
    const next: Record<string, string | undefined> = {
      width: camera && !positive(width, true) ? "Sensor width: enter a whole number of pixels greater than 0." : undefined,
      height: camera && !positive(height, true) ? "Sensor height: enter a whole number of pixels greater than 0." : undefined,
      pixel: camera && !positive(pixel, false) ? "Pixel size: enter micrometres greater than 0, for example 3.76." : undefined,
      focal: !positive(focal, false) ? "Effective focal length: enter millimetres greater than 0, for example 250." : undefined,
    }
    setErrors(next)
    if (Object.values(next).some(Boolean)) return
    const result = updateRigOptics(rig.id, { focalLengthMm: focal!, camera: camera ? { kind: values.kind as CameraKind, widthPx: width!, heightPx: height!, pixelSizeUm: pixel! } : null })
    if (result.ok) onClose()
    else setFailure(result.message)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-3">
          <DialogHeader>
            <DialogTitle>Optics of {rig.name}</DialogTitle>
            <DialogDescription>
              {camera
                ? sharing.length > 1
                  ? `Camera values belong to ${camera.name} and change for every rig that uses it (${sharing.map((r) => r.name).join(", ")}). The focal length is this rig's own.`
                  : `Camera values belong to ${camera.name}. The focal length is this rig's own.`
                : "This rig has no camera record, so its field of view stays unknown. The focal length is this rig's own."}
            </DialogDescription>
          </DialogHeader>
          {camera ? (
            <>
              <fieldset className="space-y-1.5">
                <legend id={ids.kind} className="text-sm font-medium">
                  Camera kind
                </legend>
                <div role="radiogroup" aria-labelledby={ids.kind} className="inline-flex rounded-md border border-separator p-px">
                  {(["mono", "osc"] as const).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={values.kind === k} onClick={() => setValues({ ...values, kind: k })} className={cn("h-6 rounded-[4px] px-2 text-sm", values.kind === k ? "bg-selected text-selected-foreground" : "hover:bg-foreground/[0.06]")}>
                      {k === "mono" ? "Mono" : "OSC (colour)"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Mono or OSC comes from the camera, never from the filter list. An OSC camera captures R, G and B without a filter.</p>
              </fieldset>
              <div className="grid grid-cols-3 gap-3">
                <TextField id={ids.width} label="Sensor width (px)" inputMode="numeric" value={values.width} onChange={(width) => setValues({ ...values, width })} error={errors.width} />
                <TextField id={ids.height} label="Sensor height (px)" inputMode="numeric" value={values.height} onChange={(height) => setValues({ ...values, height })} error={errors.height} />
                <TextField id={ids.pixel} label="Pixel size (µm)" inputMode="decimal" value={values.pixel} onChange={(pixel) => setValues({ ...values, pixel })} error={errors.pixel} />
              </div>
            </>
          ) : null}
          <TextField id={ids.focal} label="Effective focal length (mm)" inputMode="decimal" value={values.focal} onChange={(f) => setValues({ ...values, focal: f })} error={errors.focal} className="max-w-56" />
          <p className="text-sm" aria-live="polite">
            <span className="text-muted-foreground">Field of view: </span>
            {preview ? `${formatDegrees(preview.widthDeg, 2)} × ${formatDegrees(preview.heightDeg, 2)} · ${preview.pixelScaleArcsec.toFixed(2)}″/px` : "unknown until every value is set"}
          </p>
          {failure ? <ActionError message={failure} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{failure ? "Retry" : "Save optics"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RigBlock({ rig, highlighted }: { rig: OpticalTrain; highlighted: boolean }) {
  const catalog = useStore((s) => s.catalog)
  const [filterDraft, setFilterDraft] = useState<FilterDraft | null>(null)
  const [removing, setRemoving] = useState<RigFilter | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [optics, setOptics] = useState(false)
  const [declined, setDeclined] = useState<string[]>([])
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "start" })
  }, [highlighted])

  const camera = rig.cameraId ? catalog.cameras[rig.cameraId] : undefined
  const telescope = rig.telescopeId ? catalog.telescopes[rig.telescopeId] : undefined
  const kind = rigCameraKind(catalog, rig)
  const fov = rigFieldOfView(catalog, rig)
  const bands = rigBands(catalog, rig)
  const unknown = unknownFilterValues(catalog, rig.id)
  const projects = Object.values(catalog.projects).filter((p) => p.rigIds.includes(rig.id))
  const headingId = `rig-${rig.id}`

  return (
    <section ref={ref} aria-labelledby={headingId} className={cn("scroll-mt-14 space-y-3 rounded-md border p-3", highlighted && "border-primary")} data-rig={rig.id}>
      <div className="flex flex-wrap items-center gap-2" data-chrome>
        <h3 id={headingId} className="text-sm font-semibold">
          {rig.name}
        </h3>
        <StatusBadge kind="source" value={rig.source} />
        <span className="text-[0.75rem] text-muted-foreground">{kind === "osc" ? "OSC" : kind === "mono" ? "Mono" : "Camera unknown"}</span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
          <Pencil aria-hidden="true" data-icon="inline-start" />
          Rename<span className="sr-only"> {rig.name}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOptics(true)}>
          Edit optics<span className="sr-only"> of {rig.name}</span>
        </Button>
      </div>
      {unknown
        .filter((v) => !declined.includes(v))
        .map((value) => (
          <Notice
            key={value}
            tone="warning"
            title={`FILTER “${value}” matches no filter on ${rig.name}`}
            actions={
              <>
                <Button size="sm" onClick={() => setFilterDraft({ id: null, name: value, matches: value, bands: guessBands(value), fromHeader: value })}>
                  Add {value} to {rig.name}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeclined([...declined, value])}>
                  Not now
                </Button>
              </>
            }
          >
            Seen on {plural(sessionsWithValue(catalog, rig.id, value), "session")}. Until it is added, those sessions show the filter as unknown and count toward no band.
          </Notice>
        ))}
      {declined.filter((v) => unknown.includes(v)).length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Not added: {declined.filter((v) => unknown.includes(v)).join(", ")}.{" "}
          <button type="button" className="text-link hover:underline" onClick={() => setDeclined([])}>
            Show the prompt again
          </button>
        </p>
      ) : null}
      <KeyValueList
        columns={2}
        items={[
          { label: "Camera", value: camera ? `${camera.name} · ${camera.kind === "osc" ? "OSC" : "Mono"}` : <UnknownValue label="Not set" reason="No camera record, so the field of view is unknown" /> },
          { label: "Sensor", value: camera ? `${camera.widthPx} × ${camera.heightPx} px · ${camera.pixelSizeUm} µm` : <UnknownValue label="Unknown" /> },
          { label: "Telescope", value: telescope ? `${telescope.name}${telescope.apertureMm ? ` · ${telescope.apertureMm} mm aperture` : ""}` : <UnknownValue label="Not set" /> },
          { label: "Focal length", value: `${rig.effectiveFocalLengthMm} mm effective` },
          {
            label: "Field of view",
            value: fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)} · ${fov.pixelScaleArcsec.toFixed(2)}″/px` : <UnknownValue label="FOV unknown" reason="Needs the camera's sensor and pixel size and the focal length; Fit reads – until then" />,
            source: fov ? "Derived" : undefined,
          },
          { label: "Bands", value: bands.length > 0 ? bands.join(", ") : "None: add a filter", source: kind === "osc" ? "R, G, B from the OSC camera" : undefined },
          { label: "Used by", value: projects.length > 0 ? projects.map((p) => p.name).join(", ") : "No Project" },
        ]}
      />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2" data-chrome>
          <h4 className="text-[0.75rem] font-medium text-muted-foreground">Filters · {rig.filters.length}</h4>
          <Button size="sm" variant="outline" onClick={() => setFilterDraft({ id: null, name: "", matches: "", bands: [], fromHeader: null })}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            Add filter<span className="sr-only"> to {rig.name}</span>
          </Button>
        </div>
        {rig.filters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{kind === "osc" ? "No filters: the camera captures R, G and B." : "No filters yet. A mono rig passes no band until a filter is listed."}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <caption className="sr-only">Filters of {rig.name}</caption>
              <thead className="bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="h-(--row-h) px-3 text-left font-medium">Filter</th>
                  <th scope="col" className="px-3 text-left font-medium">Matches FILTER</th>
                  <th scope="col" className="px-3 text-left font-medium">Bands</th>
                  <th scope="col" className="px-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rig.filters.map((f) => (
                  <tr key={f.id} className="h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022]">
                    <th scope="row" className="px-3 text-left font-medium">
                      {f.name}
                    </th>
                    <td className="px-3 font-mono text-xs">{f.matches.join(", ")}</td>
                    <td className="px-3">
                      {f.bands.join(" + ")}
                      {f.bands.filter((b) => NARROW_BANDS.includes(b)).length >= 2 ? <span className="ml-1.5 text-xs text-muted-foreground">dual-band</span> : null}
                    </td>
                    <td className="px-3 py-0.5 text-right whitespace-nowrap">
                      <Button size="xs" variant="ghost" onClick={() => setFilterDraft({ id: f.id, name: f.name, matches: f.matches.join(", "), bands: f.bands, fromHeader: null })}>
                        Edit<span className="sr-only"> {f.name}</span>
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setRemoving(f)}>
                        <Trash2 aria-hidden="true" data-icon="inline-start" />
                        Remove<span className="sr-only"> {f.name}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FilterDialog rig={rig} draft={filterDraft} onClose={() => setFilterDraft(null)} />
      <OpticsDialog rig={rig} open={optics} onClose={() => setOptics(false)} />
      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={`Rename ${rig.name}`}
        description="The name shows wherever the rig appears: Projects, runs, Targets and Sessions."
        label="Rig name"
        initial={rig.name}
        confirmLabel="Rename"
        taken={Object.values(catalog.opticalTrains)
          .filter((r) => r.id !== rig.id)
          .map((r) => r.name)}
        onSubmit={(name) => {
          const result = renameRig(rig.id, name)
          return result.ok ? null : result.message
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? ""} from ${rig.name}?`}
        description="The rig's filter list drives the Targets band strip, the narrowband presets and goal channels."
        changes={[
          `Removes the filter ${removing?.name ?? ""} (${removing?.bands.join(" + ") ?? ""}) from ${rig.name}`,
          removing && sessionsWithValue(catalog, rig.id, removing.name) > 0
            ? `${plural(sessionsWithValue(catalog, rig.id, removing.name), "session")} with FILTER ${removing.name} will show the filter as unknown, with a prompt to add it again`
            : "No session on this rig uses it now",
        ]}
        unchanged={["Session headers and observed values", "Goal templates", "Runs and their membership"]}
        confirmLabel={`Remove ${removing?.name ?? "filter"}`}
        tone="destructive"
        onConfirm={() => (removing ? setRigFilters(rig.id, rig.filters.filter((f) => f.id !== removing.id)) : undefined)}
      />
    </section>
  )
}

export function EquipmentSettingsPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const rigs = useStore((s) => Object.values(s.catalog.opticalTrains).sort((a, b) => a.name.localeCompare(b.name)))
  return (
    <div>
      <PageHeader level={2} title="Equipment" description="Each rig is one optical train: camera, telescope and a plain filter list. The list drives the Targets band strip, narrowband presets and Fit." />
      <PageBody>
        <ReturnNotice task="Equipment" />
        {rigs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rigs yet. Rigs are detected from session headers when a capture location is indexed.</p>
        ) : (
          rigs.map((rig) => <RigBlock key={rig.id} rig={rig} highlighted={search.rig === rig.id} />)
        )}
      </PageBody>
    </div>
  )
}
