/**
 * Duplicates review (P-STO2), a sheet over Settings › Locations opened by
 * `?duplicates=review` (the ⚠ duplicates issue links there). It lists the
 * byte-identical copies the latest automatic duplicate scan found that are
 * still live, one group per frame. The scan covers registered library
 * locations only, never a capture card (Round 6), and the copy to keep is
 * preselected (`keepChoice`: the one in the earliest-registered location; a
 * copy that cannot go to the OS Trash is kept, so the others can). A copy
 * linked by an unfinished run's view can't go (`trashBlock`, P-TRASH2) and
 * leads to that run. Per group: Move others to Trash; for every group: Move
 * all to Trash. Each move is confirmed with its count and bytes, plus the
 * kept-view links that go with it, and runs through the shared OS Trash
 * engine: nothing is deleted permanently, and the issue clears as the copies
 * leave. Scan again lives here, the scan otherwise runs by itself.
 */
import { Copy } from "lucide-react"
import { useId, useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Box } from "@/components/app/box"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { EmptyState } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { Pill } from "@/components/app/pill"
import { Refusal, type RefusalProps, refusalFrom } from "@/components/app/refusal"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { unitCount } from "@/domain/labels"
import { type DuplicateGroup, duplicateFindings, keepChoice, keptViewLinks, runningDuplicateScan, runViewLinks, type TrashBlock, trashBlock } from "@/domain/storage"
import type { AssetCopy, Catalog, OperationId } from "@/domain/types"
import { formatBytes, formatCount, formatDateTime } from "@/lib/format"
import { say } from "@/lib/i18n"
import { cleanUpDuplicates, startDuplicateScan } from "@/store/actions/storage"
import { useStore } from "@/store/core"

export function DuplicatesReview({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-[46rem] data-[side=right]:max-w-[94vw] data-[side=right]:sm:max-w-[94vw]" data-duplicates-review>
        {open ? <ReviewBody /> : null}
      </SheetContent>
    </Sheet>
  )
}

function locationName(catalog: Catalog, copy: AssetCopy): string {
  return catalog.locations[copy.locationId]?.displayName ?? copy.path
}

