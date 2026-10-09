/**
 * Settings › Observing sites (J15 S6-S8, seam 7). Sites with latitude,
 * longitude, elevation, IANA time zone, twilight and minimum altitude, plus
 * one explicit default site (a Default pill; Make default on the others):
 * Plan and Tonight use it unless another is picked, and PlateVault never
 * picks one for you (HLD §14). Right-click a site for its actions.
 */
import { MapPin, Plus } from "lucide-react"
import { type RefObject, useEffect, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
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
  const m = useMessages()
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
            <DialogTitle>{site ? m.settings_edit_title({ name: site.name }) : m.site_add()}</DialogTitle>
          </DialogHeader>
          <TextField id={`${id}-name`} label={m.site_name()} value={values.name} onChange={set("name")} error={errors.name} placeholder={m.site_name_placeholder()} autoFocus />
          <div className="grid grid-cols-3 gap-3">
            <TextField id={`${id}-lat`} label={m.site_latitude_field()} value={values.latitude} onChange={set("latitude")} error={errors.latitude} inputMode="decimal" />
            <TextField id={`${id}-lon`} label={m.site_longitude_field()} value={values.longitude} onChange={set("longitude")} error={errors.longitude} inputMode="decimal" />
            <TextField
              id={`${id}-elev`}
              label={m.site_elevation_field()}
              value={values.elevation}
              onChange={set("elevation")}
              error={errors.elevation}
              inputMode="decimal"
              placeholder={m.site_optional()}
            />
          </div>
          <Field className="gap-1.5" data-invalid={errors.timeZone ? true : undefined}>
            <FieldLabel htmlFor={`${id}-zone`}>{m.site_time_zone()}</FieldLabel>
            <Combobox items={TIME_ZONES} value={values.timeZone || null} onValueChange={(value) => set("timeZone")((value as string | null) ?? "")}>
              <ComboboxInput
                id={`${id}-zone`}
                placeholder={m.site_time_zone_placeholder()}
                className="w-full"
                aria-invalid={errors.timeZone ? true : undefined}
                aria-describedby={errors.timeZone ? `${id}-zone-error` : undefined}
              />
              <ComboboxContent>
                <ComboboxEmpty>{m.settings_no_match()}</ComboboxEmpty>
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
              <FieldLegend variant="label">{m.site_darkness()}</FieldLegend>
              <RadioGroup value={values.twilight} onValueChange={(value) => set("twilight")(value as string)} className="grid-cols-2">
                {[
                  { value: "astronomical", title: m.site_twilight_astronomical(), description: m.site_sun_below({ degrees: "18" }) },
                  { value: "nautical", title: m.site_twilight_nautical(), description: m.site_sun_below({ degrees: "12" }) },
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
            <TextField id={`${id}-alt`} label={m.site_min_altitude_field()} value={values.minAltitude} onChange={set("minAltitude")} error={errors.minAltitude} inputMode="decimal" placeholder="0–90" />
          </div>
          {isDefault ? (
            // The default is cleared only by choosing another site, so an unchecked box would promise a change that never happens.
            <Pill tone="info">{m.settings_default()}</Pill>
          ) : (
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${id}-default`} className="flex items-center gap-2 text-sm">
                <Checkbox id={`${id}-default`} checked={makeDefault} onCheckedChange={(checked) => setMakeDefault(checked)} />
                {m.settings_make_default()}
              </label>
              {reminderSite && reminderSite !== site?.id ? <HelpTip label={m.site_default_about()}>{m.site_default_help()}</HelpTip> : null}
            </div>
          )}
          {writeError ? <ActionError message={writeError} onRetry={submit} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{m.verb_cancel()}</DialogClose>
            <Button type="submit">{site ? m.site_save_changes_button() : m.site_add()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SitesPage() {
  const m = useMessages()
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
      {m.site_add()}
    </Button>
  )

  const menu = (r: ObservingSite): MenuEntry[] => [
    ...(defaultSiteId === r.id ? [] : [{ label: m.settings_make_default(), onSelect: () => void makeDefault(r) }]),
    { label: m.settings_edit(), onSelect: () => openEditor({ site: r }, null) },
    { separator: true },
    { label: m.settings_remove(), destructive: true, onSelect: () => setRemoving(r) },
  ]
  const nextDefault = removing ? sites.filter((s) => s.id !== removing.id).sort((a, b) => a.name.localeCompare(b.name))[0] : undefined

  return (
    <div>
      <PageHeader level={2} title={m.settings_sites()} actions={sites.length ? addButton : null} />
      <PageBody>
        <ReturnNotice />
        {sites.length > 0 && !defaultSiteId ? <Notice tone="info" title={m.site_no_default()} /> : null}
        {defaultError ? <ActionError message={defaultError.message} onRetry={() => makeDefault(defaultError.site)} /> : null}

        <DataTable<ObservingSite>
          label={m.settings_sites()}
          scroll="none"
          rows={sites}
          getRowId={(r) => r.id}
          rowClassName={() => ROW_MENU_ROW}
          initialSort={{ columnId: "name", direction: "asc" }}
          contextMenu={menu}
          empty={<EmptyState icon={MapPin} title={m.site_none()} action={addButton} className="border-0" />}
          columns={[
            { id: "name", header: m.site_name(), rowHeader: true, sortValue: (r) => r.name, cell: (r) => r.name },
            {
              id: "default",
              header: m.settings_default(),
              sortValue: (r) => (defaultSiteId === r.id ? 0 : 1),
              cell: (r) =>
                defaultSiteId === r.id ? (
                  <Pill tone="info">{m.settings_default()}</Pill>
                ) : (
                  <Button size="xs" variant="ghost" className="-my-1" onClick={() => makeDefault(r)} data-make-default={r.id}>
                    {m.settings_make_default()}
                    <span className="sr-only"> {r.name}</span>
                  </Button>
                ),
            },
            { id: "coords", header: m.site_coordinates_header(), cell: (r) => <span className="tabular-nums">{formatCoordinates(r.latitude, r.longitude)}</span> },
            { id: "elevation", header: m.site_elevation(), align: "right", cell: (r) => (r.elevationM === null ? "–" : `${formatCount(r.elevationM)} m`) },
            { id: "zone", header: m.site_time_zone(), cell: (r) => r.timeZone, sortValue: (r) => r.timeZone },
            { id: "twilight", header: m.site_darkness(), cell: (r) => (r.twilight === "astronomical" ? m.site_twilight_astronomical() : m.site_twilight_nautical()) },
            { id: "alt", header: m.site_min_altitude(), align: "right", cell: (r) => `${r.minAltitudeDeg}°` },
            rowMenuColumn<ObservingSite>(
              (r) => r.name,
              (r) => [
                ...(defaultSiteId === r.id ? [] : [{ label: m.settings_make_default(), onSelect: () => void makeDefault(r) }]),
                { label: m.settings_edit(), onSelect: (trigger: HTMLElement | null) => openEditor({ site: r }, trigger) },
                { label: m.settings_remove(), destructive: true, onSelect: () => setRemoving(r) },
              ],
            ),
          ]}
        />

        {suggestions.length > 0 ? (
          <Section
            title={m.site_from_headers()}
            level={3}
            id="sites-headers"
            actions={<HelpTip label={m.site_headers_about()}>{m.site_headers_help()}</HelpTip>}
          >
            <ul className="divide-y rounded-lg border">
              {suggestions.map((s) => (
                <li key={`${s.latitude},${s.longitude}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="tabular-nums">
                    {formatCoordinates(s.latitude, s.longitude)} <span className="text-muted-foreground">{m.site_in_sessions({ count: s.sessions, n: formatCount(s.sessions) })}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(event) => openEditor({ site: null, prefill: { latitude: String(s.latitude), longitude: String(s.longitude) } }, event.currentTarget)}
                  >
                    {m.site_add_as_site()}
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
        title={m.settings_remove_title({ name: removing?.name ?? "" })}
        description={null}
        changes={[
          m.settings_remove_named({ name: removing?.name ?? "" }),
          ...(removing && removing.id === defaultSiteId ? [nextDefault ? m.site_default_change({ name: nextDefault.name }) : m.site_no_default()] : []),
          ...(removing && removing.id === planningSiteId ? [m.site_clear_planning()] : []),
          ...(removing && reminders.siteId === removing.id && reminders.enabled ? [m.status_notifications_off()] : []),
        ]}
        confirmLabel={m.site_remove_confirm()}
        tone="destructive"
        onConfirm={() => (removing ? deleteSite(removing) : undefined)}
      />
      <ConfirmDialog
        open={confirmDefault !== null}
        onOpenChange={(open) => !open && setConfirmDefault(null)}
        title={m.site_make_default_title({ name: confirmDefault?.name ?? "" })}
        description={null}
        changes={[
          m.site_default_change({ name: confirmDefault?.name ?? "" }),
          m.site_reminders_change({ from: sites.find((s) => s.id === reminders.siteId)?.name ?? m.site_previous(), to: confirmDefault?.name ?? "" }),
        ]}
        confirmLabel={m.settings_make_default()}
        onConfirm={() => (confirmDefault ? makeDefault(confirmDefault) : undefined)}
      />
    </div>
  )
}
