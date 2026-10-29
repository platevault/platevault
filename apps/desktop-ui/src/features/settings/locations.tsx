/**
 * Registered locations as Settings › Locations and setup's Locations and
 * Index steps show them (LIB-FR-01, LIB-FR-21): the rows, their columns,
 * the row actions and the dialogs behind them. Every row is the library's
 * read (`library_list_locations`) beside the location's newest scan
 * (`library_list_operations`); every write goes through `settingsWrite`, so
 * a refusal keeps the dialog and its draft, and a stale revision reads the
 * location again.
 *
 * - Add location…: the role, a folder from the native picker
 *   (`library_pick_folder`: Cancel answers `null` and changes nothing) and
 *   a display name. Registering records access only; it indexes nothing.
 * - Rename…, Rescan (Index now before the first scan), Choose folder
 *   again… for a location that is not available, and Retire location… after
 *   the library's review, which a pinned calibration file blocks.
 *
 * The frame count, footprint and volume space columns of LIB-FR-21 have no
 * library read yet (astro-plan-wre19.10); the table says so under itself.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderSearch, Play, RotateCw } from "lucide-react"
import { type ReactNode, useState } from "react"
import { type Availability, library, type LocationRole, type LocationState, type NativePathWire, type ScanOperation, type VolumeKind } from "@/api/ipc"
import { libraryQuery } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { DateText, KeyValueList, PathText } from "@/components/app/data"
import { FieldGroup, SelectField, TextField } from "@/components/app/fields"
import { blockedByErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { StatusBadge } from "@/components/app/status"
import { formatCount, formatList } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { locationsQuery, scansQuery, settingsWrite } from "./queries"

export const ROLES: readonly LocationRole[] = ["captures", "calibration", "results"]

/** One registered location and its newest scan, if it was ever scanned. */
export interface LocationRow {
  state: LocationState
  scan: ScanOperation | null
}

export function isScanning(row: LocationRow): boolean {
  return row.scan?.state === "running"
}

/** The registered locations with their newest scans; `null` until both reads answered. */
export function useLocationRows(): { rows: LocationRow[] | null; error: unknown; retry: () => void } {
  const locations = useQuery(locationsQuery())
  const scans = useQuery(scansQuery())
  const retry = () => {
    void locations.refetch()
    void scans.refetch()
  }
  if (!locations.data || !scans.data) return { rows: null, error: locations.error ?? scans.error, retry }
  // `library_list_operations` lists newest first, so a location's first scan is its newest.
  const newest = new Map<string, ScanOperation>()
  for (const scan of scans.data) if (!newest.has(scan.locationId)) newest.set(scan.locationId, scan)
  return { rows: locations.data.map((state) => ({ state, scan: newest.get(state.location.id) ?? null })), error: null, retry }
}

export function roleTitle(m: Messages, role: LocationRole): { title: string; description: string; add: string; list: string } {
  switch (role) {
    case "captures":
      return { title: m.status_role_captures(), description: m.location_role_captures_description(), add: m.location_role_captures_add(), list: m.location_role_captures_list() }
    case "calibration":
      return { title: m.status_role_calibration(), description: m.location_role_calibration_description(), add: m.location_role_calibration_add(), list: m.location_role_calibration_list() }
    case "results":
      return { title: m.status_role_results(), description: m.location_role_results_description(), add: m.location_role_results_add(), list: m.location_role_results_list() }
  }
}

function volumeText(m: Messages, kind: VolumeKind): string {
  const words: Record<VolumeKind, string> = { local: m.settings_volume_local(), removable: m.settings_volume_removable(), network: m.settings_volume_network() }
  return words[kind]
}

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  const value = availability === "available" ? "online" : availability === "missing" ? "absent" : availability === "offline" ? "offline" : availability === "retired" ? "retired" : "unreadable"
  return <StatusBadge kind="availability" value={value} />
}

function IndexedCell({ row }: { row: LocationRow }) {
  const m = useMessages()
  if (isScanning(row)) return <StatusBadge kind="operation" value="running" label={m.location_indexing()} />
  if (row.scan?.finishedAt) return <DateText at={row.scan.finishedAt} />
  return <>{m.location_not_indexed_yet()}</>
}