function ReviewBody() {
  const m = useMessages()
  const findings = useStore(duplicateFindings)
  const scanning = useStore((s) => runningDuplicateScan(s.operations))
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const links = useMemo(() => runViewLinks(catalog, disk), [catalog, disk])
  // The copy to keep per frame, once the user picks one; the preselection otherwise.
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<DuplicateGroup[] | null>(null)
  const [trashOperationId, setTrashOperationId] = useState<OperationId | null>(null)
  const [refused, setRefused] = useState<RefusalProps | null>(null)
  const groups = findings?.groups ?? []

  const keptPath = (g: DuplicateGroup) => (g.copies.some((c) => c.path === picked[g.assetId]) ? picked[g.assetId]! : keepChoice(disk, links, g).path)
  const leaving = (g: DuplicateGroup) => g.copies.filter((c) => c.path !== keptPath(g))
  // Copies of one frame move together or not at all (D-W57): one copy that cannot go holds back its group.
  const blocked = (g: DuplicateGroup) => leaving(g).map((c) => trashBlock(disk, links, c.path)).find((b) => b !== null) ?? null
  const movable = groups.filter((g) => blocked(g) === null)

  function scanAgain() {
    setRefused(refusalFrom(startDuplicateScan(), m.storage_scan_again()))
  }

  const confirmed = confirming ?? []
  const confirmCopies = confirmed.reduce((n, g) => n + leaving(g).length, 0)
  const confirmBytes = confirmed.reduce((n, g) => n + leaving(g).length * g.sizeBytes, 0)
  const confirmLinks = keptViewLinks(
    links,
    confirmed.flatMap((g) => leaving(g).map((c) => c.path)),
  ).length
  const byLocation = new Map<string, { copies: number; bytes: number }>()
  for (const g of confirmed) {
    for (const copy of leaving(g)) {
      const name = locationName(catalog, copy)
      const sum = byLocation.get(name) ?? { copies: 0, bytes: 0 }
      byLocation.set(name, { copies: sum.copies + 1, bytes: sum.bytes + g.sizeBytes })
    }
  }

  return (
    <>
      <SheetHeader className="flex-row flex-wrap items-center gap-x-2 gap-y-1 border-b border-separator py-2 pr-12" data-chrome>
        <SheetTitle>{m.storage_duplicates()}</SheetTitle>
        <HelpTip>{m.duplicates_scope_help()}</HelpTip>
        {findings && findings.copies > 0 ? <Pill tone="warning">{m.issue_duplicates({ count: findings.copies, bytes: formatBytes(findings.bytes) })}</Pill> : null}
        {findings ? <span className="text-xs text-muted-foreground tabular-nums">{m.duplicates_scanned({ date: formatDateTime(findings.scan.settledAt ?? findings.scan.createdAt) })}</span> : null}
        <Button size="sm" variant="outline" className="ml-auto" disabled={scanning !== null} onClick={scanAgain} data-scan-again>
          {m.storage_scan_again()}
        </Button>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
        {refused ? <Refusal {...refused} /> : null}
        {trashOperationId ? <OperationPanel operationId={trashOperationId} itemLimit={4} /> : null}
        {scanning ? <OperationPanel operationId={scanning.id} itemLimit={0} /> : null}
        {groups.length === 0 ? (
          scanning ? null : (
            <EmptyState
              icon={Copy}
              title={findings ? m.storage_no_duplicates() : m.storage_not_scanned()}
              action={
                <Button size="sm" variant="outline" onClick={scanAgain}>
                  {m.storage_scan_again()}
                </Button>
              }
            />
          )
        ) : (
          groups.map((g) => (
            <DuplicateGroupBox
              key={g.assetId}
              group={g}
              catalog={catalog}
              keptPath={keptPath(g)}
              blocked={blocked(g)}
              onKeep={(path) => setPicked((prev) => ({ ...prev, [g.assetId]: path }))}
              onMove={() => setConfirming([g])}
              refusalOf={(copy) => trashBlock(disk, links, copy.path)}
            />
          ))
        )}
      </div>

      {groups.length > 0 ? (
        <SheetFooter className="flex-row items-center justify-end gap-2 border-t border-separator">
          <span className="mr-auto text-xs text-muted-foreground tabular-nums">{m.location_copies_count({ count: movable.reduce((n, g) => n + leaving(g).length, 0), n: formatCount(movable.reduce((n, g) => n + leaving(g).length, 0)) })}</span>
          <Button disabled={movable.length === 0} onClick={() => setConfirming(movable)} data-move-all>
            {m.duplicates_move_all()}
          </Button>
        </SheetFooter>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => !next && setConfirming(null)}
        title={m.wrapup_offer_duplicates({ count: confirmCopies, n: formatCount(confirmCopies), size: formatBytes(confirmBytes) })}
        description={null}
        changes={[
          ...[...byLocation.entries()].map(([location, sum]) => m.duplicates_change_location({ location, files: say(m, unitCount("files", sum.copies)), bytes: formatBytes(sum.bytes) })),
          ...(confirmLinks > 0 ? [m.trash_also_removes_links({ count: confirmLinks })] : []),
        ]}
        unchanged={[m.duplicates_frames_keep_copy({ count: confirmed.length, n: formatCount(confirmed.length) })]}
        confirmLabel={m.run_move_to_trash()}
        tone="destructive"
        onConfirm={() => {
          if (!confirming) return
          setTrashOperationId(cleanUpDuplicates(confirming.map((g) => ({ assetId: g.assetId, paths: leaving(g).map((c) => c.path) }))))
          setConfirming(null)
        }}
      />
    </>
  )
}

interface DuplicateGroupBoxProps {
  group: DuplicateGroup
  catalog: Catalog
  keptPath: string
  /** Why the copies leaving cannot go, or null. */
  blocked: TrashBlock | null
  onKeep: (path: string) => void
  onMove: () => void
  refusalOf: (copy: AssetCopy) => TrashBlock | null
}

/** One frame's byte-identical copies: Keep this copy (a radio per copy), then Move others to Trash. */
function DuplicateGroupBox({ group, catalog, keptPath, blocked, onKeep, onMove, refusalOf }: DuplicateGroupBoxProps) {
  const m = useMessages()
  const id = useId()
  return (
    <Box
      title={
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-foreground" title={group.fileName}>
            {group.fileName}
          </span>
          <span className="font-normal tabular-nums">{formatBytes(group.sizeBytes)}</span>
        </span>
      }
      actions={
        <Button size="xs" variant="outline" disabled={blocked !== null} title={blocked ? say(m, blocked.reason) : undefined} onClick={onMove} data-move-others={group.assetId}>
          {m.duplicates_move_others()}
        </Button>
      }
      flush
    >
      <RadioGroup aria-label={m.duplicates_keep_copy()} value={keptPath} onValueChange={(value) => onKeep(String(value))} className="gap-0" data-duplicate-group={group.assetId}>
        {group.copies.map((copy, index) => {
          const kept = copy.path === keptPath
          const refusal = kept ? null : refusalOf(copy)
          const itemId = `${id}-${index}`
          return (
            <div key={copy.path} className="flex min-h-(--row-h) min-w-0 items-center gap-2 border-b border-border/50 px-3 py-(--row-py) last:border-0" data-copy-kept={kept || undefined}>
              <RadioGroupItem id={itemId} value={copy.path} />
              <label htmlFor={itemId} className="flex min-w-0 flex-1 items-center gap-2">
                <Pill tone="muted">{locationName(catalog, copy)}</Pill>
                <span className="truncate font-mono text-xs text-muted-foreground" title={copy.path}>
                  {copy.path}
                </span>
              </label>
              {kept ? (
                <Pill tone="success">{m.status_keep()}</Pill>
              ) : refusal?.link ? (
                <Pill tone="warning" link={refusal.link} className="shrink-0">
                  {m.trash_cant()} · {say(m, refusal.reason)} ▸
                </Pill>
              ) : refusal ? (
                <span className="shrink-0 text-xs text-warning">
                  {m.trash_cant()} · {say(m, refusal.reason)}
                </span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">{m.session_os_trash()}</span>
              )}
            </div>
          )
        })}
      </RadioGroup>
    </Box>
  )
}
