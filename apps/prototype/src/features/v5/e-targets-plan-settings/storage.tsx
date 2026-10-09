/**
 * S15 Storage (slice E; STO-FR-11, STO-FR-12, D16), carried over from v4's T5
 * storage to the v5 model. Four separate read-only sections: location
 * availability; run and group footprints (each prepared folder and its
 * Results folder); duplicate candidates by content identity, counting live
 * copies only (absent, retired and Trashed copies are left out); and
 * transfers (import, archive and OS Trash operations). Nothing here moves
 * or removes a file: duplicate copies go to the Trash only from a Done
 * Project's Done / Archive sheet (D-W74).
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
import { filesUnder, freeBytes, volumeForPath } from "@/domain/disk"
import { groupStepLink, runStepLink } from "@/domain/derive"
import { MODE_LABEL } from "@/domain/labels"
import { copyAvailability, locationAvailability } from "@/domain/library"
import type { Asset, AssetCopy, Catalog, Disk, Location, Operation, Preparation } from "@/domain/types"
import { formatBytes, formatDateTime, plural } from "@/lib/format"
import { useStore } from "@/store/core"

interface FootprintRow {
  preparation: Preparation
  name: string
  link: ReturnType<typeof runStepLink> | null
  project: string
  online: boolean
  folderBytes: number
  resultsBytes: number
}

function footprints(catalog: Catalog, disk: Disk): FootprintRow[] {
  return Object.values(catalog.preparations)
    .map((p): FootprintRow => {
      const run = p.runId ? catalog.runs[p.runId] : undefined
      const group = p.groupId ? catalog.runGroups[p.groupId] : undefined
      const volumeId = volumeForPath(disk, p.folderPath)
      const online = Boolean(volumeId && disk.volumes[volumeId]?.mounted)
      const link = run ? runStepLink(run, "prepare") : group ? groupStepLink(group, "prepare") : null
      return {
        preparation: p,
        name: run ? `${run.name}${run.trashedAt ? " (in Trash)" : ""}` : (group?.name ?? "Unknown run"),
        link,
        project: catalog.projects[run?.projectId ?? group?.projectId ?? ""]?.name ?? "–",
        online,
        resultsBytes: online ? filesUnder(disk, p.resultsPath).reduce((sum, f) => sum + f.sizeBytes, 0) : 0,
        folderBytes: online ? filesUnder(disk, p.folderPath).reduce((sum, f) => sum + (f.linkTarget ? 0 : f.sizeBytes), 0) : 0,
      }
    })
    .sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name) || a.preparation.prepRevision - b.preparation.prepRevision)
}

/** Copies that hold the asset now: not absent, not on a retired location. */
function liveCopies(catalog: Catalog, asset: Asset): AssetCopy[] {
  return asset.copies.filter((c) => c.presence !== "absent" && !catalog.locations[c.locationId]?.retiredAt)
}

