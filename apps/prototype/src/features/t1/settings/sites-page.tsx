/**
 * Settings › Observing sites (J15 S6-S8, seam 7; plan §4a, C O1-O3). Sites
 * with latitude, longitude, elevation, IANA time zone, darkness and minimum
 * altitude, plus one explicit default site that Plan and Planning use unless
 * another is picked; PlateVault never picks one itself (HLD §14). Moving the
 * default also moves enabled reminders, so that is confirmed first. Header
 * coordinates no site covers are offered as new sites.
 */
import { MapPin } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import type { Action, ConfirmSpec, MenuItem } from "@/components/app/contracts"
import { EmptyState, type PageNotice, useSaveState } from "@/components/app/feedback"
import { ComboboxField, NumberField, SegmentedField, SelectField, SwitchField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { SiteLocationField } from "@/components/app/pickers"
import { SettingsSection } from "@/components/app/settings"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import type { ObservingSite } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { blockedByErrors, shownErrors } from "@/components/app/form-dialog"
import { deleteSite, formatCoordinates, remindersMoveWith, saveSite, setDefaultSite, type SiteValues, siteValues, TIME_ZONES, unmatchedCaptureSites, validateSite } from "../lib/sites"

type Editing = { site: ObservingSite | null; prefill?: Partial<SiteValues> }

/** A typed number as the form keeps it: empty for no value. */
function numberText(value: number | null): string {
  return value === null ? "" : String(value)
}

/** A form value as a number; empty or unreadable text is no value (the check names it). */
function textNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(",", "."))
  return value.trim() === "" || Number.isNaN(parsed) ? null : parsed
}

function SiteDialog({ editing, onClose }: { editing: Editing | null; onClose: () => void }) {
  const m = useMessages()
  const defaultSiteId = useStore((s) => s.settings.defaultSiteId)
  const reminderSite = useStore((s) => (s.catalog.reminders.enabled ? s.catalog.reminders.siteId : null))
  const [values, setValues] = useState<SiteValues>(siteValues(null))
  const [makeDefault, setMakeDefault] = useState(false)
  const [touched, setTouched] = useState<ReadonlySet<keyof SiteValues>>(new Set())
  const [shownFor, setShownFor] = useState<Editing | null>(null)
  // Each opening starts from the site as saved (or the prefill), with no messages shown yet.
  if (editing !== shownFor) {
    setShownFor(editing)
    if (editing) {
      setValues({ ...siteValues(editing.site), ...editing.prefill })
      setMakeDefault(editing.site ? defaultSiteId === editing.site.id : false)
      setTouched(new Set(editing.prefill ? (Object.keys(editing.prefill) as (keyof SiteValues)[]) : []))
    }
  }
  const site = editing?.site ?? null
  const isDefault = site !== null && site.id === defaultSiteId
  const errors = validateSite(store.getState().catalog, values, site?.id ?? null)
  const shown = shownErrors(errors, touched)
  const set = (patch: Partial<SiteValues>) => {
    setValues((current) => ({ ...current, ...patch }))
    setTouched((current) => new Set([...current, ...(Object.keys(patch) as (keyof SiteValues)[])]))
  }
  const label = site ? m.site_save_changes_button() : m.tonight_add_site()
  const confirm: Action = { id: "save-site", label, kind: "primary", unavailable: blockedByErrors(label, errors), run: () => saveSite(values, site?.id ?? null, makeDefault) }

  return (
    <FormDialog open={editing !== null} onOpenChange={(open) => !open && onClose()} title={site ? m.settings_edit_title({ name: site.name }) : m.tonight_add_site()} confirm={confirm}>
      <TextField label={m.site_name()} value={values.name} onChange={(name) => set({ name })} error={shown.name} placeholder={m.site_name_placeholder()} autoFocus />
      <SiteLocationField
        value={{ latitude: textNumber(values.latitude), longitude: textNumber(values.longitude), elevation: textNumber(values.elevation) }}
        onChange={(next) => set({ latitude: numberText(next.latitude), longitude: numberText(next.longitude), elevation: numberText(next.elevation) })}
        errors={{ latitude: shown.latitude, longitude: shown.longitude, elevation: shown.elevation }}
      />
      <ComboboxField
        label={m.site_time_zone()}
        value={values.timeZone || null}
        onChange={(timeZone) => set({ timeZone: timeZone ?? "" })}
        groups={[{ label: m.site_time_zone(), items: TIME_ZONES.map((zone) => ({ value: zone, label: zone })) }]}
        placeholder={m.site_time_zone_placeholder()}
        error={shown.timeZone}
      />
      <SegmentedField
        label={m.site_darkness()}
        description={m.site_sun_below({ degrees: values.twilight === "astronomical" ? "18" : "12" })}
        value={values.twilight}
        options={[
          { value: "astronomical", label: m.site_twilight_astronomical() },
          { value: "nautical", label: m.site_twilight_nautical() },
        ]}
        onChange={(twilight) => set({ twilight })}
      />
      <NumberField label={m.site_min_altitude_field()} value={textNumber(values.minAltitude)} onChange={(value) => set({ minAltitude: numberText(value) })} min={0} max={90} error={shown.minAltitude} />
      {/* The default is cleared only by choosing another site, so the default site offers no switch that could promise otherwise. */}
      {isDefault ? null : (
        <SwitchField
          label={m.settings_make_default()}
          description={reminderSite && reminderSite !== site?.id ? m.site_default_help() : undefined}
          checked={makeDefault}
          onChange={setMakeDefault}
        />
      )}
    </FormDialog>
  )
}

