/**
 * S15 Storage (slice E; STO-FR-11, STO-FR-12, D16). Three sections:
 * location availability, duplicates and transfers. Footprints are not here:
 * they matter for Clean up only, so a run's Done step and Wrap up show them.
 * Duplicates are not listed by default: Scan for duplicates runs a
 * `duplicate-scan` operation and Storage lists the byte-identical live copies
 * it recorded (`lastDuplicateScan`). Nothing here moves or removes a file;
 * duplicate copies go to the Trash from a Project's Wrap up (D-W74).
 */
import { Link } from "@tanstack/react-router"
import { ArrowRightLeft, Copy, HardDrive } from "lucide-react"
import { useState } from "react"
import { useFollowLink } from "@/app/run-ui"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal, type RefusalProps, refusalFrom } from "@/components/app/refusal"
import type { MenuEntry } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { freeBytes } from "@/domain/disk"
import { locationAvailability } from "@/domain/library"
import { type DuplicateGroup, lastDuplicateScan, liveCopies } from "@/domain/storage"
import type { Location, Operation } from "@/domain/types"
import { formatBytes, formatDateTime, plural } from "@/lib/format"
import { startDuplicateScan } from "@/store/actions/storage"
import { useStore } from "@/store/core"
import { cancelOperation, isSettled } from "@/store/operations"

const TRANSFER_KIND: Partial<Record<Operation["kind"], string>> = { import: "Import", archive: "Archive", trash: "OS Trash" }

