/**
 * Settings › Observing sites (J15 S6-S8, seam 7). Sites with latitude,
 * longitude, elevation, IANA time zone, twilight and minimum altitude, plus
 * one explicit default site (a Default pill; Make default on the others):
 * Plan and Tonight use it unless another is picked, and PlateVault never
 * picks one for you (HLD §14). Right-click a site for its actions.
 */
import { MapPin, Plus } from "lucide-react"
import { type RefObject, useEffect, useId, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { DataTable } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { ObservingSite } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { FieldMessage, focusFirstInvalid, TextField } from "../components/form-field"
import { ROW_MENU_ROW, rowMenuColumn } from "../components/row-menu"
import { deleteSite, formatCoordinates, remindersMoveWith, saveSite, setDefaultSite, type SiteErrors, type SiteValues, siteValues, TIME_ZONES, unmatchedCaptureSites, validateSite } from "../lib/sites"
import { ReturnNotice } from "./settings-layout"

function SiteDialog({
  editing,
  onClose,
  finalFocus,
}: {
  editing: { site: ObservingSite | null; prefill?: Partial<SiteValues> } | null
  onClose: () => void
  /** The control that opened the dialog; focus returns there on close. */
  finalFocus: RefObject<HTMLElement | null>
}) {
  const [values, setValues] = useState<SiteValues>(siteValues(null))
  const [makeDefault, setMakeDefault] = useState(false)
  const [errors, setErrors] = useState<SiteErrors>({})
  const [writeError, setWriteError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const id = useId()
  const defaultSiteId = useStore((s) => s.settings.defaultSiteId)
  const reminderSite = useStore((s) => (s.catalog.reminders.enabled ? s.catalog.reminders.siteId : null))
  const site = editing?.site ?? null
  const isDefault = site !== null && site.id === defaultSiteId

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
      <DialogContent className="sm:max-w-xl" finalFocus={finalFocus}>
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
            <DialogTitle>{site ? `Edit ${site.name}` : "Add site"}</DialogTitle>
          </DialogHeader>
          <TextField id={`${id}-name`} label="Name" value={values.name} onChange={set("name")} error={errors.name} placeholder="Backyard" autoFocus />
          <div className="grid grid-cols-3 gap-3">
            <TextField id={`${id}-lat`} label="Latitude (° N)" value={values.latitude} onChange={set("latitude")} error={errors.latitude} inputMode="decimal" />
            <TextField id={`${id}-lon`} label="Longitude (° E)" value={values.longitude} onChange={set("longitude")} error={errors.longitude} inputMode="decimal" />
            <TextField id={`${id}-elev`} label="Elevation (m)" value={values.elevation} onChange={set("elevation")} error={errors.elevation} inputMode="decimal" placeholder="Optional" />
          </div>
          <Field className="gap-1.5" data-invalid={errors.timeZone ? true : undefined}>
            <FieldLabel htmlFor={`${id}-zone`}>Time zone</FieldLabel>
            <Combobox items={TIME_ZONES} value={values.timeZone || null} onValueChange={(value) => set("timeZone")((value as string | null) ?? "")}>
              <ComboboxInput
                id={`${id}-zone`}
                placeholder="Europe/Amsterdam"
                className="w-full"
                aria-invalid={errors.timeZone ? true : undefined}
                aria-describedby={errors.timeZone ? `${id}-zone-error` : undefined}
              />
              <ComboboxContent>
                <ComboboxEmpty>No match</ComboboxEmpty>
                <ComboboxList>
                  {(zone: string) => (
                    <ComboboxItem key={zone} value={zone}>
                      {zone}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <FieldMessage id={`${id}-zone-error`} message={errors.timeZone} />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_10rem] gap-3">
            <FieldSet className="gap-1.5">
              <FieldLegend variant="label">Darkness</FieldLegend>
              <RadioGroup value={values.twilight} onValueChange={(value) => set("twilight")(value as string)} className="grid-cols-2">
                {[
                  { value: "astronomical", title: "Astronomical", description: "Sun −18°" },
                  { value: "nautical", title: "Nautical", description: "Sun −12°" },
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
            <TextField id={`${id}-alt`} label="Min. altitude (°)" value={values.minAltitude} onChange={set("minAltitude")} error={errors.minAltitude} inputMode="decimal" placeholder="0–90" />
          </div>
          {isDefault ? (
            // The default is cleared only by choosing another site, so an unchecked box would promise a change that never happens.
            <Pill tone="info">Default</Pill>
          ) : (
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${id}-default`} className="flex items-center gap-2 text-sm">
                <Checkbox id={`${id}-default`} checked={makeDefault} onCheckedChange={(checked) => setMakeDefault(checked)} />
                Make default
              </label>
              {reminderSite && reminderSite !== site?.id ? <HelpTip label="About the default site">Reminders move to the default site.</HelpTip> : null}
            </div>
          )}
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
  const [confirmDefault, setConfirmDefault] = useState<ObservingSite | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  function openEditor(next: { site: ObservingSite | null; prefill?: Partial<SiteValues> }, from: HTMLElement | null) {
    opener.current = from
    setEditing(next)
  }

  function makeDefault(site: ObservingSite) {
    // Reminders follow the default site; moving them is scope-changing, so it is confirmed first (HLD §9, PLAN-FR-03).
    if (remindersMoveWith(store.getState(), site.id) && confirmDefault === null) {
      setConfirmDefault(site)
      return
    }
    const result = setDefaultSite(site)
    setDefaultError(result.ok ? null : { site, message: result.message })
    return result
  }

  const addButton = (
    <Button size="sm" variant="outline" onClick={(event) => openEditor({ site: null }, event.currentTarget)}>
      <Plus aria-hidden="true" data-icon="inline-start" />
      Add site
    </Button>
  )

  const menu = (r: ObservingSite): MenuEntry[] => [
    ...(defaultSiteId === r.id ? [] : [{ label: "Make default", onSelect: () => void makeDefault(r) }]),
    { label: "Edit", onSelect: () => openEditor({ site: r }, null) },
    { separator: true },
    { label: "Remove", destructive: true, onSelect: () => setRemoving(r) },
  ]
  const nextDefault = removing ? sites.filter((s) => s.id !== removing.id).sort((a, b) => a.name.localeCompare(b.name))[0] : undefined

  return (
    <div>
      <PageHeader level={2} title="Observing sites" actions={sites.length ? addButton : null} />
      <PageBody>
        <ReturnNotice />
        {sites.length > 0 && !defaultSiteId ? <Notice tone="info" title="No default site" /> : null}
        {defaultError ? <ActionError message={defaultError.message} onRetry={() => makeDefault(defaultError.site)} /> : null}

        <DataTable<ObservingSite>
          label="Observing sites"
          scroll="none"
          rows={sites}
          getRowId={(r) => r.id}
          rowClassName={() => ROW_MENU_ROW}
          initialSort={{ columnId: "name", direction: "asc" }}
          contextMenu={menu}
          empty={<EmptyState icon={MapPin} title="No sites" action={addButton} className="border-0" />}
          columns={[
            { id: "name", header: "Name", rowHeader: true, sortValue: (r) => r.name, cell: (r) => r.name },
            {
              id: "default",
              header: "Default",
              sortValue: (r) => (defaultSiteId === r.id ? 0 : 1),
              cell: (r) =>
                defaultSiteId === r.id ? (
                  <Pill tone="info">Default</Pill>
                ) : (
                  <Button size="xs" variant="ghost" className="-my-1" onClick={() => makeDefault(r)} data-make-default={r.id}>
                    Make default<span className="sr-only"> {r.name}</span>
                  </Button>
                ),
            },
            { id: "coords", header: "Coordinates", cell: (r) => <span className="tabular-nums">{formatCoordinates(r.latitude, r.longitude)}</span> },
            { id: "elevation", header: "Elevation", align: "right", cell: (r) => (r.elevationM === null ? "–" : `${formatCount(r.elevationM)} m`) },
            { id: "zone", header: "Time zone", cell: (r) => r.timeZone, sortValue: (r) => r.timeZone },
            { id: "twilight", header: "Darkness", cell: (r) => (r.twilight === "astronomical" ? "Astronomical" : "Nautical") },
            { id: "alt", header: "Min. altitude", align: "right", cell: (r) => `${r.minAltitudeDeg}°` },
            rowMenuColumn<ObservingSite>(
              (r) => r.name,
              (r) => [
                ...(defaultSiteId === r.id ? [] : [{ label: "Make default", onSelect: () => void makeDefault(r) }]),
                { label: "Edit", onSelect: (trigger: HTMLElement | null) => openEditor({ site: r }, trigger) },
                { label: "Remove", destructive: true, onSelect: () => setRemoving(r) },
              ],
            ),
          ]}
        />

        {suggestions.length > 0 ? (
          <Section
            title="From headers"
            level={3}
            id="sites-headers"
            actions={<HelpTip label="About header coordinates">SITELAT and SITELONG without a saved site.</HelpTip>}
          >
            <ul className="divide-y rounded-lg border">
              {suggestions.map((s) => (
                <li key={`${s.latitude},${s.longitude}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="tabular-nums">
                    {formatCoordinates(s.latitude, s.longitude)} <span className="text-muted-foreground">· in {s.sessions === 1 ? "1 session" : `${s.sessions} sessions`}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(event) => openEditor({ site: null, prefill: { latitude: String(s.latitude), longitude: String(s.longitude) } }, event.currentTarget)}
                  >
                    Add as site
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </PageBody>

      <SiteDialog editing={editing} onClose={() => setEditing(null)} finalFocus={opener} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "site"}?`}
        description={null}
        changes={[
          `Remove ${removing?.name ?? "the site"}`,
          ...(removing && removing.id === defaultSiteId ? [nextDefault ? `Default: ${nextDefault.name}` : "No default site"] : []),
          ...(removing && removing.id === planningSiteId ? ["Clear the planning site"] : []),
          ...(removing && reminders.siteId === removing.id && reminders.enabled ? ["Notifications off"] : []),
        ]}
        confirmLabel="Remove site"
        tone="destructive"
        onConfirm={() => (removing ? deleteSite(removing) : undefined)}
      />
      <ConfirmDialog
        open={confirmDefault !== null}
        onOpenChange={(open) => !open && setConfirmDefault(null)}
        title={`Make ${confirmDefault?.name ?? "this site"} the default?`}
        description={null}
        changes={[`Default: ${confirmDefault?.name ?? "this site"}`, `Reminders: ${sites.find((s) => s.id === reminders.siteId)?.name ?? "previous site"} → ${confirmDefault?.name ?? "this site"}`]}
        confirmLabel="Make default"
        onConfirm={() => (confirmDefault ? makeDefault(confirmDefault) : undefined)}
      />
    </div>
  )
}