export function SitesPage() {
  const m = useMessages()
  const sites = useStore((s) => Object.values(s.catalog.sites))
  const defaultSiteId = useStore((s) => s.settings.defaultSiteId)
  const planningSiteId = useStore((s) => s.settings.planningSiteId)
  const reminders = useStore((s) => s.catalog.reminders)
  const suggestions = useStore((s) => unmatchedCaptureSites(s.catalog))
  const [editing, setEditing] = useState<Editing | null>(null)
  const [confirmDefault, setConfirmDefault] = useState<ObservingSite | null>(null)
  const { save, indicator } = useSaveState()

  /** Reminders follow the default site; moving them is scope-changing, so it is confirmed first (HLD §9, PLAN-FR-03). */
  function defaultConfirm(site: ObservingSite): ConfirmSpec | undefined {
    if (!remindersMoveWith(store.getState(), site.id)) return undefined
    return {
      title: m.site_make_default_title({ name: site.name }),
      summary: m.site_reminders_change({ from: sites.find((s) => s.id === reminders.siteId)?.name ?? m.site_previous(), to: site.name }),
      confirm: { label: m.settings_make_default() },
    }
  }

  const makeDefault = (site: ObservingSite) => save(() => setDefaultSite(site))

  function makeDefaultAction(site: ObservingSite): Action {
    return { id: "make-default", label: m.settings_make_default(), confirm: defaultConfirm(site), run: () => makeDefault(site) }
  }

  function removeAction(site: ObservingSite): Action {
    const next = sites.filter((s) => s.id !== site.id).sort((a, b) => a.name.localeCompare(b.name))[0]
    const changes = [
      ...(site.id === defaultSiteId ? [next ? m.settings_default_named({ name: next.name }) : m.site_no_default()] : []),
      ...(site.id === planningSiteId ? [m.site_clear_planning()] : []),
      ...(reminders.enabled && reminders.siteId === site.id ? [m.status_notifications_off()] : []),
    ]
    return {
      id: "remove",
      label: m.settings_remove(),
      kind: "destructive",
      opensDialog: true,
      confirm: { title: m.settings_remove_title({ name: site.name }), summary: changes.length ? changes.join(" · ") : undefined, confirm: { label: m.site_remove_confirm(), kind: "destructive" } },
      run: () => deleteSite(site),
    }
  }

  const add: Action = { id: "add-site", label: m.tonight_add_site(), opensDialog: true, run: () => setEditing({ site: null }) }
  const notice: PageNotice | null = sites.length > 0 && !defaultSiteId ? { tone: "info", title: m.site_no_default() } : null
  const NONE = "none"

  return (
    <SettingsPage title={m.settings_sites()} notice={notice}>
      {sites.length > 0 ? (
        <SettingsSection title={m.status_default_site()} actions={indicator}>
          <SelectField
            label={m.settings_default()}
            value={defaultSiteId ?? NONE}
            options={[...(defaultSiteId ? [] : [{ value: NONE, label: m.site_no_default(), disabled: true }]), ...[...sites].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name }))]}
            onChange={(id) => {
              const site = sites.find((s) => s.id === id)
              if (!site || site.id === defaultSiteId) return
              if (defaultConfirm(site)) setConfirmDefault(site)
              else makeDefault(site)
            }}
          />
        </SettingsSection>
      ) : null}

      <ListSection<ObservingSite>
        title={m.site_list()}
        add={add}
        table={{
          label: m.settings_sites(),
          rows: sites,
          getRowId: (r) => r.id,
          rowLabel: (r) => r.name,
          initialSort: { columnId: "name", direction: "asc" },
          empty: <EmptyState icon={MapPin} title={m.site_none()} action={<ActionButton action={add} />} />,
          primaryRowAction: (r) => (r.id === defaultSiteId ? null : makeDefaultAction(r)),
          rowActions: (r): MenuItem[] => [
            ...(r.id === defaultSiteId ? [] : [makeDefaultAction(r)]),
            { id: "edit", label: m.settings_edit(), opensDialog: true, run: () => setEditing({ site: r }) },
            { separator: true },
            removeAction(r),
          ],
          columns: [
            { id: "name", header: m.site_name(), rowHeader: true, sortValue: (r) => r.name, cell: (r) => r.name },
            { id: "default", header: m.settings_default(), sortValue: (r) => (r.id === defaultSiteId ? 0 : 1), cell: (r) => (r.id === defaultSiteId ? m.settings_default() : "") },
            { id: "coords", header: m.site_coordinates_header(), sortValue: (r) => r.latitude, cell: (r) => formatCoordinates(r.latitude, r.longitude) },
            { id: "elevation", header: m.site_elevation(), align: "right", sortValue: (r) => r.elevationM, cell: (r) => (r.elevationM === null ? "–" : m.site_elevation_value({ metres: formatCount(r.elevationM) })) },
            { id: "zone", header: m.site_time_zone(), sortValue: (r) => r.timeZone, cell: (r) => r.timeZone },
            { id: "twilight", header: m.site_darkness(), sortValue: (r) => r.twilight, cell: (r) => (r.twilight === "astronomical" ? m.site_twilight_astronomical() : m.site_twilight_nautical()) },
            { id: "alt", header: m.site_min_altitude(), align: "right", sortValue: (r) => r.minAltitudeDeg, cell: (r) => m.site_degrees_value({ degrees: formatCount(r.minAltitudeDeg) }) },
          ],
        }}
      />

      {suggestions.length > 0 ? (
        <ListSection<(typeof suggestions)[number]>
          title={m.site_from_headers()}
          table={{
            label: m.site_from_headers(),
            rows: suggestions,
            getRowId: (s) => `${s.latitude},${s.longitude}`,
            rowLabel: (s) => formatCoordinates(s.latitude, s.longitude),
            initialSort: { columnId: "sessions", direction: "desc" },
            primaryRowAction: (s) => ({ id: "add-as-site", label: m.site_add_as_site(), opensDialog: true, run: () => setEditing({ site: null, prefill: { latitude: String(s.latitude), longitude: String(s.longitude) } }) }),
            columns: [
              { id: "coords", header: m.site_coordinates_header(), rowHeader: true, sortValue: (s) => s.latitude, cell: (s) => formatCoordinates(s.latitude, s.longitude) },
              { id: "sessions", header: m.nav_sessions(), align: "right", sortValue: (s) => s.sessions, cell: (s) => formatCount(s.sessions) },
            ],
          }}
        />
      ) : null}

      <SiteDialog editing={editing} onClose={() => setEditing(null)} />
      {confirmDefault ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirmDefault(null)}
          {...(defaultConfirm(confirmDefault) ?? { title: m.site_make_default_title({ name: confirmDefault.name }), confirm: { label: m.settings_make_default() } })}
          onConfirm={() => makeDefault(confirmDefault)}
        />
      ) : null}
    </SettingsPage>
  )
}
