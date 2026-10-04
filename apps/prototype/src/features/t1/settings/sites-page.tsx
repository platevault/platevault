/**
 * Settings › Observing sites (J15 S6-S8, seam 7). Sites with latitude,
 * longitude, elevation, IANA time zone, twilight and minimum altitude, plus an
 * explicit default site: PlateVault never picks one for you (HLD §14).
 */
import { MapPin, Plus } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { DataTable } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { ObservingSite } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { FieldMessage, focusFirstInvalid, TextField } from "../components/form-field"
import { deleteSite, formatCoordinates, saveSite, setDefaultSite, type SiteErrors, type SiteValues, siteValues, TIME_ZONES, unmatchedCaptureSites, validateSite } from "../lib/sites"
import { ReturnNotice } from "./settings-layout"

function SiteDialog({ editing, onClose }: { editing: { site: ObservingSite | null; prefill?: Partial<SiteValues> } | null; onClose: () => void }) {
  const [values, setValues] = useState<SiteValues>(siteValues(null))
  const [makeDefault, setMakeDefault] = useState(false)
  const [errors, setErrors] = useState<SiteErrors>({})
  const [writeError, setWriteError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const id = useId()
  const defaultSiteId = useStore((s) => s.settings.defaultSiteId)
  const site = editing?.site ?? null

  useEffect(() => {
    if (!editing) return
    setValues({ ...siteValues(editing.site), ...editing.prefill })
    setMakeDefault(editing.site ? defaultSiteId === editing.site.id : false)
    setErrors({})
    setWriteError(null)
  }, [editing])

  const set = (key: keyof SiteValues) => (value: string) => setValues((v) => ({ ...v, [key]: value }))

  function submit() {
    const found = validateSite(store.getState().catalog, values, site?.id ?? null)
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      focusFirstInvalid(form.current)
      return
    }
    const result = saveSite(values, site?.id ?? null, makeDefault)
    if (!result.ok) {
      setWriteError(result.message)
      return
    }
    onClose()
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form
          ref={form}
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{site ? `Edit ${site.name}` : "Add observing site"}</DialogTitle>
            <DialogDescription>Planning windows and reminders use these values. Recorded capture coordinates in your files never change.</DialogDescription>
          </DialogHeader>
          <TextField id={`${id}-name`} label="Name" value={values.name} onChange={set("name")} error={errors.name} placeholder="e.g. Backyard" autoFocus />
          <div className="grid grid-cols-3 gap-3">
            <TextField id={`${id}-lat`} label="Latitude (°)" value={values.latitude} onChange={set("latitude")} error={errors.latitude} inputMode="decimal" description="North is positive." />
            <TextField id={`${id}-lon`} label="Longitude (°)" value={values.longitude} onChange={set("longitude")} error={errors.longitude} inputMode="decimal" description="East is positive." />
            <TextField id={`${id}-elev`} label="Elevation (m)" value={values.elevation} onChange={set("elevation")} error={errors.elevation} inputMode="decimal" description="Optional." />
          </div>
          <Field className="gap-1.5" data-invalid={errors.timeZone ? true : undefined}>
            <FieldLabel htmlFor={`${id}-zone`}>Time zone</FieldLabel>
            <Combobox items={TIME_ZONES} value={values.timeZone || null} onValueChange={(value) => set("timeZone")((value as string | null) ?? "")}>
              <ComboboxInput
                id={`${id}-zone`}
                placeholder="e.g. Europe/Amsterdam"
                className="w-full"
                aria-invalid={errors.timeZone ? true : undefined}
                aria-describedby={errors.timeZone ? `${id}-zone-error` : `${id}-zone-hint`}
              />
              <ComboboxContent>
                <ComboboxEmpty>No time zone matches.</ComboboxEmpty>
                <ComboboxList>
                  {(zone: string) => (
                    <ComboboxItem key={zone} value={zone}>
                      {zone}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <p id={`${id}-zone-hint`} className="text-xs text-muted-foreground">
              IANA name. Planning windows show times in this zone.
            </p>
            <FieldMessage id={`${id}-zone-error`} message={errors.timeZone} />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_10rem] gap-3">
            <FieldSet className="gap-1.5">
              <FieldLegend variant="label">Darkness</FieldLegend>
              <RadioGroup value={values.twilight} onValueChange={(value) => set("twilight")(value as string)} className="grid-cols-2">
                {[
                  { value: "astronomical", title: "Astronomical", description: "Sun 18° below the horizon" },
                  { value: "nautical", title: "Nautical", description: "Sun 12° below the horizon" },
                ].map((option) => (
                  <FieldLabel key={option.value} htmlFor={`${id}-tw-${option.value}`}>
                    <Field orientation="horizontal" className="items-start">
                      <FieldContent>
                        <FieldTitle>{option.title}</FieldTitle>
                        <FieldDescription className="text-xs">{option.description}</FieldDescription>
                      </FieldContent>
                      <RadioGroupItem id={`${id}-tw-${option.value}`} value={option.value} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
            <TextField id={`${id}-alt`} label="Minimum altitude (°)" value={values.minAltitude} onChange={set("minAltitude")} error={errors.minAltitude} inputMode="decimal" description="0 to 90." />
          </div>
          <label htmlFor={`${id}-default`} className="flex items-start gap-2 text-sm">
            <Checkbox id={`${id}-default`} checked={makeDefault} onCheckedChange={(checked) => setMakeDefault(checked)} className="mt-0.5" />
            <span>
              Set as default site
              <span className="block text-xs text-muted-foreground">Notifications for planned Targets use the default site only.</span>
            </span>
          </label>
          {writeError ? <ActionError message={writeError} onRetry={submit} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit">{site ? "Save changes" : "Add site"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SitesPage() {
  const sites = useStore((s) => Object.values(s.catalog.sites))
  const defaultSiteId = useStore((s) => s.settings.defaultSiteId)
  const planningSiteId = useStore((s) => s.settings.planningSiteId)
  const reminders = useStore((s) => s.catalog.reminders)
  const suggestions = useStore((s) => unmatchedCaptureSites(s.catalog))
  const [editing, setEditing] = useState<{ site: ObservingSite | null; prefill?: Partial<SiteValues> } | null>(null)
  const [removing, setRemoving] = useState<ObservingSite | null>(null)
  const [defaultError, setDefaultError] = useState<{ site: ObservingSite; message: string } | null>(null)

  function makeDefault(site: ObservingSite) {
    const result = setDefaultSite(site)
    setDefaultError(result.ok ? null : { site, message: result.message })
  }

  const addButton = (
    <Button onClick={() => setEditing({ site: null })}>
      <Plus aria-hidden="true" data-icon="inline-start" />
      Add site
    </Button>
  )

  return (
    <div>
      <PageHeader level={2} title="Observing sites" description="Where you observe from. Plans and reminders use these sites; the default site is never chosen for you." actions={sites.length ? addButton : null} />
      <PageBody>
        <ReturnNotice task="Observing sites" />
        {sites.length > 0 && !defaultSiteId ? (
          <Notice tone="info" title="No default site">
            Notifications for planned Targets use the default site only. Choose Set as default on the site you observe from most.
          </Notice>
        ) : null}
        {defaultError ? <ActionError message={defaultError.message} onRetry={() => makeDefault(defaultError.site)} /> : null}

        <DataTable<ObservingSite>
          label="Observing sites"
          scroll="none"
          rows={sites}
          getRowId={(r) => r.id}
          initialSort={{ columnId: "name", direction: "asc" }}
          empty={
            <EmptyState
              icon={MapPin}
              title="No observing sites yet"
              description="Add the place you observe from to plan windows and turn on reminders."
              action={addButton}
              className="border-0"
            />
          }
          columns={[
            {
              id: "name",
              header: "Name",
              rowHeader: true,
              sortValue: (r) => r.name,
              cell: (r) => (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {r.name}
                  {defaultSiteId === r.id ? <StatusBadge kind="site" value="default" /> : null}
                </span>
              ),
            },
            { id: "coords", header: "Coordinates", cell: (r) => <span className="tabular-nums">{formatCoordinates(r.latitude, r.longitude)}</span> },
            { id: "elevation", header: "Elevation", align: "right", cell: (r) => (r.elevationM === null ? <UnknownValue label="Not set" /> : `${formatCount(r.elevationM)} m`) },
            { id: "zone", header: "Time zone", cell: (r) => r.timeZone, sortValue: (r) => r.timeZone },
            { id: "twilight", header: "Darkness", cell: (r) => (r.twilight === "astronomical" ? "Astronomical" : "Nautical") },
            { id: "alt", header: "Min. altitude", align: "right", cell: (r) => `${r.minAltitudeDeg}°` },
            {
              id: "actions",
              header: "Actions",
              align: "right",
              cell: (r) => (
                <div className="flex justify-end gap-1">
                  {defaultSiteId === r.id ? null : (
                    <Button size="sm" variant="ghost" onClick={() => makeDefault(r)} aria-label={`Set ${r.name} as default site`}>
                      Set as default
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ site: r })} aria-label={`Edit ${r.name}`}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(r)} aria-label={`Remove ${r.name}`}>
                    Remove
                  </Button>
                </div>
              ),
            },
          ]}
        />

        {suggestions.length > 0 ? (
          <Section title="Capture coordinates without a site" level={3} description="Read from SITELAT and SITELONG headers. Adding a site names these sessions' capture site.">
            <ul className="divide-y rounded-lg border">
              {suggestions.map((s) => (
                <li key={`${s.latitude},${s.longitude}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="tabular-nums">
                    {formatCoordinates(s.latitude, s.longitude)} <span className="text-muted-foreground">· in {s.sessions === 1 ? "1 session" : `${s.sessions} sessions`}</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setEditing({ site: null, prefill: { latitude: String(s.latitude), longitude: String(s.longitude) } })}>
                    Add as site
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </PageBody>

      <SiteDialog editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "site"}?`}
        description="Removes the saved site. No other site is chosen in its place."
        changes={[
          `Remove ${removing?.name ?? "the site"}`,
          ...(removing && removing.id === defaultSiteId ? ["Clear the default site; no other site becomes the default"] : []),
          ...(removing && removing.id === planningSiteId ? ["Clear the planning site"] : []),
          ...(removing && reminders.siteId === removing.id && reminders.enabled ? ["Turn notifications off; they used this site"] : []),
        ]}
        unchanged={["Capture coordinates recorded in your files", "Sessions, plans and other sites"]}
        confirmLabel="Remove site"
        tone="destructive"
        onConfirm={() => (removing ? deleteSite(removing) : undefined)}
      />
    </div>
  )
}