/** Name, Role (with `role`), Path, Volume, State and Indexed. */
export function locationColumns(m: Messages, { role }: { role: boolean }): Column<LocationRow>[] {
  return [
    { id: "name", header: m.location_col_name(), rowHeader: true, truncate: true, truncateMin: "name", sortValue: (r) => r.state.location.name, cell: (r) => r.state.location.name },
    ...(role ? [{ id: "role", header: m.location_role(), sortValue: (r: LocationRow) => ROLES.indexOf(r.state.location.role), cell: (r: LocationRow) => <StatusBadge kind="role" value={r.state.location.role} /> }] : []),
    { id: "path", header: m.location_path(), truncate: true, sortValue: (r) => r.state.location.path.display, cell: (r) => <PathText path={r.state.location.path.display} truncate /> },
    { id: "volume", header: m.location_volume(), sortValue: (r) => r.state.location.volumeKind, cell: (r) => volumeText(m, r.state.location.volumeKind) },
    { id: "state", header: m.location_col_state(), sortValue: (r) => r.state.location.availability, cell: (r) => <AvailabilityBadge availability={r.state.location.lifecycle === "retired" ? "retired" : r.state.location.availability} /> },
    { id: "indexed", header: m.location_col_indexed(), truncateMin: "date", sortValue: (r) => r.scan?.finishedAt ?? null, cell: (r) => <IndexedCell row={r} /> },
  ]
}

/** The last segment of a picked folder: the display name it suggests. */
function folderName(path: NativePathWire): string {
  const parts = path.display.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path.display
}

/** Run the native folder picker; Cancel resolves `null` and nothing else happens. */
export async function pickFolder(onPicked: (path: NativePathWire) => void) {
  const picked = await library.libraryPickFolder()
  if (picked.ok && picked.data) onPicked(picked.data)
  return picked
}

type Dialog = { kind: "rename" | "retire"; row: LocationRow } | null

/** The row actions of a location and the dialogs they open; `rowActions` is empty for a retired location. */
export function useLocationActions(): { rowActions: (row: LocationRow) => MenuItem[]; dialogs: ReactNode } {
  const m = useMessages()
  const client = useQueryClient()
  const [dialog, setDialog] = useState<Dialog>(null)
  const rowActions = (row: LocationRow): MenuItem[] => {
    const { location } = row.state
    if (location.lifecycle === "retired") return []
    const scanLabel = row.scan ? m.location_rescan() : m.location_index_now()
    const scanBlocked = isScanning(row) ? m.location_indexing() : location.availability !== "available" ? m.settings_location_not_available() : null
    const items: MenuItem[] = [
      {
        id: "rescan",
        label: scanLabel,
        icon: row.scan ? RotateCw : Play,
        unavailable: scanBlocked ? { action: scanLabel, reason: scanBlocked, blockers: [] } : undefined,
        run: () => settingsWrite(client, () => library.libraryStartScan(location.id)),
      },
      { id: "rename", label: m.equipment_rename(), opensDialog: true, run: () => setDialog({ kind: "rename", row }) },
    ]
    if (location.availability !== "available") {
      items.push({
        id: "choose-again",
        label: m.location_choose_folder_again(),
        icon: FolderSearch,
        opensDialog: true,
        run: async () => {
          const picked = await library.libraryPickFolder()
          if (!picked.ok) return picked
          if (!picked.data) return
          const path = picked.data
          return settingsWrite(client, () => library.libraryReselectLocation(location.id, path, location.decisionRevision))
        },
      })
    }
    items.push({ separator: true }, { id: "retire", label: m.location_retire(), kind: "destructive", opensDialog: true, run: () => setDialog({ kind: "retire", row }) })
    return items
  }
  const close = (open: boolean) => !open && setDialog(null)
  const dialogs = (
    <>
      {dialog?.kind === "rename" ? <RenameLocationDialog row={dialog.row} open onOpenChange={close} /> : null}
      {dialog?.kind === "retire" ? <RetireLocationDialog row={dialog.row} open onOpenChange={close} /> : null}
    </>
  )
  return { rowActions, dialogs }
}

