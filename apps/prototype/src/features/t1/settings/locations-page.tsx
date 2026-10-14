/**
 * Settings › Locations (J19 S2-S3, S5, S7, S12-S13, S15; J28 S11-S13;
 * LIB-FR-01, -06, -07, -15; LIB-AC-04, -05, -11, -16; D11; P-ARC1; plan §4a,
 * C L1-L9). One table of registered locations: name, role, the state only
 * when it needs attention, last index, frames, disk use (P-STO2) and the
 * volume's free space. Rescan sits in the row; Make default, Edit, Locate or
 * remap, Choose folder again, Retire location and Remove are in the row's
 * menu and on right-click; a row's disclosure shows its details. Several
 * archive locations may be registered; the Default archive location is the
 * Archive step's default destination. `?locationId=` opens one location,
 * `?add=<role>` starts adding one, `?duplicates=review` opens the Duplicates
 * review (the duplicates issue links there).
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { FolderPlus, Play, RotateCw } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList, PathText } from "@/components/app/data"
import { EmptyState, type PageNotice, useSaveState } from "@/components/app/feedback"
import { SelectField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { SettingsSection } from "@/components/app/settings"
import { StatusBadge } from "@/components/app/status"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { defaultArchiveLocation } from "@/domain/derive"
import { locationAvailability } from "@/domain/library"
import { locationDiskUse } from "@/domain/storage"
import type { Location, LocationRole } from "@/domain/types"
import { formatBytes, formatCount, formatDateTime } from "@/lib/format"
import { setDefaultArchiveLocation } from "@/store/actions/settings"
import { store, useStore } from "@/store/core"
import { AddLocationFlow } from "../components/add-location-flow"
import { DuplicatesReview } from "../components/duplicates-review"
import { blockedByErrors } from "@/components/app/form-dialog"
import { useLocationActions } from "../components/location-actions"
import { LocationAttentionBadge } from "../components/location-attention"
import { attentionRank, framesInLocation, indexingLocationIds, locationAttention, type LocationStatus, removeLocation, retireLocation, reviewRetire, ROLE_COPY, ROLE_ORDER, sessionsInLocation, updateLocation, validateLocation } from "../lib/locations"

const HREF = "/settings/locations"

/** A count for a variant message: `count` selects the plural form, `n` is the formatted number. */
function count(message: (inputs: { count: number; n: string }) => string, value: number): string {
  return message({ count: value, n: formatCount(value) })
}

/** One location as the table shows it, read once per render. */
interface LocationRow extends LocationStatus {
  frames: number
  footprint: number | null
  free: number | null
}

