/**
 * Settings › Locations (LIB-FR-01, LIB-FR-21; J19 S6): every registered
 * location in one table, Name and Actions pinned when the columns don't
 * fit, with Add location… in its heading. Rows, actions and dialogs:
 * locations.tsx.
 *
 * The links into the page narrow it: `?issues=with-issues` (the status
 * bar's counter) lists the locations that need attention, and
 * `?locationId=` (Home's ingestions) lists that location and focuses its
 * row. The notice above the table says so and offers Show all.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { FolderPlus } from "lucide-react"
import { useEffect, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { ActionError, type PageNotice, TableSkeleton } from "@/components/app/feedback"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { AddLocationDialog, failureDetail, hasIssue, locationColumns, useLocationActions, useLocationRows } from "./locations"
import { Gap, readError } from "./parts"

export function LocationsPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const { rows, error, retry } = useLocationRows()
  const actions = useLocationActions(rows)
  const [adding, setAdding] = useState(false)
  const focusId = search.locationId ?? null
  const withIssues = search.issues === "with-issues"
  const shown = rows ? rows.filter((row) => (focusId ? row.state.location.id === focusId : withIssues ? hasIssue(row) : true)) : null
  const focused = focusId ? rows?.find((row) => row.state.location.id === focusId) : undefined
  const notice: PageNotice | null =
    focusId || withIssues
      ? {
          tone: "info",
          title: focused ? m.settings_locations_one({ name: focused.state.location.name }) : m.settings_locations_with_issues(),
          actions: <ActionButton action={{ id: "show-all-locations", label: m.plan_show_all(), run: () => void navigate({ to: "/settings/locations", search: {} }) }} />,
        }
      : null
  // Home's link names one location: its row takes focus once it is listed.
  useEffect(() => {
    if (!focused) return
    document.querySelector<HTMLElement>('#main tr[aria-current] button, #main tr[aria-current] [tabindex="0"]')?.focus()
  }, [focused])
  return (
    <SettingsPage title={m.common_locations()} notice={notice}>
      {shown ? (
        <ListSection
          title={m.location_list_title()}
          add={{ id: "add-location", label: m.storage_add_location(), icon: FolderPlus, opensDialog: true, run: () => setAdding(true) }}
          table={{
            label: m.location_list_title(),
            rows: shown,
            columns: locationColumns(m, { role: true }),
            getRowId: (r) => r.state.location.id,
            rowLabel: (r) => r.state.location.name,
            rowActions: actions.rowActions,
            expand: { ...failureDetail, defaultExpanded: focusId ? [focusId] : [] },
            activeRowId: focusId,
            stickyFirstColumn: true,
            empty: m.storage_no_locations(),
          }}
        />
      ) : error ? (
        <ActionError message={readError(m, error)} onRetry={retry} />
      ) : (
        <TableSkeleton rows={3} columns={6} label={m.location_list_title()} />
      )}
      {/* astro-plan-wre19.10: no per-location frame count, footprint or volume space yet. */}
      <Gap what={m.settings_location_space_title()} detail={m.settings_gap_location_space()} />
      <AddLocationDialog role={null} open={adding} onOpenChange={setAdding} />
      {actions.dialogs}
    </SettingsPage>
  )
}
