/**
 * Duplicates review (P-STO2; plan §4b), a large FormDialog opened by
 * `?duplicates=review` over Sessions › Duplicates, the duplicates issue's
 * owning filter (F5, F7). One table lists the byte-identical copies the
 * latest automatic duplicate scan found that are still live, grouped by frame. The scan
 * covers registered library locations only, never a capture card (Round 6),
 * and the copy to keep is preselected (`keepChoice`: the one in the
 * earliest-registered location; a copy that cannot go to the OS Trash is
 * kept, so the others can). A copy linked by an open Project's View can't
 * go (`trashBlock`, P-TRASH2) and its row leads to that Project. Per frame: Move
 * others to Trash, confirmed with its files; for every frame: Move all to
 * Trash. Both run through the shared OS Trash engine, so nothing is deleted
 * permanently, and the issue clears as the copies leave. Its More menu
 * dismisses the duplicates issue, and restores it once dismissed (F7,
 * P-ISS1), as the Sessions page menu does: the issue links there.
 */
import { useNavigate } from "@tanstack/react-router"
import { Copy } from "lucide-react"
import { useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionBar, ActionButton } from "@/components/app/actions"
import { pageIssues, withIssueItems } from "@/components/app/issue-actions"
import type { Action, Column, ConfirmSpec, MenuItem } from "@/components/app/contracts"
import { KeyValueList, PathText } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { EmptyState, toast } from "@/components/app/feedback"
import { FormDialog } from "@/components/app/form-dialog"
import { OperationPanel } from "@/components/app/operation-panel"
import { type DuplicateGroup, duplicateFindings, keepChoice, keptViewLinks, runningDuplicateScan, type TrashBlock, trashBlock, viewLinks } from "@/domain/storage"
import type { AssetCopy, Catalog } from "@/domain/types"
import { formatBytes, formatCount, formatDateTime } from "@/lib/format"
import { say } from "@/lib/i18n"
import { cleanUpDuplicates, startDuplicateScan } from "@/store/actions/storage"
import { trashFileRows } from "@/store/actions/trash"
import { useStore } from "@/store/core"
import { useIssues } from "@/store/issues"

/** One copy of one frame, as a table row. */
interface CopyRow {
  id: string
  group: DuplicateGroup
  copy: AssetCopy
  kept: boolean
  /** Why this leaving copy can't go to the OS Trash; null when it can, or when it is the kept copy. */
  block: TrashBlock | null
}

function locationName(catalog: Catalog, copy: AssetCopy): string {
  return catalog.locations[copy.locationId]?.displayName ?? copy.path
}

