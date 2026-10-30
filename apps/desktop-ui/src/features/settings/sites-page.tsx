/**
 * Settings › Observing sites (PLAN-FR-11, PLAN-FR-12, D-W170): the saved
 * sites with the default site, and Home's planning criteria.
 *
 * - Add site… and Edit… save a site at its revision (`planning_save_site`);
 *   Make default sets the default over the settings revision
 *   (`planning_set_default_site`). Either may move reminder subscriptions to
 *   reconfirmation; the library names them and Targets shows them.
 * - Planning criteria: the values Home's Tonight and calendar use, the same
 *   ones setup's Index step asks for, with no defaults. Set criteria… saves
 *   them over the revision read (`planning_save_home_criteria`).
 *
 * A refusal keeps the dialog open with the user's values; a stale revision
 * reads the sites or criteria again first.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, SlidersHorizontal } from "lucide-react"
import { useState } from "react"
import { library, type ObservingSite, type PlanCriteria, type PlanningSites, type SiteInput } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { NumberField, TextField } from "@/components/app/fields"
import { blockedByErrors, type FieldPaths, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { homeCriteriaQuery } from "@/components/domain/plan-criteria"
import { PlanCriteriaDialog } from "@/components/domain/plan-criteria-dialog"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { numberText } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { Read } from "./parts"
import { settingsWrite, sitesQuery } from "./queries"

function coordinates(m: Messages, site: ObservingSite): string {
  const { latitudeDeg: lat, longitudeDeg: lon } = site
  if (lat === null || lon === null) return "–"
  return m.site_coordinates({ latitude: numberText(Math.abs(lat)), ns: lat < 0 ? m.site_south() : m.site_north(), longitude: numberText(Math.abs(lon)), ew: lon < 0 ? m.site_west() : m.site_east() })
}

function siteColumns(m: Messages, defaultId: string | null): Column<ObservingSite>[] {
  return [
    {
      id: "name",
      header: m.site_name(),
      rowHeader: true,
      truncate: true,
      truncateMin: "name",
      sortValue: (s) => s.name,
      cell: (s) => s.name,
    },
    { id: "default", header: m.settings_default(), sortValue: (s) => (s.id === defaultId ? 0 : 1), cell: (s) => (s.id === defaultId ? <StatusBadge kind="site" value="default" /> : "") },
    { id: "coordinates", header: m.site_coordinates_header(), sortValue: (s) => s.latitudeDeg, cell: (s) => coordinates(m, s) },
    { id: "elevation", header: m.site_elevation(), align: "right", sortValue: (s) => s.elevationM, cell: (s) => (s.elevationM === null ? "–" : m.site_elevation_value({ metres: numberText(s.elevationM) })) },
    { id: "zone", header: m.site_time_zone(), sortValue: (s) => s.timeZone, cell: (s) => s.timeZone },
  ]
}

function criteriaItems(m: Messages, criteria: PlanCriteria) {
  const moon =
    criteria.moon.kind === "min_separation"
      ? m.settings_joined({ first: m.criteria_moon_min_separation(), second: m.site_degrees_value({ degrees: numberText(criteria.moon.minSeparationDeg ?? 0) }) })
      : criteria.moon.kind === "below_horizon"
        ? m.criteria_moon_below_horizon()
        : m.criteria_moon_none()
  const darkness = { civil: m.criteria_darkness_civil(), nautical: m.criteria_darkness_nautical(), astronomical: m.criteria_darkness_astronomical() }[criteria.darkness]
  return [
    { label: m.criteria_min_altitude(), value: criteria.minAltitudeDeg === null ? "–" : m.site_degrees_value({ degrees: numberText(criteria.minAltitudeDeg) }) },
    { label: m.criteria_darkness(), value: darkness },
    { label: m.criteria_moon(), value: moon },
    { label: m.criteria_min_duration(), value: m.settings_value_minutes({ value: numberText(criteria.minDurationMinutes) }) },
  ]
}

export function SitesPage() {
  const m = useMessages()
  const client = useQueryClient()
  const sites = useQuery(sitesQuery())
  const criteria = useQuery(homeCriteriaQuery())
  // Only the id: the dialog reads the site from the current read, so a Save after `conflict` names the revision read again.
  const [editing, setEditing] = useState<string | null>(null)
  const editedSite = editing && editing !== "new" ? sites.data?.sites.find((s) => s.id === editing) : undefined
  const [settingCriteria, setSettingCriteria] = useState(false)
  const rowActions = (data: PlanningSites) => (site: ObservingSite): MenuItem[] => [
    {
      id: "make-default",
      label: m.settings_make_default(),
      unavailable: site.id === data.defaultSiteId ? { action: m.settings_make_default(), reason: m.status_default_site(), blockers: [] } : undefined,
      run: () => settingsWrite(client, () => library.planningSetDefaultSite(site.id, data.settingsRevision)),
    },
    { id: "edit-site", label: m.settings_edit(), opensDialog: true, run: () => setEditing(site.id) },
  ]
  return (
    <SettingsPage title={m.settings_sites()}>
      <Read query={sites} label={m.site_list()}>
        {(data) => (
          <ListSection
            title={m.site_list()}
            add={{ id: "add-site", label: m.tonight_add_site(), icon: Plus, opensDialog: true, run: () => setEditing("new") }}
            table={{ label: m.site_list(), rows: data.sites, columns: siteColumns(m, data.defaultSiteId), getRowId: (s) => s.id, rowLabel: (s) => s.name, rowActions: rowActions(data), empty: m.site_none() }}
          />
        )}
      </Read>
      <Section
        title={m.home_criteria_title()}
        description={m.setup_criteria_note()}
        level={3}
        actions={criteria.data ? <ActionButton action={{ id: "set-criteria", label: m.home_set_criteria(), icon: SlidersHorizontal, opensDialog: true, run: () => setSettingCriteria(true) }} /> : undefined}
      >
        <Read query={criteria} label={m.home_criteria_title()}>
          {(record) => (record.criteria ? <KeyValueList items={criteriaItems(m, record.criteria)} /> : m.status_not_set())}
        </Read>
      </Section>
      {editing === "new" || editedSite ? <SiteDialog site={editedSite ?? null} open onOpenChange={(open) => !open && setEditing(null)} /> : null}
      {criteria.data ? (
        <PlanCriteriaDialog
          record={criteria.data}
          open={settingCriteria}
          onOpenChange={setSettingCriteria}
          save={(next, expectedRevision) => settingsWrite(client, () => library.planningSaveHomeCriteria(next, expectedRevision))}
        />
      ) : null}
    </SettingsPage>
  )
}

interface SiteDraft {
  name: string
  latitudeDeg: number | null
  longitudeDeg: number | null
  elevationM: number | null
  timeZone: string
}
const SITE_PATHS: FieldPaths<keyof SiteDraft> = {
  name: "name",
  latitudeDeg: "latitudeDeg",
  longitudeDeg: "longitudeDeg",
  elevationM: "elevationM",
  timeZone: "timeZone",
}


function SiteDialog({ site, open, onOpenChange }: { site: ObservingSite | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown, refusing } = useDialogForm<SiteDraft>(open, () => ({
    name: site?.name ?? "",
    latitudeDeg: site?.latitudeDeg ?? null,
    longitudeDeg: site?.longitudeDeg ?? null,
    elevationM: site?.elevationM ?? null,
    timeZone: site?.timeZone ?? "",
  }))
  const label = site ? m.site_save_changes_button() : m.tonight_add_site()
  const within = (value: number | null, limit: number) => value !== null && Number.isFinite(value) && Math.abs(value) <= limit
  const errors = {
    name: values.name.trim() ? undefined : m.site_error_name_empty(),
    latitudeDeg: within(values.latitudeDeg, 90) ? undefined : m.site_error_latitude(),
    longitudeDeg: within(values.longitudeDeg, 180) ? undefined : m.site_error_longitude(),
    elevationM: values.elevationM === null || Number.isFinite(values.elevationM) ? undefined : m.site_error_elevation(),
    timeZone: values.timeZone.trim() ? undefined : m.site_error_time_zone_empty(),
  }
  const input: SiteInput = { name: values.name.trim(), latitudeDeg: values.latitudeDeg, longitudeDeg: values.longitudeDeg, elevationM: values.elevationM, timeZone: values.timeZone.trim() }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={site ? m.settings_edit_title({ name: site.name }) : m.tonight_add_site()}
      confirm={{
        id: "save-site",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => refusing(settingsWrite(client, () => library.planningSaveSite(site?.id ?? null, site?.revision ?? null, input)), SITE_PATHS),
      }}
    >
      <TextField label={m.site_name()} placeholder={m.site_name_placeholder()} value={values.name} onChange={(name) => set({ name })} error={shown(errors, "name")} autoFocus />
      <NumberField label={m.site_latitude_field()} min={-90} max={90} step={0.0001} value={values.latitudeDeg} onChange={(latitudeDeg) => set({ latitudeDeg })} error={shown(errors, "latitudeDeg")} />
      <NumberField label={m.site_longitude_field()} min={-180} max={180} step={0.0001} value={values.longitudeDeg} onChange={(longitudeDeg) => set({ longitudeDeg })} error={shown(errors, "longitudeDeg")} />
      <NumberField label={m.site_elevation_field()} step={1} value={values.elevationM} onChange={(elevationM) => set({ elevationM })} error={shown(errors, "elevationM")} />
      <TextField label={m.site_time_zone()} placeholder={m.site_time_zone_placeholder()} value={values.timeZone} onChange={(timeZone) => set({ timeZone })} error={shown(errors, "timeZone")} />
    </FormDialog>
  )
}
