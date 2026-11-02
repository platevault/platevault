/**
 * Settings › Locations (LIB-FR-01, LIB-FR-21; J19 S6; PRJ-FR-17 item 4):
 * every registered location in one table, Name and Actions pinned when the
 * columns don't fit, with Add location… in its heading. Rows, actions and
 * dialogs: locations.tsx.
 *
 * The links into the page narrow it: `?issues=with-issues` (the status
 * bar's counter) lists the locations that need attention, and
 * `?locationId=` (Home's ingestions) lists that location and focuses its
 * row. The notice above the table says so and offers Show all.
 *
 * Low space is the share of a volume's capacity under which a location's
 * free space is low, `storage.lowSpacePercent` of the workflow settings
 * (`workflow_settings_save`, 10% by default). Saving goes through
 * `settingsWrite`, which reads every library read again, so the Low space
 * badges here and on Home follow the saved share.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { FolderPlus, Pencil } from "lucide-react"
import { useEffect, useState } from "react"
import { library, type StorageSettings, type WorkflowSettingsRecord_Serialize } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { KeyValueList } from "@/components/app/data"
import { ActionError, type PageNotice, TableSkeleton } from "@/components/app/feedback"
import { NumberField } from "@/components/app/fields"
import { blockedByErrors, type FieldErrors, type FieldPaths, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { Section } from "@/components/app/page"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { numberText } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { AddLocationDialog, failureDetail, hasIssue, locationColumns, useLocationActions, useLocationRows } from "./locations"
import { Gap, Read, readError } from "./parts"
import { settingsWrite, workflowQuery } from "./queries"

/** The share the library accepts, as `StorageSettings::LOW_SPACE_PERCENT` validates it. */
const LOW_SPACE = { min: 1, max: 50 }

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
            columns: locationColumns(m, { role: true, space: true }),
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
      <LowSpaceSection />
      <Gap what={m.settings_location_footprint_title()} detail={m.settings_gap_location_footprint()} />
      <AddLocationDialog role={null} open={adding} onOpenChange={setAdding} />
      {actions.dialogs}
    </SettingsPage>
  )
}

function LowSpaceSection() {
  const m = useMessages()
  const workflow = useQuery(workflowQuery())
  const [editing, setEditing] = useState(false)
  const record = workflow.data
  const edit = record ? <ActionButton action={{ id: "edit-low-space", label: m.settings_edit(), icon: Pencil, opensDialog: true, run: () => setEditing(true) }} /> : undefined
  return (
    <Section title={m.status_low_space()} description={m.settings_low_space_help()} actions={edit}>
      <Read query={workflow} label={m.status_low_space()}>
        {(data) => <KeyValueList items={[{ label: m.settings_low_space_below(), value: m.settings_value_percent({ value: numberText(data.settings.storage.lowSpacePercent) }) }]} />}
      </Read>
      {record ? <LowSpaceDialog record={record} open={editing} onOpenChange={setEditing} /> : null}
    </Section>
  )
}

type LowSpaceField = "percent"

const LOW_SPACE_PATHS: FieldPaths<LowSpaceField> = { percent: "storage.lowSpacePercent" }

function lowSpaceErrors(m: Messages, v: StorageSettings): FieldErrors<LowSpaceField> {
  const percent = v.lowSpacePercent
  return { percent: Number.isInteger(percent) && percent >= LOW_SPACE.min && percent <= LOW_SPACE.max ? undefined : m.settings_low_space_range() }
}

function LowSpaceDialog({ record, open, onOpenChange }: { record: WorkflowSettingsRecord_Serialize; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown, refusing } = useDialogForm<StorageSettings, LowSpaceField>(open, () => record.settings.storage)
  const errors = lowSpaceErrors(m, values)
  const label = m.settings_save()
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.status_low_space()}
      confirm={{
        id: "save-low-space",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => refusing(settingsWrite(client, () => library.workflowSettingsSave({ ...record.settings, storage: values }, record.revision)), LOW_SPACE_PATHS),
      }}
    >
      <NumberField
        label={m.settings_low_space_below()}
        description={m.settings_low_space_help()}
        unit={m.settings_unit_percent()}
        min={LOW_SPACE.min}
        max={LOW_SPACE.max}
        step={1}
        value={values.lowSpacePercent}
        onChange={(lowSpacePercent) => set({ lowSpacePercent: lowSpacePercent ?? Number.NaN }, ["percent"])}
        error={shown(errors, "percent")}
      />
    </FormDialog>
  )
}