export function DuplicatesReview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = useMessages()
  const navigate = useNavigate()
  const findings = useStore(duplicateFindings)
  const scanning = useStore((s) => runningDuplicateScan(s.operations))
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const issueView = useIssues()
  const links = useMemo(() => viewLinks(catalog, disk), [catalog, disk])
  // The copy to keep per frame, once the user picks one; the preselection otherwise.
  const [picked, setPicked] = useState<Record<string, string>>({})
  const groups = findings?.groups ?? []

  const keptPath = (g: DuplicateGroup) => (g.copies.some((c) => c.path === picked[g.assetId]) ? picked[g.assetId]! : keepChoice(disk, links, g).path)
  const leaving = (g: DuplicateGroup) => g.copies.filter((c) => c.path !== keptPath(g))
  // Copies of one frame move together or not at all (D-W57): one copy that cannot go holds back its group.
  const blocked = (g: DuplicateGroup) => leaving(g).map((c) => trashBlock(disk, links, c.path)).find((b) => b !== null) ?? null
  const movable = groups.filter((g) => blocked(g) === null)
  const movableCopies = movable.reduce((n, g) => n + leaving(g).length, 0)

  const rows: CopyRow[] = groups.flatMap((g) =>
    g.copies.map((copy) => {
      const kept = copy.path === keptPath(g)
      return { id: copy.path, group: g, copy, kept, block: kept ? null : trashBlock(disk, links, copy.path) }
    }),
  )

  /** Moves the leaving copies of `chosen` to the OS Trash as one background operation. */
  function move(chosen: DuplicateGroup[]) {
    const copies = chosen.reduce((n, g) => n + leaving(g).length, 0)
    cleanUpDuplicates(chosen.map((g) => ({ assetId: g.assetId, paths: leaving(g).map((c) => c.path) })))
    toast({ message: m.duplicates_moving({ count: copies, n: formatCount(copies) }), action: { id: "show", label: m.verb_show(), run: () => void navigate({ to: "/activity" }) } })
  }

  /** The review of moving the leaving copies of `chosen`: one fold-out per frame with the exact copies (astro-plan-6bh3p). */
  function review(chosen: DuplicateGroup[]): ConfirmSpec {
    const paths = chosen.flatMap((g) => leaving(g).map((c) => c.path))
    const kept = keptViewLinks(links, paths).length
    const size = formatBytes(chosen.reduce((n, g) => n + leaving(g).length * g.sizeBytes, 0))
    return {
      title: m.duplicates_confirm_title({ count: paths.length, n: formatCount(paths.length) }),
      summary: [size, m.duplicates_frames_keep_copy({ count: chosen.length, n: formatCount(chosen.length) }), ...(kept > 0 ? [m.trash_also_removes_links({ count: kept })] : [])].join(" · "),
      groups: chosen.map((g) => ({
        label: g.fileName,
        rows: trashFileRows(
          m,
          { catalog, disk },
          leaving(g).map((c) => ({ path: c.path, assetId: g.assetId, refused: trashBlock(disk, links, c.path) })),
        ),
        defaultOpen: chosen.length === 1,
      })),
      confirm: { label: m.common_move_to_trash(), kind: "destructive" },
    }
  }

  function moveOthers(g: DuplicateGroup): Action {
    const block = blocked(g)
    return {
      id: "move-others",
      label: m.duplicates_move_others(),
      kind: "destructive",
      opensDialog: true,
      unavailable: block ? { action: m.trash_cant(), reason: say(m, block.reason), blockers: [] } : undefined,
      confirm: review([g]),
      run: () => move([g]),
    }
  }

  function keep(row: CopyRow): Action {
    return { id: "keep", label: m.duplicates_keep_copy(), run: () => setPicked((prev) => ({ ...prev, [row.group.assetId]: row.copy.path })) }
  }

  const columns: Column<CopyRow>[] = [
    { id: "location", header: m.location_label(), rowHeader: true, sortValue: (r) => locationName(catalog, r.copy), cell: (r) => locationName(catalog, r.copy) },
    { id: "path", header: m.location_path(), truncate: true, sortValue: (r) => r.copy.path, cell: (r) => <PathText path={r.copy.path} truncate /> },
    {
      id: "status",
      header: m.duplicates_col_outcome(),
      sortValue: (r) => (r.kept ? 0 : r.block ? 2 : 1),
      cell: (r) => (r.kept ? m.status_keep() : r.block ? say(m, r.block.reason) : m.session_os_trash()),
    },
  ]

  const scanAgain: Action = { id: "scan-again", label: m.storage_scan_again(), unavailable: scanning ? { action: m.storage_scan_again(), reason: m.duplicates_scan_running(), blockers: [] } : undefined, run: () => startDuplicateScan() }
  const moveAll: Action = {
    id: "move-all",
    label: m.duplicates_move_all(),
    kind: "destructive",
    unavailable: movable.length === 0 ? { action: m.trash_cant(), reason: m.duplicates_none_movable(), blockers: [] } : undefined,
    confirm: movable.length > 0 ? review(movable) : undefined,
    run: () => move(movable),
  }

  // Before any scan, or with nothing found, the empty state alone says so and offers Scan again.
  const empty = groups.length === 0 && !scanning
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={m.duplicates_review_title()} size="lg" confirm={moveAll}>
      {findings ? (
        <KeyValueList
          items={[
            { label: m.duplicates_found(), value: m.issue_duplicates({ count: findings.copies, bytes: formatBytes(findings.bytes) }) },
            { label: m.duplicates_scan(), value: m.duplicates_scanned({ date: formatDateTime(findings.scan.settledAt ?? findings.scan.createdAt) }) },
            { label: m.duplicates_movable(), value: m.location_copies_count({ count: movableCopies, n: formatCount(movableCopies) }) },
          ]}
        />
      ) : null}
      {empty ? null : <ActionBar actions={[scanAgain]} overflow={withIssueItems(m, [], pageIssues(issueView, "/sessions"))} />}
      {scanning ? <OperationPanel operationId={scanning.id} itemLimit={0} /> : null}
      {groups.length === 0 ? (
        empty ? <EmptyState icon={Copy} title={findings ? m.storage_no_duplicates() : m.storage_not_scanned()} action={<ActionButton action={scanAgain} />} /> : null
      ) : (
        <DataTable<CopyRow>
          label={m.storage_duplicates()}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          rowLabel={(r) => `${r.group.fileName} · ${locationName(catalog, r.copy)}`}
          groups={{ key: (r) => r.group.assetId, label: (_key, groupRows) => (groupRows[0] ? `${groupRows[0].group.fileName} · ${formatBytes(groupRows[0].group.sizeBytes)}` : "") }}
          primaryRowAction={(r) => (r.kept ? null : keep(r))}
          rowActions={(r): MenuItem[] => [
            ...(r.kept ? [] : [keep(r)]),
            ...(r.block?.link ? [{ id: "open-blocker", label: m.duplicates_open_blocker({ reason: say(m, r.block.reason) }), run: () => void navigate({ to: r.block!.link!.to as never, params: r.block!.link!.params as never, search: r.block!.link!.search as never }) }] : []),
            { separator: true },
            moveOthers(r.group),
          ]}
        />
      )}
    </FormDialog>
  )
}