interface AddDraft {
  role: LocationRole
  path: NativePathWire | null
  name: string
}

/** Add location…: the role (fixed when `role` is given), a folder from the native picker and its display name. */
export function AddLocationDialog({ role, open, onOpenChange }: { role: LocationRole | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown } = useDialogForm<AddDraft>(open, () => ({ role: role ?? "captures", path: null, name: "" }))
  const label = m.storage_add_location()
  const errors = { path: values.path ? undefined : m.import_choose_a_folder(), name: values.name.trim() ? undefined : m.location_error_name_empty() }
  const choose: Action = {
    id: "choose-folder",
    label: values.path ? m.location_choose_again() : m.import_choose_a_folder(),
    icon: FolderSearch,
    run: () => pickFolder((path) => set({ path, ...(values.name.trim() ? {} : { name: folderName(path) }) })),
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={role ? roleTitle(m, role).add : label}
      confirm={{
        id: "register-location",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => {
          const path = values.path
          if (!path) return
          return settingsWrite(client, () => library.libraryRegisterLocation(path, values.name.trim(), values.role))
        },
      }}
    >
      {role ? null : <SelectField<LocationRole> label={m.location_role()} description={roleTitle(m, values.role).description} value={values.role} options={ROLES.map((value) => ({ value, label: roleTitle(m, value).title }))} onChange={(next) => set({ role: next })} />}
      <FieldGroup label={m.location_folder()} action={<ActionButton action={choose} />}>
        {values.path ? <PathText path={values.path.display} /> : m.status_not_set()}
      </FieldGroup>
      <TextField label={m.location_display_name()} value={values.name} onChange={(name) => set({ name })} error={shown(errors, "name")} />
    </FormDialog>
  )
}

function RenameLocationDialog({ row, open, onOpenChange }: { row: LocationRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { location } = row.state
  const { values, set, shown } = useDialogForm(open, () => ({ name: location.name }))
  const label = m.settings_save()
  const errors = { name: values.name.trim() ? undefined : m.location_error_name_empty() }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.settings_edit_title({ name: location.name })}
      confirm={{
        id: "rename-location",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => settingsWrite(client, () => library.libraryUpdateLocation(location.id, values.name.trim(), location.decisionRevision)),
      }}
    >
      <TextField label={m.location_display_name()} value={values.name} onChange={(name) => set({ name })} error={shown(errors, "name")} autoFocus />
    </FormDialog>
  )
}

/** Retire location… (LIB-FR-15): the library's review of what references the location, then Retire at that review's revision. No file changes. */
function RetireLocationDialog({ row, open, onOpenChange }: { row: LocationRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { location } = row.state
  const review = useQuery({ ...libraryQuery("libraryReviewRetireLocation", location.id), enabled: open })
  const label = m.location_retire()
  const reviewed = review.data
  const blocked = reviewed?.blocked.length ?? 0
  const unavailable: Action["unavailable"] = !reviewed
    ? { action: m.actions_blocked({ action: label }), reason: review.isError ? m.home_read_failed() : m.common_loading(), blockers: [] }
    : blocked > 0
      ? { action: m.actions_blocked({ action: label }), reason: m.location_retire_pinned({ count: blocked, n: formatCount(blocked) }), blockers: [] }
      : undefined
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.location_retire_title({ name: location.name })}
      confirm={{
        id: "retire-location",
        label,
        kind: "destructive",
        unavailable,
        run: () => (reviewed ? settingsWrite(client, () => library.libraryRetireLocation(reviewed.id, location.id, reviewed.expectedRevision)) : undefined),
      }}
    >
      <KeyValueList
        items={[
          { label: m.location_path(), value: <PathText path={location.path.display} /> },
          { label: m.nav_sessions(), value: reviewed ? m.location_sessions_count({ count: reviewed.sessions.length, n: formatCount(reviewed.sessions.length) }) : "–" },
          { label: m.nav_projects(), value: reviewed ? (reviewed.projects.length > 0 ? formatList(reviewed.projects.map((p) => p.name)) : m.location_retire_pin_no_project()) : "–" },
          { label: m.settings_retire_files(), value: m.location_no_file_changes() },
        ]}
      />
    </FormDialog>
  )
}
