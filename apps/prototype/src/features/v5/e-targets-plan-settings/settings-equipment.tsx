/**
 * S16 Settings › Equipment (slice E; D-W31, PLAN-EQ-FR-01 to PLAN-EQ-FR-06).
 * A rig is one optical train: a camera, a telescope and its effective focal
 * length (the telescope's, times a reducer), the derived field of
 * view, and a plain filter list where each filter names the FITS FILTER
 * values it matches and the bands it passes. The list drives the Targets band
 * strip, the narrowband presets and Fit; it never filters Goal templates.
 * A FILTER value seen on a rig's sessions that matches no filter prompts
 * "Add {value} to {rig}"; declining keeps the prompt available.
 *
 * Round 6: rigs come from detection plus manual add. The header adds a
 * camera, a telescope or a rig by hand (Manual; equipment-records.tsx), and
 * the Cameras and Telescopes tables rename and edit detected ones. A rig's
 * Edit changes only what it is made of; camera and telescope properties are
 * edited on their own records.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Camera, Pencil, Plus, Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList } from "@/components/app/data"
import { ActionError, EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { liveLightSessions, rigBands, rigCameraKind, rigFieldOfView, sessionRigId, unknownFilterValues } from "@/domain/derive"
import { BANDS, NARROW_BANDS } from "@/domain/labels"
import type { Band, Catalog, OpticalTrain, RigFilter } from "@/domain/types"
import { TextField, parseAliases } from "@/features/t1/components/form-field"
import { ReturnNotice } from "@/features/t1/settings/settings-layout"
import { formatCount, formatDecimal } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { addFilterToRig, renameRig, setRigFilters } from "@/store/actions/settings"
import { freshId } from "@/store/actions/shared"
import { type CommitResult, useStore } from "@/store/core"
import { NameDialog } from "./dialogs"
import { CameraDialog, CamerasTable, formatFov, RigDialog, TelescopeDialog, TelescopesTable } from "./equipment-records"

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
    else if (rig.filters.some((f) => f.id !== values.id && f.name.toLowerCase() === name.toLowerCase())) next.name = m.import_name_taken()
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

function RigBlock({ rig, highlighted }: { rig: OpticalTrain; highlighted: boolean }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [filterDraft, setFilterDraft] = useState<FilterDraft | null>(null)
  const [removing, setRemoving] = useState<RigFilter | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [editing, setEditing] = useState(false)
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
        <Pill tone="muted">{kind === "osc" ? m.equipment_osc() : kind === "mono" ? m.equipment_mono() : m.newproject_camera_unknown()}</Pill>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
          <Pencil aria-hidden="true" data-icon="inline-start" />
          {m.equipment_rename()}
          <span className="sr-only"> {rig.name}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          {m.settings_edit()}
          <span className="sr-only"> {rig.name}</span>
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
          { label: m.run_field_focal_length(), value: `${rig.effectiveFocalLengthMm} mm`, source: rig.reducer !== undefined && rig.reducer !== 1 ? m.equipment_with_reducer({ factor: formatDecimal(rig.reducer, 2) }) : undefined },
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
          { label: m.calibration_used_by(), value: projects.length > 0 ? projects.map((p) => p.name).join(", ") : "–" },
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
          <p className="text-sm text-muted-foreground">{kind === "osc" ? m.equipment_no_filters_osc() : m.tonight_no_filters()}</p>
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
                      <td className="px-3 py-(--row-py) text-right whitespace-nowrap">
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
      <RigDialog open={editing} rig={rig} onClose={() => setEditing(false)} />
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
  const navigate = useNavigate()
  const rigs = useStore((s) => Object.values(s.catalog.opticalTrains).sort((a, b) => a.name.localeCompare(b.name)))
  const [adding, setAdding] = useState<"camera" | "telescope" | "rig" | null>(null)
  return (
    <div>
      <PageHeader
        level={2}
        title={m.settings_equipment()}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setAdding("camera")} data-add-camera>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {m.equipment_add_camera_open()}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding("telescope")} data-add-telescope>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {m.equipment_add_telescope_open()}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding("rig")} data-add-rig>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {m.equipment_add_rig_open()}
            </Button>
          </>
        }
      />
      <PageBody>
        <ReturnNotice />
        <Section title={m.project_rigs()} level={3} id="equipment-rigs">
          {rigs.length === 0 ? (
            <EmptyState
              icon={Camera}
              title={m.equipment_no_rigs()}
              action={<Button render={<Link to="/settings/locations" />}>{m.storage_add_location()}</Button>}
            />
          ) : (
            rigs.map((rig) => <RigBlock key={rig.id} rig={rig} highlighted={search.rig === rig.id} />)
          )}
        </Section>
        <Section title={m.equipment_cameras()} level={3} id="equipment-cameras">
          <CamerasTable />
        </Section>
        <Section title={m.equipment_telescopes()} level={3} id="equipment-telescopes">
          <TelescopesTable />
        </Section>
      </PageBody>
      <CameraDialog open={adding === "camera"} camera={null} onClose={() => setAdding(null)} />
      <TelescopeDialog open={adding === "telescope"} telescope={null} onClose={() => setAdding(null)} />
      <RigDialog open={adding === "rig"} rig={null} onClose={() => setAdding(null)} onSaved={(rig) => void navigate({ to: "/settings/equipment", search: { rig } as never, replace: true })} />
    </div>
  )
}
