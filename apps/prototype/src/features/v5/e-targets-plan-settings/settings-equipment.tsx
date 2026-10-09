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
import { Link, useSearch } from "@tanstack/react-router"
import { Camera, Pencil, Plus, Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList } from "@/components/app/data"
import { ActionError, EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { liveLightSessions, rigBands, rigCameraKind, rigFieldOfView, sessionRigId, unknownFilterValues } from "@/domain/derive"
import { BANDS, NARROW_BANDS } from "@/domain/labels"
import { fieldOfView } from "@/domain/sky"
import type { Band, CameraKind, Catalog, OpticalTrain, RigFilter } from "@/domain/types"
import { TextField, parseAliases, parseNumber } from "@/features/t1/components/form-field"
import { ReturnNotice } from "@/features/t1/settings/settings-layout"
import { formatCount, formatDegrees } from "@/lib/format"
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

/** "1.23° × 0.82° · 1.45″/px": units only, not translated. */
function formatFov(fov: { widthDeg: number; heightDeg: number; pixelScaleArcsec: number } | null): string {
  return fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)} · ${fov.pixelScaleArcsec.toFixed(2)}″/px` : "–"
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
  const m = useMessages()
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
    if (!name) next.name = m.settings_name_required()
    else if (rig.filters.some((f) => f.id !== values.id && f.name.toLowerCase() === name.toLowerCase())) next.name = m.settings_name_taken()
    if (values.bands.length === 0) next.bands = m.equipment_pick_band()
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

  const title = values.fromHeader ? m.equipment_add_value({ value: values.fromHeader }) : values.id ? m.settings_edit_title({ name: values.name }) : m.equipment_add_filter()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <TextField id={ids.name} label={m.site_name()} value={values.name} onChange={(name) => setValues({ ...values, name })} error={errors.name} readOnly={Boolean(values.fromHeader)} />
          {values.fromHeader ? null : (
            <TextField
              id={ids.matches}
              label={m.equipment_matches_filter()}
              placeholder={m.equipment_comma_separated()}
              value={values.matches}
              onChange={(matches) => setValues({ ...values, matches })}
              mono
            />
          )}
          <fieldset className="space-y-1.5" aria-describedby={errors.bands ? `${ids.bands}-error` : undefined}>
            <legend className="text-sm font-medium">{m.equipment_bands()}</legend>
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
              {m.verb_cancel()}
            </Button>
            <Button type="submit">{failure ? m.verb_retry() : values.fromHeader ? m.verb_add() : m.settings_save()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function OpticsDialog({ rig, open, onClose }: { rig: OpticalTrain; open: boolean; onClose: () => void }) {
  const m = useMessages()
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
      width: camera && !positive(width, true) ? m.equipment_error_whole_pixels() : undefined,
      height: camera && !positive(height, true) ? m.equipment_error_whole_pixels() : undefined,
      pixel: camera && !positive(pixel, false) ? m.equipment_error_microns() : undefined,
      focal: !positive(focal, false) ? m.equipment_error_mm() : undefined,
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
            <DialogTitle className="inline-flex items-center gap-1.5">
              {m.equipment_optics_title({ name: rig.name })}
              {camera && sharing.length > 1 ? <HelpTip label={m.equipment_shared_camera()}>{m.equipment_shared_camera_help({ rigs: sharing.map((r) => r.name).join(", ") })}</HelpTip> : null}
            </DialogTitle>
          </DialogHeader>
          {camera ? (
            <>
              <fieldset className="space-y-1.5">
                <legend id={ids.kind} className="text-sm font-medium">
                  {m.equipment_camera_kind()}
                </legend>
                <div role="radiogroup" aria-labelledby={ids.kind} className="inline-flex rounded-md border border-separator p-px">
                  {(["mono", "osc"] as const).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={values.kind === k} onClick={() => setValues({ ...values, kind: k })} className={cn("h-6 rounded-[4px] px-2 text-sm", values.kind === k ? "bg-selected text-selected-foreground" : "hover:bg-foreground/[0.06]")}>
                      {k === "mono" ? m.equipment_mono() : m.equipment_osc_colour()}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-3 gap-3">
                <TextField id={ids.width} label={m.equipment_sensor_width()} inputMode="numeric" value={values.width} onChange={(width) => setValues({ ...values, width })} error={errors.width} />
                <TextField id={ids.height} label={m.equipment_sensor_height()} inputMode="numeric" value={values.height} onChange={(height) => setValues({ ...values, height })} error={errors.height} />
                <TextField id={ids.pixel} label={m.equipment_pixel_size()} inputMode="decimal" value={values.pixel} onChange={(pixel) => setValues({ ...values, pixel })} error={errors.pixel} />
              </div>
            </>
          ) : null}
          <TextField id={ids.focal} label={m.equipment_focal_length()} inputMode="decimal" value={values.focal} onChange={(f) => setValues({ ...values, focal: f })} error={errors.focal} className="max-w-56" />
          <p className="text-sm tabular-nums" aria-live="polite">
            <span className="text-muted-foreground">{m.equipment_field_of_view()} </span>
            {formatFov(preview)}
          </p>
          {failure ? <ActionError message={failure} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {m.verb_cancel()}
            </Button>
            <Button type="submit">{failure ? m.verb_retry() : m.settings_save()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RigBlock({ rig, highlighted }: { rig: OpticalTrain; highlighted: boolean }) {
  const m = useMessages()
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
  const editFilter = (f: RigFilter) => setFilterDraft({ id: f.id, name: f.name, matches: f.matches.join(", "), bands: f.bands, fromHeader: null })
  const filterMenu = (id: string): MenuEntry[] => {
    const f = rig.filters.find((x) => x.id === id)
    if (!f) return []
    return [{ label: m.settings_edit(), onSelect: () => editFilter(f) }, { separator: true }, { label: m.settings_remove(), destructive: true, onSelect: () => setRemoving(f) }]
  }

  return (
    <section ref={ref} aria-labelledby={headingId} className={cn("scroll-mt-14 space-y-3 rounded-md border p-3", highlighted && "border-primary")} data-rig={rig.id}>
      <div className="flex flex-wrap items-center gap-2" data-chrome>
        <h3 id={headingId} className="text-sm font-semibold">
          {rig.name}
        </h3>
        <StatusBadge kind="source" value={rig.source} />
        <Pill tone="muted">{kind === "osc" ? m.equipment_osc() : kind === "mono" ? m.equipment_mono() : m.equipment_camera_unknown()}</Pill>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
          <Pencil aria-hidden="true" data-icon="inline-start" />
          {m.equipment_rename()}
          <span className="sr-only"> {rig.name}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOptics(true)}>
          {m.equipment_edit_optics()}
          <span className="sr-only"> {m.equipment_of_rig({ name: rig.name })}</span>
        </Button>
      </div>
      {unknown
        .filter((v) => !declined.includes(v))
        .map((value) => (
          <Notice
            key={value}
            tone="warning"
            title={m.equipment_unknown_filter({ value, count: sessionsWithValue(catalog, rig.id, value), n: formatCount(sessionsWithValue(catalog, rig.id, value)) })}
            actions={
              <>
                <Button size="sm" onClick={() => setFilterDraft({ id: null, name: value, matches: value, bands: guessBands(value), fromHeader: value })}>
                  {m.equipment_add_filter()}
                  <span className="sr-only"> {value}</span>
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeclined([...declined, value])}>
                  {m.equipment_not_now()}
                </Button>
              </>
            }
          />
        ))}
      {declined.filter((v) => unknown.includes(v)).length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {m.equipment_hidden()}
          {declined
            .filter((v) => unknown.includes(v))
            .map((v) => (
              <Pill key={v} tone="muted">
                {v}
              </Pill>
            ))}
          <Button size="xs" variant="ghost" onClick={() => setDeclined([])}>
            {m.equipment_show()}
          </Button>
        </p>
      ) : null}
      <KeyValueList
        columns={2}
        items={[
          { label: m.equipment_camera(), value: camera ? `${camera.name} · ${camera.kind === "osc" ? m.equipment_osc() : m.equipment_mono()}` : "–" },
          { label: m.equipment_sensor(), value: camera ? `${camera.widthPx} × ${camera.heightPx} px · ${camera.pixelSizeUm} µm` : "–" },
          { label: m.equipment_telescope(), value: telescope ? `${telescope.name}${telescope.apertureMm ? ` · ${telescope.apertureMm} mm` : ""}` : "–" },
          { label: m.equipment_focal_length_short(), value: `${rig.effectiveFocalLengthMm} mm` },
          {
            label: m.equipment_field_of_view(),
            value: formatFov(fov),
            source: fov ? m.equipment_derived() : undefined,
          },
          {
            label: m.equipment_bands(),
            value:
              bands.length > 0 ? (
                <span className="inline-flex flex-wrap gap-1">
                  {bands.map((b) => (
                    <Pill key={b} tone="info">
                      {b}
                    </Pill>
                  ))}
                </span>
              ) : (
                "–"
              ),
            source: kind === "osc" ? m.equipment_osc_camera() : undefined,
          },
          { label: m.equipment_used_by(), value: projects.length > 0 ? projects.map((p) => p.name).join(", ") : "–" },
        ]}
      />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2" data-chrome>
          <h4 className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-muted-foreground">
            {m.equipment_filters()} <CountBadge count={rig.filters.length} />
          </h4>
          <Button size="sm" variant="outline" onClick={() => setFilterDraft({ id: null, name: "", matches: "", bands: [], fromHeader: null })}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {m.equipment_add_filter()}
            <span className="sr-only"> {m.equipment_to_rig({ name: rig.name })}</span>
          </Button>
        </div>
        {rig.filters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{kind === "osc" ? m.equipment_no_filters_osc() : m.equipment_no_filters()}</p>
        ) : (
          <ContextMenuArea menu={filterMenu}>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">{m.equipment_filters_of({ name: rig.name })}</caption>
                <thead className="text-[0.6875rem] text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="h-(--row-h) px-3 text-left font-medium">
                      {m.equipment_filter()}
                    </th>
                    <th scope="col" className="px-3 text-left font-medium">
                      {m.equipment_matches_filter()}
                    </th>
                    <th scope="col" className="px-3 text-left font-medium">
                      {m.equipment_bands()}
                    </th>
                    <th scope="col" className="px-3 text-right font-medium">
                      <span className="sr-only">{m.settings_actions()}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rig.filters.map((f) => (
                    <tr key={f.id} {...menuKey(f.id)} className="h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022]">
                      <th scope="row" className="px-3 text-left font-medium">
                        {f.name}
                      </th>
                      <td className="px-3 font-mono text-xs">{f.matches.join(", ")}</td>
                      <td className="px-3">
                        <span className="inline-flex flex-wrap items-center gap-1">
                          {f.bands.map((b) => (
                            <Pill key={b} tone="info">
                              {b}
                            </Pill>
                          ))}
                          {f.bands.filter((b) => NARROW_BANDS.includes(b)).length >= 2 ? <Pill tone="muted">{m.equipment_dual_band()}</Pill> : null}
                        </span>
                      </td>
                      <td className="px-3 py-0.5 text-right whitespace-nowrap">
                        <Button size="xs" variant="ghost" onClick={() => editFilter(f)}>
                          {m.settings_edit()}
                          <span className="sr-only"> {f.name}</span>
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setRemoving(f)}>
                          <Trash2 aria-hidden="true" data-icon="inline-start" />
                          {m.settings_remove()}
                          <span className="sr-only"> {f.name}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ContextMenuArea>
        )}
      </div>

      <FilterDialog rig={rig} draft={filterDraft} onClose={() => setFilterDraft(null)} />
      <OpticsDialog rig={rig} open={optics} onClose={() => setOptics(false)} />
      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={m.equipment_rename_title({ name: rig.name })}
        description=""
        label={m.equipment_rig_name()}
        initial={rig.name}
        confirmLabel={m.equipment_rename()}
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
        title={m.equipment_remove_filter_title({ filter: removing?.name ?? "", rig: rig.name })}
        description={null}
        changes={[
          m.equipment_remove_filter_change({ filter: removing?.name ?? "", bands: removing?.bands.join(" + ") ?? "" }),
          ...(removing && sessionsWithValue(catalog, rig.id, removing.name) > 0
            ? [
                m.equipment_remove_filter_sessions({
                  count: sessionsWithValue(catalog, rig.id, removing.name),
                  n: formatCount(sessionsWithValue(catalog, rig.id, removing.name)),
                }),
              ]
            : []),
        ]}
        confirmLabel={m.settings_remove()}
        tone="destructive"
        onConfirm={() => (removing ? setRigFilters(rig.id, rig.filters.filter((f) => f.id !== removing.id)) : undefined)}
      />
    </section>
  )
}

export function EquipmentSettingsPage() {
  const m = useMessages()
  const search = useSearch({ strict: false }) as SearchParams
  const rigs = useStore((s) => Object.values(s.catalog.opticalTrains).sort((a, b) => a.name.localeCompare(b.name)))
  return (
    <div>
      <PageHeader level={2} title={m.settings_equipment()} />
      <PageBody>
        <ReturnNotice />
        {rigs.length === 0 ? (
          <EmptyState
            icon={Camera}
            title={m.equipment_no_rigs()}
            action={<Button render={<Link to="/settings/locations" />}>{m.location_add()}</Button>}
          />
        ) : (
          rigs.map((rig) => <RigBlock key={rig.id} rig={rig} highlighted={search.rig === rig.id} />)
        )}
      </PageBody>
    </div>
  )
}