export function StoragePage() {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const operations = useStore((s) => s.operations)
  const follow = useFollowLink()
  const [refused, setRefused] = useState<RefusalProps | null>(null)
  const locations = Object.values(catalog.locations).sort((a, b) => a.displayName.localeCompare(b.displayName))
  const scan = lastDuplicateScan(operations)
  const scanning = scan !== null && !isSettled(scan.operation.status)
  const transfers = Object.values(operations)
    .filter((op) => op.kind in TRANSFER_KIND)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  function runScan() {
    const { result } = startDuplicateScan()
    setRefused(refusalFrom(result, "Scan blocked"))
  }

  const openLocation = (l: Location) => follow({ to: "/settings/locations", search: { locationId: l.id, return: "/storage" } })

  const locationColumns: Column<Location>[] = [
    {
      id: "name",
      header: "Location",
      rowHeader: true,
      sortValue: (l) => l.displayName,
      cell: (l) => (
        <span className="inline-flex items-center gap-1">
          <Link to="/settings/locations" search={{ locationId: l.id, return: "/storage" }} className="hover:underline" title={l.path}>
            {l.displayName}
          </Link>
          <NoteMarker label={`${l.displayName}: path`} rows={[{ label: "Path", value: <span className="font-mono [overflow-wrap:anywhere]">{l.path}</span> }]} />
        </span>
      ),
    },
    { id: "role", header: "Role", sortValue: (l) => l.role, cell: (l) => <StatusBadge kind="role" value={l.role} /> },
    {
      id: "volume",
      header: "Volume",
      sortValue: (l) => disk.volumes[l.volumeId]?.name ?? null,
      cell: (l) => {
        const v = disk.volumes[l.volumeId]
        return (
          <span className="inline-flex items-center gap-1.5">
            {v?.name ?? "–"}
            {v?.network ? <Pill tone="muted">Network</Pill> : null}
            {v?.removable ? <Pill tone="muted">Removable</Pill> : null}
          </span>
        )
      },
    },
    { id: "availability", header: "Availability", sortValue: (l) => locationAvailability(disk, l), cell: (l) => <StatusBadge kind="availability" value={locationAvailability(disk, l)} /> },
    {
      id: "free",
      header: "Free",
      align: "right",
      sortValue: (l) => (disk.volumes[l.volumeId]?.mounted ? freeBytes(disk, l.volumeId) : null),
      cell: (l) => (disk.volumes[l.volumeId]?.mounted ? formatBytes(freeBytes(disk, l.volumeId)) : "–"),
    },
    { id: "trash", header: "OS Trash", cell: (l) => (disk.volumes[l.volumeId]?.trash === "unsupported" ? <StatusBadge kind="trash" value="unsupported" label="Unsupported" /> : "–") },
    {
      id: "action",
      header: "Action",
      align: "right",
      cell: (l) =>
        locationAvailability(disk, l) === "offline" ? (
          <Button size="xs" variant="outline" className="-my-1" onClick={() => openLocation(l)}>
            Locate<span className="sr-only"> {l.displayName}</span>
          </Button>
        ) : null,
    },
  ]
  const locationMenu = (l: Location): MenuEntry[] => [
    ...(locationAvailability(disk, l) === "offline" ? [{ label: "Locate", onSelect: () => openLocation(l) }] : []),
    { label: "Open in Settings", onSelect: () => openLocation(l) },
  ]

  const copiesOf = (g: DuplicateGroup) => {
    const asset = catalog.assets[g.assetId]
    return asset ? liveCopies(catalog, asset).map((c) => ({ path: c.path, where: catalog.locations[c.locationId]?.displayName ?? "Unregistered" })) : g.paths.map((path) => ({ path, where: "–" }))
  }
  const duplicateColumns: Column<DuplicateGroup>[] = [
    { id: "file", header: "Frame", rowHeader: true, sortValue: (g) => g.fileName, cell: (g) => <span className="font-mono text-xs">{g.fileName}</span> },
    {
      id: "copies",
      header: "Copies",
      sortValue: (g) => g.paths.length,
      cell: (g) => {
        const copies = copiesOf(g)
        return (
          <span className="inline-flex items-center gap-1">
            {[...new Set(copies.map((c) => c.where))].map((where) => (
              <Pill key={where} tone="muted">
                {where}
              </Pill>
            ))}
            <NoteMarker label={`${g.fileName}: copies`} rows={[...copies.map((c, i) => ({ label: `${i + 1}`, value: <span className="font-mono [overflow-wrap:anywhere]">{c.path}</span> })), { label: "SHA-256", value: <span className="font-mono">{g.sha256.slice(0, 16)}…</span> }]} />
          </span>
        )
      },
    },
    { id: "extra", header: "Extra", align: "right", sortValue: (g) => g.extraBytes, cell: (g) => formatBytes(g.extraBytes) },
  ]
  const duplicateMenu = (g: DuplicateGroup): MenuEntry[] => {
    const sessionId = catalog.assets[g.assetId]?.sessionId
    return [...(sessionId ? [{ label: "Open session", onSelect: () => follow({ to: "/sessions/$sessionId", params: { sessionId } }) }] : []), { label: "Scan again", onSelect: runScan, disabled: scanning }]
  }

  const transferColumns: Column<Operation>[] = [
    { id: "title", header: "Transfer", rowHeader: true, truncate: true, sortValue: (op) => op.title, cell: (op) => <span title={op.title}>{op.title}</span> },
    { id: "kind", header: "Kind", sortValue: (op) => op.kind, cell: (op) => TRANSFER_KIND[op.kind] ?? "–" },
    { id: "status", header: "Status", sortValue: (op) => op.status, cell: (op) => <StatusBadge kind="operation" value={op.status} /> },
    {
      id: "summary",
      header: "Outcome",
      truncate: true,
      cell: (op) => (
        <span className="text-xs text-muted-foreground" title={op.summary ?? undefined}>
          {op.summary ?? `${op.progress.done} / ${plural(op.progress.total, op.progress.unit.replace(/s$/, ""))}`}
        </span>
      ),
    },
    { id: "started", header: "Started", sortValue: (op) => op.createdAt, cell: (op) => <span className="text-xs">{formatDateTime(op.createdAt)}</span> },
  ]
  const transferMenu = (op: Operation): MenuEntry[] => [
    { label: "Open Activity", onSelect: () => follow({ to: "/activity" }) },
    ...(!isSettled(op.status) && op.canCancel ? [{ label: "Cancel", destructive: true, onSelect: () => cancelOperation(op.id) }] : []),
  ]

  const scanButton = (
    <Button size="sm" variant="outline" disabled={scanning} onClick={runScan} data-scan-duplicates>
      <Copy aria-hidden="true" data-icon="inline-start" />
      {scan ? "Scan again" : "Scan for duplicates"}
    </Button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Storage" />
      <PageBody>
        <Section id="sto-locations" title="Locations">
          <DataTable
            label="Locations"
            rows={locations}
            columns={locationColumns}
            getRowId={(l) => l.id}
            scroll="none"
            stickyFirstColumn
            contextMenu={locationMenu}
            empty={<EmptyState icon={HardDrive} title="No locations" action={<Button render={<Link to="/settings/locations" />}>Add location</Button>} />}
          />
        </Section>

        <Section id="sto-duplicates" title="Duplicates" actions={scan ? scanButton : null}>
          {refused ? <Refusal {...refused} /> : null}
          {!scan ? (
            <EmptyState icon={Copy} title="Not scanned" action={scanButton} />
          ) : scanning ? (
            <OperationPanel operationId={scan.operation.id} />
          ) : scan.groups === null ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge kind="operation" value={scan.operation.status} /> <span className="text-muted-foreground">{formatDateTime(scan.operation.settledAt ?? scan.operation.createdAt)}</span>
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-1.5 text-sm" data-scan-summary>
                <Pill tone={scan.groups.length > 0 ? "warning" : "success"}>{scan.groups.length > 0 ? plural(scan.groups.length, "frame") : "No duplicates"}</Pill>
                {scan.groups.length > 0 ? <Pill tone="muted">{`${formatBytes(scan.extraBytes)} extra`}</Pill> : null}
                <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(scan.operation.settledAt ?? scan.operation.createdAt)}</span>
              </p>
              {scan.groups.length > 0 ? (
                <DataTable label="Duplicates" rows={scan.groups} columns={duplicateColumns} getRowId={(g) => g.assetId} initialSort={{ columnId: "extra", direction: "desc" }} contextMenu={duplicateMenu} />
              ) : null}
            </>
          )}
        </Section>

        <Section
          id="sto-transfers"
          title="Transfers"
          actions={
            <span className="inline-flex items-center gap-2">
              <CountBadge count={transfers.length} label={plural(transfers.length, "transfer")} />
              <Button size="sm" variant="ghost" render={<Link to="/activity" />}>
                Activity
              </Button>
            </span>
          }
        >
          <DataTable
            label="Transfers"
            rows={transfers}
            columns={transferColumns}
            getRowId={(op) => op.id}
            scroll="none"
            contextMenu={transferMenu}
            empty={<EmptyState icon={ArrowRightLeft} title="No transfers" action={<Button render={<Link to="/import" />}>Import</Button>} />}
          />
        </Section>
      </PageBody>
    </div>
  )
}
