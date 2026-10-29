/**
 * Settings › Locations (LIB-FR-01, LIB-FR-21): every registered location
 * in one table, Name and Actions pinned when the columns don't fit, with
 * Add location… in its heading. Rows, actions and dialogs: locations.tsx.
 */
import { FolderPlus } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionError, TableSkeleton } from "@/components/app/feedback"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { AddLocationDialog, locationColumns, useLocationActions, useLocationRows } from "./locations"
import { Gap, readError } from "./parts"

export function LocationsPage() {
  const m = useMessages()
  const { rows, error, retry } = useLocationRows()
  const actions = useLocationActions()
  const [adding, setAdding] = useState(false)
  return (
    <SettingsPage title={m.common_locations()}>
      {rows ? (
        <ListSection
          title={m.location_list_title()}
          add={{ id: "add-location", label: m.storage_add_location(), icon: FolderPlus, opensDialog: true, run: () => setAdding(true) }}
          table={{
            label: m.location_list_title(),
            rows,
            columns: locationColumns(m, { role: true }),
            getRowId: (r) => r.state.location.id,
            rowLabel: (r) => r.state.location.name,
            rowActions: actions.rowActions,
            stickyFirstColumn: true,
            empty: m.storage_no_locations(),
          }}
        />
      ) : error ? (
        <ActionError message={readError(m, error)} onRetry={retry} />
      ) : (
        <TableSkeleton rows={3} columns={6} label={m.location_list_title()} />
      )}
      <Gap what={m.settings_location_space_title()} detail={m.settings_gap_location_space()} />
      <AddLocationDialog role={null} open={adding} onOpenChange={setAdding} />
      {actions.dialogs}
    </SettingsPage>
  )
}
