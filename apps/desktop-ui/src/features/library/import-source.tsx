/**
 * Import's Source step (STO-IMP-FR-01, STO-IMP-FR-10): Removable devices,
 * Saved sources and Choose folder…, side by side.
 *
 * - Removable devices are the library's list (`import_devices_list`),
 *   re-read on each `import_devices` event, so a card appears once the OS
 *   mounts it and leaves the list once it is ejected, with no folder pick.
 *   Each reads as its recognised capture layout with a note naming every
 *   marker found (STO-IMP-AC-14), or "USB device" when no rule recognised
 *   one (`layout: null`). Listing writes nothing to the device.
 * - Saved sources keep their row while their folder is absent: an unmounted
 *   card's source reads Offline, never vanishes (STO-IMP-AC-15).
 * - Choose folder… asks the OS for a folder; it can be saved as a source.
 *
 * A source's path goes back to the library exactly as it came, bytes and
 * encoding included: the UI never rebuilds a path from its display text.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderOpen } from "lucide-react"
import { useState } from "react"
import { IMPORT_DEVICES_EVENT, type ImportSourceSpec, library, type NativePathWire, type RemovableDevice, type SavedSourceView } from "@/api/ipc"
import { useRefreshOnEvent } from "@/api/events"
import { libraryKey } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { ActionBar, ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Column } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { TextField } from "@/components/app/fields"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { formatDate } from "@/lib/format"
import { readError } from "./parts"
import { devicesQuery, sourcesQuery } from "./queries"
import { deviceKind, deviceNote } from "./words"

/** The source the user picked, with what names it on screen. */
export interface ChosenSource {
  spec: ImportSourceSpec
  label: string
  /** Offline saved sources stay listed and cannot preview until their folder is back. */
  offline: boolean
}

export function folderSource(path: NativePathWire): ChosenSource {
  return { spec: { kind: "folder", path }, label: path.display, offline: false }
}

const sameSpec = (a: ImportSourceSpec | undefined, b: ImportSourceSpec) =>
  a !== undefined && a.kind === b.kind && (a.kind === "saved" ? a.id === (b as { id: string }).id : samePath(a.path, (b as { path: NativePathWire }).path))

function samePath(a: NativePathWire, b: NativePathWire): boolean {
  return a.encoding === b.encoding && a.payload.length === b.payload.length && a.payload.every((byte, i) => byte === b.payload[i])
}

export function SourceStep({ chosen, onChoose, editable }: { chosen: ChosenSource | null; onChoose: (source: ChosenSource) => void; editable: boolean }) {
  const m = useMessages()
  const devices = useQuery(devicesQuery())
  const sources = useQuery(sourcesQuery())
  useRefreshOnEvent(IMPORT_DEVICES_EVENT, libraryKey("importDevicesList"))
  const picked = (spec: ImportSourceSpec) => sameSpec(chosen?.spec, spec)
  const deviceColumns: Column<RemovableDevice>[] = [
    { id: "name", header: m.import_column_source(), rowHeader: true, truncate: true, sortValue: (d) => d.name, cell: (d) => d.name },
    { id: "kind", header: m.import_device_reads_as(), sortValue: (d) => deviceKind(m, d), cell: (d) => deviceKind(m, d) },
    { id: "note", header: m.import_device_note(), truncate: true, static: true, cell: (d) => deviceNote(m, d) ?? "–" },
  ]
  const sourceColumns: Column<SavedSourceView>[] = [
    { id: "name", header: m.import_source_name(), rowHeader: true, truncate: true, sortValue: (s) => s.name, cell: (s) => s.name },
    { id: "path", header: m.import_column_folder(), truncate: true, sortValue: (s) => s.path.display, cell: (s) => s.path.display },
    {
      id: "availability",
      header: m.session_column_availability(),
      sortValue: (s) => s.availability,
      cell: (s) => <StatusBadge kind="availability" value={s.availability === "available" ? "online" : s.availability === "missing" ? "absent" : s.availability === "offline" ? "offline" : "unreadable"} />,
    },
    { id: "last", header: m.import_column_last(), sortValue: (s) => s.lastImportedAt, cell: (s) => (s.lastImportedAt ? m.import_last_import({ date: formatDate(s.lastImportedAt) }) : m.import_never_imported()) },
  ]
  return (
    <>
      <Section title={m.import_removable_devices()}>
        <BoxTable
          label={m.import_removable_devices()}
          rows={devices.data ?? []}
          columns={deviceColumns}
          getRowId={(d) => d.root.display}
          rowLabel={(d) => d.name}
          primaryRowAction={(d) => {
            const source: ChosenSource = { spec: { kind: "folder", path: d.root }, label: d.name, offline: false }
            return picked(source.spec) || !editable ? null : { id: "use", label: m.import_use_source(), run: () => onChoose(source) }
          }}
          loading={devices.isPending}
          error={devices.error ? { message: readError(m, devices.error), onRetry: () => void devices.refetch() } : undefined}
          empty={m.import_none_connected()}
        />
      </Section>
      <Section title={m.import_saved_sources()}>
        <BoxTable
          label={m.import_saved_sources()}
          rows={sources.data ?? []}
          columns={sourceColumns}
          getRowId={(s) => s.id}
          rowLabel={(s) => s.name}
          primaryRowAction={(s) => {
            const source: ChosenSource = { spec: { kind: "saved", id: s.id }, label: s.name, offline: s.availability !== "available" }
            return picked(source.spec) || !editable ? null : { id: "use", label: m.import_use_source(), run: () => onChoose(source) }
          }}
          loading={sources.isPending}
          error={sources.error ? { message: readError(m, sources.error), onRetry: () => void sources.refetch() } : undefined}
          empty={m.import_no_saved_sources()}
        />
      </Section>
      <Section title={m.import_choose_folder_title()} description={m.import_choose_folder_description()}>
        <ChooseFolder chosen={chosen} onChoose={onChoose} editable={editable} />
      </Section>
    </>
  )
}

function ChooseFolder({ chosen, onChoose, editable }: { chosen: ChosenSource | null; onChoose: (source: ChosenSource) => void; editable: boolean }) {
  const m = useMessages()
  const client = useQueryClient()
  const [name, setName] = useState("")
  const folder = chosen?.spec.kind === "folder" ? chosen.spec.path : null
  return (
    <>
      <ActionBar
        actions={[
          {
            id: "choose-folder",
            label: m.import_choose_a_folder(),
            icon: FolderOpen,
            opensDialog: true,
            run: async () => {
              const result = await library.libraryPickFolder()
              if (result.ok && result.data) onChoose(folderSource(result.data))
              return result
            },
          },
        ]}
      />
      {folder ? (
        <>
          <KeyValueList items={[{ label: m.import_chosen_folder(), value: folder.display }]} />
          <TextField
            label={m.import_source_name()}
            value={name}
            onChange={setName}
            readOnly={!editable}
            action={
              <ActionButton
                action={{
                  id: "save-source",
                  label: m.import_save_source(),
                  unavailable: name.trim() === "" ? { action: m.actions_blocked({ action: m.import_save_source() }), reason: m.import_name_needed(), blockers: [] } : undefined,
                  run: async () => {
                    const result = await library.importSourceSave(name.trim(), folder)
                    if (result.ok) {
                      await client.invalidateQueries({ queryKey: libraryKey("importSourcesList") })
                      onChoose({ spec: { kind: "saved", id: result.data.id }, label: result.data.name, offline: false })
                    }
                    return result
                  },
                }}
              />
            }
          />
        </>
      ) : null}
    </>
  )
}