function EditLocationDialog({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const m = useMessages()
  const [name, setName] = useState("")
  const [role, setRole] = useState<LocationRole>("captures")
  const [touched, setTouched] = useState(false)
  const [shownFor, setShownFor] = useState<Location | null>(null)
  // Each opening starts from the location as saved.
  if (location !== shownFor) {
    setShownFor(location)
    if (location) {
      setName(location.displayName)
      setRole(location.role)
      setTouched(false)
    }
  }
  const errors = location ? validateLocation(store.getState().catalog, { path: location.path, displayName: name, role }, location.id) : {}
  const label = m.settings_save()
  const confirm: Action = {
    id: "save-location",
    label,
    kind: "primary",
    unavailable: blockedByErrors(label, { displayName: errors.displayName }),
    run: () => (location ? updateLocation(location.id, { displayName: name, role }, HREF) : undefined),
  }
  return (
    <FormDialog open={location !== null} onOpenChange={(open) => !open && onClose()} title={m.settings_edit_title({ name: location?.displayName ?? "" })} confirm={confirm}>
      {location ? <PathText path={location.path} /> : null}
      <TextField
        label={m.location_display_name()}
        value={name}
        onChange={(value) => {
          setName(value)
          setTouched(true)
        }}
        error={touched ? errors.displayName : undefined}
        autoFocus
      />
      <SelectField label={m.location_role()} value={role} options={ROLE_ORDER.map((r) => ({ value: r, label: ROLE_COPY[r].title }))} onChange={setRole} />
    </FormDialog>
  )
}

/** A location's facts, under its row's disclosure. */
function LocationDetails({ location }: { location: Location }) {
  const m = useMessages()
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const volume = disk.volumes[location.volumeId]
  return (
    <KeyValueList
      columns={2}
      items={[
        { label: m.location_path(), value: location.path, mono: true },
        { label: m.location_volume(), value: volume ? m.location_volume_identity({ name: volume.name, uuid: volume.volumeUuid }) : m.location_volume_unknown() },
        { label: m.location_availability(), value: <StatusBadge kind="availability" value={locationAvailability(disk, location)} /> },
        { label: m.location_access(), value: <StatusBadge kind="access" value={location.access} /> },
        { label: m.location_scan_scope(), value: <StatusBadge kind="scanScope" value={location.scanScope} /> },
        { label: m.location_registered(), value: formatDateTime(location.registeredAt) },
        { label: m.location_last_indexed(), value: location.lastIndexedAt ? formatDateTime(location.lastIndexedAt) : m.location_not_indexed_yet() },
        { label: m.nav_sessions(), value: count(m.location_sessions_count, sessionsInLocation(catalog, location.id)) },
        { label: m.session_os_trash(), value: volume ? <StatusBadge kind="trash" value={volume.trash} /> : m.status_unknown() },
        { label: m.location_link_symlinks(), value: volume ? (volume.symlinks ? m.location_symlinks_supported() : m.location_links_none()) : m.status_unknown() },
        ...(location.unreadablePaths.length > 0 ? [{ label: m.location_unreadable_folders(), value: location.unreadablePaths.join(", "), mono: true }] : []),
        ...(location.retiredAt ? [{ label: m.location_retired_on(), value: formatDateTime(location.retiredAt) }] : []),
      ]}
    />
  )
}

export function LocationsPage() {
  const m = useMessages()
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const operations = useStore((s) => s.operations)
  const settings = useStore((s) => s.settings)
  const [adding, setAdding] = useState<{ role: LocationRole | null } | null>(null)
  // The palette command and the checklist link set ?add= while this page may already be open; the route stays mounted, so follow the search.
  const [addSeen, setAddSeen] = useState<string | undefined>(undefined)
  if (search.add !== addSeen) {
    setAddSeen(search.add)
    if (search.add && (ROLE_ORDER as string[]).includes(search.add)) setAdding({ role: search.add as LocationRole })
  }
  const [editing, setEditing] = useState<Location | null>(null)
  const actions = useLocationActions({ href: HREF, notify: "runner" })
  const { save, indicator } = useSaveState()

  const indexingIds = indexingLocationIds(operations)
  const rows: LocationRow[] = Object.values(catalog.locations).map((location) => {
    const use = location.retiredAt ? null : locationDiskUse(disk, location)
    return {
      location,
      availability: locationAvailability(disk, location),
      frames: framesInLocation(catalog, location.id),
      indexing: indexingIds.has(location.id),
      footprint: use?.footprintBytes ?? null,
      free: use?.freeBytes ?? null,
    }
  })
  const archives = rows.filter((r) => r.location.role === "archive" && !r.location.retiredAt).map((r) => r.location)
  const defaultArchiveId = defaultArchiveLocation({ catalog, settings })?.id ?? null
  const offline = rows.filter((r) => r.availability === "offline")

  const makeDefault = (location: Location) => save(() => setDefaultArchiveLocation(location.id))

  function rescan(row: LocationRow): Action {
    const never = row.location.scanScope === "never"
    const label = never ? m.location_index_now() : m.location_rescan()
    const reason = row.indexing ? m.location_indexing() : row.availability !== "online" ? m.status_offline() : null
    return { id: "rescan", label, icon: never ? Play : RotateCw, unavailable: reason ? { action: label, reason, blockers: [] } : undefined, run: () => actions.retry(row.location) }
  }

  function retire(row: LocationRow): Action {
    const label = m.location_retire()
    const review = row.frames > 0 ? reviewRetire(store.getState(), row.location.id) : null
    const none = (list: string[]) => (list.length ? list.join(", ") : m.settings_none())
    return {
      id: "retire",
      label,
      opensDialog: true,
      unavailable: review ? undefined : { action: label, reason: m.location_remap_no_frames({ name: row.location.displayName }), blockers: [] },
      confirm: review
        ? {
            title: m.location_retire_title({ name: review.displayName }),
            summary: [
              count(m.location_copies_read_retired, review.frames),
              `${m.nav_sessions()}: ${none(review.sessions)}`,
              `${m.common_runs()}: ${none(review.runs)}`,
              `${m.nav_projects()}: ${none(review.projects)}`,
              `${m.status_role_results()}: ${none(review.results)}`,
              m.location_no_file_changes(),
            ].join(" · "),
            confirm: { label, kind: "destructive" },
          }
        : undefined,
      run: () => (review ? retireLocation(review, HREF) : undefined),
    }
  }

  function remove(row: LocationRow): Action {
    const label = m.settings_remove()
    return {
      id: "remove",
      label,
      kind: "destructive",
      opensDialog: true,
      unavailable: row.frames > 0 ? { action: label, reason: count(m.location_frames, row.frames), blockers: [] } : undefined,
      confirm: { title: m.settings_remove_title({ name: row.location.displayName }), summary: m.location_remove_change({ path: row.location.path }), confirm: { label: m.location_remove_confirm(), kind: "destructive" } },
      run: () => removeLocation(row.location.id, HREF),
    }
  }

  /** Every action a location offers, for its ⋯ menu and its right-click menu. A retired location is never reselected, rescanned or remapped (LIB-FR-15). */
  function rowActions(row: LocationRow): MenuItem[] {
    if (row.availability === "retired") return []
    const { location } = row
    const noFrames = { action: m.location_locate_or_remap(), reason: m.location_remap_no_frames({ name: location.displayName }), blockers: [] }
    return [
      rescan(row),
      ...(location.role === "archive" && defaultArchiveId !== location.id ? [{ id: "make-default", label: m.settings_make_default(), run: () => makeDefault(location) }] : []),
      { id: "edit", label: m.settings_edit(), opensDialog: true, run: () => setEditing(location) },
      { id: "locate", label: m.location_locate_or_remap(), opensDialog: true, unavailable: row.frames === 0 ? noFrames : undefined, run: () => actions.locate(location) },
      { id: "choose-again", label: m.location_choose_folder_again(), opensDialog: true, run: () => actions.chooseAgain(location) },
      { separator: true },
      retire(row),
      remove(row),
    ]
  }

  const columns: Column<LocationRow>[] = [
    { id: "name", header: m.location_col_name(), rowHeader: true, truncate: true, sortValue: (r) => r.location.displayName, cell: (r) => r.location.displayName },
    { id: "role", header: m.location_role(), sortValue: (r) => ROLE_ORDER.indexOf(r.location.role), cell: (r) => <StatusBadge kind="role" value={r.location.role} /> },
    { id: "state", header: m.location_col_state(), sortValue: (r) => attentionRank(locationAttention(r)), cell: (r) => <LocationAttentionBadge state={locationAttention(r)} /> },
    { id: "indexed", header: m.location_col_indexed(), truncate: true, sortValue: (r) => r.location.lastIndexedAt, cell: (r) => (r.location.lastIndexedAt ? formatDateTime(r.location.lastIndexedAt) : m.location_not_indexed_yet()) },
    { id: "frames", header: m.location_col_frames(), align: "right", hideable: true, defaultHidden: true, sortValue: (r) => r.frames, cell: (r) => formatCount(r.frames) },
    { id: "size", header: m.location_col_size(), align: "right", hideable: true, defaultHidden: true, sortValue: (r) => r.footprint, cell: (r) => (r.footprint === null ? "–" : formatBytes(r.footprint)) },
    { id: "free", header: m.location_col_free(), align: "right", hideable: true, defaultHidden: true, sortValue: (r) => r.free, cell: (r) => (r.free === null ? "–" : formatBytes(r.free)) },
  ]

  const notice: PageNotice | null =
    offline.length === 0
      ? null
      : {
          tone: "offline",
          title: offline.length === 1 ? m.location_volume_not_mounted({ name: disk.volumes[offline[0]!.location.volumeId]?.name ?? offline[0]!.location.displayName }) : m.location_offline_count({ count: offline.length, n: formatCount(offline.length) }),
        }

  const add: Action = { id: "add-location", label: m.storage_add_location(), icon: FolderPlus, opensDialog: true, run: () => setAdding({ role: null }) }

  function closeAdding() {
    setAdding(null)
    if (search.add) void navigate({ to: HREF, search: (prev: Record<string, string | undefined>) => ({ ...prev, add: undefined }), replace: true })
  }

  return (
    <SettingsPage title={m.common_locations()} notice={notice}>
      <ListSection<LocationRow>
        title={m.location_list_title()}
        add={add}
        table={{
          label: m.common_locations(),
          rows,
          columns,
          columnsId: "settings.locations",
          getRowId: (r) => r.location.id,
          rowLabel: (r) => r.location.displayName,
          initialSort: { columnId: "role", direction: "asc" },
          stickyFirstColumn: true,
          activeRowId: search.locationId ?? null,
          empty: <EmptyState icon={FolderPlus} title={m.storage_no_locations()} action={<ActionButton action={add} />} />,
          primaryRowAction: (r) => (r.availability === "retired" ? null : rescan(r)),
          rowActions,
          expand: { render: (r) => <LocationDetails location={r.location} />, defaultExpanded: search.locationId ? [search.locationId] : [] },
        }}
      />

      {archives.length > 0 ? (
        <SettingsSection title={m.location_default_archive()} actions={indicator}>
          <SelectField
            label={m.settings_default()}
            value={defaultArchiveId ?? "none"}
            options={[...(defaultArchiveId ? [] : [{ value: "none", label: m.settings_none(), disabled: true }]), ...archives.map((l) => ({ value: l.id, label: l.displayName }))]}
            onChange={(id) => {
              const location = archives.find((l) => l.id === id)
              if (location && location.id !== defaultArchiveId) makeDefault(location)
            }}
          />
        </SettingsSection>
      ) : null}

      <AddLocationFlow
        role={adding?.role ?? null}
        open={adding !== null}
        onClose={closeAdding}
        onAdded={(id) => void navigate({ to: HREF, search: (prev: Record<string, string | undefined>) => ({ ...prev, add: undefined, locationId: id }), replace: true })}
        href={HREF}
      />
      <EditLocationDialog location={editing} onClose={() => setEditing(null)} />
      <DuplicatesReview
        open={search.duplicates === "review"}
        onClose={() => void navigate({ to: HREF, search: (prev: Record<string, string | undefined>) => ({ ...prev, duplicates: undefined }), replace: true })}
      />
      {actions.dialogs}
    </SettingsPage>
  )
}
