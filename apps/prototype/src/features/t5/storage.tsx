/**
 * Storage overview (spec 071 STO-FR-11, STO-AC-12, D16): locations and
 * availability, View footprints, content-identity duplicate candidates and
 * transfers, each shown separately. Candidate display never authorizes removal.
 */
import { Link } from "@tanstack/react-router"
import { ArrowRightLeft, Copy, FolderOpen, HardDrive } from "lucide-react"
import { useMemo } from "react"
import { PathText } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { fileKey, filesUnder, freeBytes, volumeForPath } from "@/domain/disk"
import { locationAvailability, viewStatus } from "@/domain/derive"
import type { Asset, Location, Operation, Preparation, View } from "@/domain/types"
import { formatBytes, formatCount, formatDateTime, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { latestPreparation, preparedEntries } from "./lib/files"
import { PHASE_LABEL, type TransferPayload } from "./lib/transfer"

interface FootprintRow {
  view: View
  preparation: Preparation
  entries: number
  mode: string
  entryBytes: number
  outputBytes: number
  online: boolean
}

export function StoragePage() {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const operations = useStore((s) => s.operations)
  const locations = Object.values(catalog.locations).sort((a, b) => a.displayName.localeCompare(b.displayName))

  const footprints = useMemo<FootprintRow[]>(() => {
    const rows: FootprintRow[] = []
    for (const view of Object.values(catalog.views)) {
      const preparation = latestPreparation(catalog, view.id)
      if (!preparation) continue
      const volumeId = volumeForPath(disk, preparation.viewPath)
      const online = Boolean(volumeId && disk.volumes[volumeId]?.mounted)
      const entries = online ? preparedEntries(disk, catalog, preparation) : []
      const kinds = [...new Set(entries.map((e) => e.kind))]
      rows.push({
        view,
        preparation,
        entries: online ? entries.length : preparation.entryCount,
        mode:
          preparation.mode === "direct-source"
            ? "Direct-source"
            : preparation.mode === "linked"
              ? `Linked View (${kinds.join(", ") || preparation.linkType || "links"})`
              : preparation.mode === "copy"
                ? "Copy"
                : "Clone",
        entryBytes: entries.reduce((sum, e) => sum + (e.kind === "copy" ? e.file.sizeBytes : 0), 0),
        outputBytes: online ? filesUnder(disk, preparation.outputPath).reduce((sum, f) => sum + f.sizeBytes, 0) : 0,
        online,
      })
    }
    return rows.sort((a, b) => a.view.name.localeCompare(b.view.name))
  }, [disk, catalog])

  const duplicates = useMemo(
    () =>
      Object.values(catalog.assets).filter(
        (a) => a.copies.filter((c) => c.presence !== "absent" && (!disk.volumes[c.volumeId]?.mounted || disk.files[fileKey(c.volumeId, c.path)])).length > 1,
      ),
    [catalog.assets, disk],
  )
  const transfers = Object.values(operations)
    .filter((op) => op.kind === "archive" || op.kind === "filing")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const locationColumns: Column<Location>[] = [
    { id: "name", header: "Location", rowHeader: true, sortValue: (l) => l.displayName, cell: (l) => l.displayName },
    { id: "role", header: "Role", cell: (l) => <StatusBadge kind="role" value={l.role} /> },
    { id: "path", header: "Path", cell: (l) => <PathText path={l.path} truncate className="max-w-64" /> },
    {
      id: "volume",
      header: "Volume and identity",
      cell: (l) => {
        const v = disk.volumes[l.volumeId]
        return (
          <span className="text-xs">
            {v?.name ?? "Unknown"} <span className="font-mono text-muted-foreground">{v?.volumeUuid}</span>
          </span>
        )
      },
    },
    { id: "availability", header: "Availability", cell: (l) => <StatusBadge kind="availability" value={locationAvailability(disk, l)} /> },
    { id: "trash", header: "OS Trash", cell: (l) => <StatusBadge kind="trash" value={disk.volumes[l.volumeId]?.trash ?? "unsupported"} /> },
    {
      id: "free",
      header: "Free space",
      align: "right",
      cell: (l) => (disk.volumes[l.volumeId]?.mounted ? formatBytes(freeBytes(disk, l.volumeId)) : <UnknownValue label="Unknown" reason="The volume is offline; free space is read when it is connected." />),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (l) =>
        locationAvailability(disk, l) === "offline" ? (
          <Button size="xs" variant="outline" render={<Link to="/settings/locations" search={{ locationId: l.id, return: "/storage" }} />}>
            Locate or remap {l.displayName}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ]

  const footprintColumns: Column<FootprintRow>[] = [
    { id: "view", header: "View", rowHeader: true, sortValue: (r) => r.view.name, cell: (r) => <Link to="/views/$viewId/results" params={{ viewId: r.view.id }} className="text-primary hover:underline">{r.view.name}</Link> },
    { id: "status", header: "Status", cell: (r) => <StatusBadge kind="view" value={viewStatus(catalog, r.view)} /> },
    { id: "folder", header: "View folder", cell: (r) => <PathText path={r.preparation.viewPath} truncate className="max-w-64" /> },
    { id: "mode", header: "Entries and mode", cell: (r) => <span className="text-xs">{plural(r.entries, "entry", "entries")} · {r.mode}</span> },
    {
      id: "footprint",
      header: "Footprint",
      align: "right",
      cell: (r) =>
        r.online ? (
          <span className="text-xs">
            {formatBytes(r.entryBytes)} entries · {formatBytes(r.outputBytes)} output
          </span>
        ) : (
          <StatusBadge kind="availability" value="offline" />
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (r) => (
        <span className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" render={<Link to="/views/$viewId/cleanup" params={{ viewId: r.view.id }} />}>
            Clean up {r.view.name}
          </Button>
          <Button size="xs" variant="outline" render={<Link to="/storage/archive" search={{ viewId: r.view.id }} />}>
            Archive sessions of {r.view.name}
          </Button>
        </span>
      ),
    },
  ]

  const duplicateColumns: Column<Asset>[] = [
    { id: "file", header: "Frame", rowHeader: true, sortValue: (a) => a.fileName, cell: (a) => <span className="font-mono text-xs">{a.fileName}</span> },
    { id: "sha", header: "Content identity", cell: (a) => <span className="font-mono text-xs">{a.sha256.slice(0, 12)}…</span> },
    {
      id: "copies",
      header: "Copies",
      cell: (a) => (
        <ul className="space-y-0.5 text-xs">
          {a.copies
            .filter((c) => c.presence !== "absent")
            .map((c) => (
              <li key={`${c.volumeId}:${c.path}`}>
                {catalog.locations[c.locationId]?.displayName ?? "Unregistered"}: <span className="font-mono">{c.path}</span>
                {disk.volumes[c.volumeId]?.mounted ? "" : " (offline)"}
              </li>
            ))}
        </ul>
      ),
    },
  ]

  const transferColumns: Column<Operation>[] = [
    { id: "title", header: "Transfer", rowHeader: true, cell: (op) => <Link to="/storage/transfers/$operationId" params={{ operationId: op.id }} className="text-primary hover:underline">{op.title}</Link> },
    { id: "kind", header: "Kind", cell: (op) => (op.kind === "archive" ? "Verified archive" : "Reviewed filing") },
    { id: "status", header: "Status", cell: (op) => <StatusBadge kind="operation" value={op.status} /> },
    {
      id: "phases",
      header: "Phases",
      cell: (op) => {
        const records = (op.payload as unknown as TransferPayload).records ?? []
        const counts = new Map<string, number>()
        for (const r of records) {
          const label = r.blocked ? "Blocked" : PHASE_LABEL[r.phase]
          counts.set(label, (counts.get(label) ?? 0) + 1)
        }
        return <span className="text-xs tabular-nums">{[...counts.entries()].map(([label, n]) => `${formatCount(n)} ${label.toLowerCase()}`).join(" · ")}</span>
      },
    },
    { id: "started", header: "Started", sortValue: (op) => op.createdAt, cell: (op) => <span className="text-xs">{formatDateTime(op.createdAt)}</span> },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Storage"
        description="Where your files are, what each prepared View occupies, possible duplicates, and transfers. Nothing here removes files."
        actions={
          <>
            <Button variant="outline" render={<Link to="/storage/filing" />}>
              File into library
            </Button>
            <Button render={<Link to="/storage/archive" />}>Archive sessions</Button>
          </>
        }
      />
      <PageBody>
        <Section id="t5-locations" title="Locations" description="Registered locations and their availability right now. Offline locations keep their last-observed metadata.">
          <DataTable
            label="Registered locations"
            rows={locations}
            columns={locationColumns}
            getRowId={(l) => l.id}
            scroll="none"
            empty={
              <EmptyState icon={HardDrive} title="No locations registered" description="Add a capture location to start indexing." action={<Button render={<Link to="/settings/locations" />}>Add a location</Button>} />
            }
          />
        </Section>
        <Section id="t5-footprints" title="View footprints" description="Prepared View folders: entries, mode and output size. Link entries hold no image bytes.">
          <DataTable
            label="View footprints"
            rows={footprints}
            columns={footprintColumns}
            getRowId={(r) => r.view.id}
            scroll="none"
            empty={<EmptyState icon={FolderOpen} title="No prepared Views yet" description="A View gets a folder when you prepare it for an application." action={<Button render={<Link to="/views" />}>Open Views</Button>} />}
          />
        </Section>
        <Section
          id="t5-duplicates"
          title="Duplicate candidates"
          description="Indexed frames with more than one copy, by content identity. Shown for review only: removing duplicates is not part of Storage, and every copy stays registered and protected."
        >
          <DataTable
            label="Duplicate candidates"
            rows={duplicates}
            columns={duplicateColumns}
            getRowId={(a) => a.id}
            empty={<EmptyState icon={Copy} title="No duplicate candidates" description="Every indexed frame has one present copy." action={<Button variant="outline" render={<Link to="/sessions" />}>Open Sessions</Button>} />}
          />
        </Section>
        <Section id="t5-transfers" title="Transfers" description="Verified archive and reviewed filing operations with their recorded phases.">
          <DataTable
            label="Transfers"
            rows={transfers}
            columns={transferColumns}
            getRowId={(op) => op.id}
            scroll="none"
            empty={<EmptyState icon={ArrowRightLeft} title="No transfers yet" description="Archive or file sessions to see their verified phases here." action={<Button render={<Link to="/storage/archive" />}>Archive sessions</Button>} />}
          />
        </Section>
      </PageBody>
    </div>
  )
}