export function StoragePage() {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const operations = useStore((s) => s.operations)
  const locations = Object.values(catalog.locations).sort((a, b) => a.displayName.localeCompare(b.displayName))
  const prepared = useMemo(() => footprints(catalog, disk), [catalog, disk])
  const duplicates = useMemo(() => Object.values(catalog.assets).filter((a) => !a.trashed && liveCopies(catalog, a).length > 1), [catalog])
  const duplicateBytes = duplicates.reduce((sum, a) => sum + a.sizeBytes * (liveCopies(catalog, a).length - 1), 0)
  const transfers = Object.values(operations)
    .filter((op) => op.kind === "import" || op.kind === "archive" || op.kind === "trash")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const locationColumns: Column<Location>[] = [
    {
      id: "name",
      header: "Location",
      rowHeader: true,
      sortValue: (l) => l.displayName,
      cell: (l) => (
        <span className="block space-y-0.5">
          <span className="block">{l.displayName}</span>
          <PathText path={l.path} truncate className="max-w-56 text-xs text-muted-foreground" />
        </span>
      ),
    },
    { id: "role", header: "Role", cell: (l) => <StatusBadge kind="role" value={l.role} /> },
    {
      id: "volume",
      header: "Volume",
      cell: (l) => {
        const v = disk.volumes[l.volumeId]
        return (
          <span className="block text-xs">
            <span className="block">
              {v?.name ?? "Unknown"}
              {v?.network ? " · network share" : ""}
            </span>
            <span className="block font-mono text-muted-foreground">{v?.volumeUuid}</span>
          </span>
        )
      },
    },
    { id: "availability", header: "Availability", sortValue: (l) => locationAvailability(disk, l), cell: (l) => <StatusBadge kind="availability" value={locationAvailability(disk, l)} /> },
    { id: "trash", header: "OS Trash", cell: (l) => (disk.volumes[l.volumeId]?.trash === "supported" ? <span className="text-xs text-muted-foreground">Supported</span> : <StatusBadge kind="trash" value="unsupported" />) },
    {
      id: "free",
      header: "Free space",
      align: "right",
      cell: (l) => (disk.volumes[l.volumeId]?.mounted ? formatBytes(freeBytes(disk, l.volumeId)) : <UnknownValue label="Unknown" reason="The volume is offline; free space is read when it is connected." />),
    },
    {
      id: "open",
      header: "Resolve",
      cell: (l) =>
        locationAvailability(disk, l) === "offline" ? (
          <Button size="xs" variant="outline" render={<Link to="/settings/locations" search={{ return: "/storage" }} />}>
            Locate or remap<span className="sr-only"> {l.displayName}</span>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">–</span>
        ),
    },
  ]

  const footprintColumns: Column<FootprintRow>[] = [
    {
      id: "run",
      header: "Run or group",
      rowHeader: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <span className="block space-y-0.5">
          {r.link ? (
            <Link to={r.link.to as never} params={r.link.params as never} className="block text-link hover:underline">
              {r.name}
            </Link>
          ) : (
            <span className="block">{r.name}</span>
          )}
          <span className="block text-xs text-muted-foreground">{r.project}</span>
        </span>
      ),
    },
    {
      id: "folder",
      header: "Prepared folder",
      cell: (r) => (
        <span className="block space-y-0.5">
          <PathText path={r.preparation.folderPath} truncate className="max-w-72" />
          <span className="block text-xs text-muted-foreground">
            {r.preparation.prepRevision > 1 ? `(rev ${r.preparation.prepRevision}) · ` : ""}
            {plural(r.preparation.entryCount, "entry", "entries")} · {MODE_LABEL[r.preparation.mode]}
            {r.preparation.linkType ? ` (${r.preparation.linkType}s)` : ""}
          </span>
        </span>
      ),
    },
    { id: "state", header: "State", cell: (r) => <StatusBadge kind="preparation" value={r.preparation.state} /> },
    {
      id: "footprint",
      header: "Footprint",
      align: "right",
      sortValue: (r) => (r.online ? r.folderBytes + r.resultsBytes : null),
      cell: (r) =>
        r.online ? (
          <span className="block text-xs tabular-nums">
            <span className="block">{formatBytes(r.folderBytes)} prepared</span>
            <span className="block text-muted-foreground">{formatBytes(r.resultsBytes)} Results</span>
          </span>
        ) : (
          <StatusBadge kind="availability" value="offline" />
        ),
    },
  ]

  const duplicateColumns: Column<Asset>[] = [
    { id: "file", header: "Frame", rowHeader: true, sortValue: (a) => a.fileName, cell: (a) => <span className="font-mono text-xs">{a.fileName}</span> },
    { id: "sha", header: "Content identity", cell: (a) => <span className="font-mono text-xs">{a.sha256.slice(0, 12)}…</span> },
    {
      id: "copies",
      header: "Live copies",
      cell: (a) => (
        <ul className="space-y-0.5 text-xs">
          {liveCopies(catalog, a).map((c) => (
            <li key={`${c.volumeId}:${c.path}`}>
              {catalog.locations[c.locationId]?.displayName ?? "Unregistered"}: <span className="font-mono">{c.path}</span>
              {copyAvailability(disk, catalog, c) === "available" ? "" : " (offline)"}
            </li>
          ))}
        </ul>
      ),
    },
    { id: "size", header: "Extra bytes", align: "right", sortValue: (a) => a.sizeBytes * (liveCopies(catalog, a).length - 1), cell: (a) => formatBytes(a.sizeBytes * (liveCopies(catalog, a).length - 1)) },
  ]

  const transferColumns: Column<Operation>[] = [
    { id: "title", header: "Transfer", rowHeader: true, cell: (op) => <span>{op.title}</span> },
    { id: "kind", header: "Kind", cell: (op) => (op.kind === "import" ? "Import" : op.kind === "archive" ? "Archive" : "Move to OS Trash") },
    { id: "status", header: "Status", cell: (op) => <StatusBadge kind="operation" value={op.status} /> },
    { id: "summary", header: "Outcome", cell: (op) => <span className="text-xs text-muted-foreground">{op.summary ?? `${op.progress.done} of ${plural(op.progress.total, op.progress.unit.replace(/s$/, ""))}`}</span> },
    { id: "started", header: "Started", sortValue: (op) => op.createdAt, cell: (op) => <span className="text-xs">{formatDateTime(op.createdAt)}</span> },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Storage" description="Where your files are, what each prepared run occupies, duplicate copies, and transfers. Read-only: nothing here moves or removes a file." />
      <PageBody>
        <Section id="sto-locations" title="Location availability" description="Registered locations right now. Offline locations keep their last-observed metadata.">
          <DataTable
            label="Registered locations"
            rows={locations}
            columns={locationColumns}
            getRowId={(l) => l.id}
            scroll="none"
            stickyFirstColumn
            empty={<EmptyState icon={HardDrive} title="No locations registered" description="Add a capture location to start indexing." action={<Button render={<Link to="/settings/locations" />}>Add a location</Button>} />}
          />
        </Section>
        <Section id="sto-footprints" title="Run and group footprints" description="Each prepared folder and its Results folder. Link entries hold no image bytes; copies and clones do.">
          <DataTable
            label="Run and group footprints"
            rows={prepared}
            columns={footprintColumns}
            getRowId={(r) => r.preparation.id}
            scroll="none"
            empty={<EmptyState icon={FolderOpen} title="No prepared runs yet" description="A run gets a folder when its Prepare step runs." action={<Button render={<Link to="/projects" />}>Open Projects</Button>} />}
          />
        </Section>
        <Section
          id="sto-duplicates"
          title="Duplicate candidates"
          description={
            duplicates.length > 0
              ? `${plural(duplicates.length, "frame")} with more than one live copy, ${formatBytes(duplicateBytes)} in extra copies. Absent, retired and Trashed copies are not counted. Moving duplicate copies to the Trash happens only in a Done Project's Done / Archive sheet.`
              : "Frames with more than one live copy, by content identity."
          }
        >
          <DataTable
            label="Duplicate candidates"
            rows={duplicates}
            columns={duplicateColumns}
            getRowId={(a) => a.id}
            empty={<EmptyState icon={Copy} title="No duplicate candidates" description="Every indexed frame has one live copy." action={<Button variant="outline" render={<Link to="/sessions" />}>Open Sessions</Button>} />}
          />
        </Section>
        <Section
          id="sto-transfers"
          title="Transfers"
          description="Import, Archive and OS Trash moves with their recorded outcome."
          actions={
            <Button size="sm" variant="outline" render={<Link to="/activity" />}>
              Open Activity
            </Button>
          }
        >
          <DataTable
            label="Transfers"
            rows={transfers}
            columns={transferColumns}
            getRowId={(op) => op.id}
            scroll="none"
            empty={<EmptyState icon={ArrowRightLeft} title="No transfers yet" description="Imports, archives and moves to the OS Trash appear here." action={<Button render={<Link to="/import" />}>Import</Button>} />}
          />
        </Section>
      </PageBody>
    </div>
  )
}
