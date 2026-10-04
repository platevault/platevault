/**
 * Clean up View (spec 071 STO-FR-01..05, STO-FR-10; J27 S4-S11). Plan →
 * Review cleanup → confirm → per-item outcomes → cleanup record.
 */
import { Link, useParams } from "@tanstack/react-router"
import { Inbox, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PathText } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState, Notice } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { Disk, View } from "@/domain/types"
import { formatBytes, formatCount, formatDateTime, plural } from "@/lib/format"
import { nowIso, updateSlice, useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import type { CleanupDraft } from "@/store/slices/t5"
import {
  type CleanupEntry,
  type CleanupGroupId,
  type CleanupPlan,
  cleanupPlan,
  defaultSelection,
  GROUP_ORDER,
  GROUPS,
  groupEligible,
  type ReviewedEntry,
  type ReviewSnapshot,
  reviewDrift,
  reviewSnapshot,
  trashSupport,
} from "./lib/cleanup"
import { baseName, parentFolder } from "./lib/files"
import { type CleanupPayload, keepRefusedFiles, startCleanup } from "./lib/operations"
import { type ControlOutcome, putBackFromTrash } from "./lib/prototype"
import { focusHeading, PrototypeControls, RevealLocation } from "./shared"

const EMPTY_DRAFT: CleanupDraft = { selected: null, stage: "choose", review: null, operationId: null }

/**
 * The reviewed entries checked against the disk now: an entry whose bytes,
 * identity, link target or kept copy changed since review reads blocked with
 * that drift, on top of anything the review already refused.
 */
function checkReview(disk: Disk, review: ReviewSnapshot): ReviewedEntry[] {
  return review.selected.map((e) => {
    if (e.blocked) return e
    const drift = reviewDrift(disk, { ...e, keptPath: e.proof?.keptPath ?? null })
    return drift ? { ...e, blocked: drift } : e
  })
}

function setDraft(viewId: string, patch: Partial<CleanupDraft>) {
  updateSlice("t5", (s) => ({ ...s, cleanup: { ...s.cleanup, [viewId]: { ...(s.cleanup[viewId] ?? EMPTY_DRAFT), ...patch } } }))
}

export function CleanupPage() {
  const { viewId } = useParams({ strict: false }) as { viewId?: string }
  const view = useStore((s) => (viewId ? s.catalog.views[viewId] : undefined))
  if (!view) {
    return (
      <PageBody>
        <EmptyState titleAs="h2" icon={Inbox} title="View not found" description="This View does not exist in the catalog." action={<Button render={<Link to="/views" />}>Open Views</Button>} />
      </PageBody>
    )
  }
  return <CleanupArea view={view} />
}

function CleanupArea({ view }: { view: View }) {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const draft = useStore((s) => s.slices.t5.cleanup[view.id]) ?? EMPTY_DRAFT
  const operations = useStore((s) => s.operations)
  const plan = useMemo(() => cleanupPlan(disk, catalog, view), [disk, catalog, view])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const lastRun = Object.values(operations)
    .filter((op) => op.kind === "cleanup" && op.scope.viewIds?.includes(view.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const running = lastRun && !isSettled(lastRun.status)

  const header = (
    <PageHeader
      level={2}
      title="Clean up View"
      description="Choose files to send to the OS Trash. Originals outside this View, accepted Results and calibration masters stay protected. Nothing is deleted permanently."
      meta={view.completedAt ? <StatusBadge kind="view" value="complete" /> : null}
    />
  )

  if (!plan) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <PageBody>
          <EmptyState
            icon={Trash2}
            title="Nothing to clean up"
            description="This View has no prepared folder or output yet."
            action={<Button render={<Link to="/views/$viewId/prepare" params={{ viewId: view.id }} />}>Open Prepare</Button>}
          />
        </PageBody>
      </div>
    )
  }

  const keys = new Set(plan.entries.map((e) => e.key))
  const selectedKeys = (draft.selected ?? defaultSelection(plan)).filter((k) => keys.has(k))
  const selectedSet = new Set(selectedKeys)
  const setSelected = (next: string[]) => setDraft(view.id, { selected: next })
  const review = draft.stage === "review" ? draft.review : null
  const checked = review ? checkReview(disk, review) : []
  const movable = checked.filter((e) => !e.blocked)
  const refusedCount = checked.length - movable.length
  const links = movable.filter((e) => e.linkKind === "symlink")
  const protectedOnes = movable.filter((e) => e.group === "keep")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <PageBody>
        {!plan.online ? (
          <Notice tone="offline" title="View folder offline" actions={<Button size="sm" variant="outline" render={<Link to="/storage" />}>Open Storage</Button>}>
            {plan.viewPath} is on a volume that is not connected. Cleanup lists and moves files only while the View folder is online.
          </Notice>
        ) : null}
        {!plan.complete ? (
          <Notice tone="info" title="This View is not Complete">
            Before Mark processing complete, only replaced preparation entries can be cleaned up (D09). Every other group is available after Mark processing complete.
          </Notice>
        ) : null}
        {plan.directSource ? (
          <Notice tone="info" title="Direct-source View">
            Original subs are never cleanup candidates. Only processing outputs attributed to this View are listed.
          </Notice>
        ) : null}

        {lastRun ? <CleanupRecord opId={lastRun.id} viewPath={plan.viewPath} /> : null}

        {running ? null : review ? (
          <CleanupReview
            review={review}
            entries={checked}
            onBack={() => {
              setDraft(view.id, { stage: "choose", review: null })
              focusHeading("t5-cleanup-groups-title")
            }}
            onConfirm={() => setConfirmOpen(true)}
          />
        ) : (
          <CleanupChooser
            plan={plan}
            selected={selectedSet}
            onChange={setSelected}
            onReview={() => {
              setDraft(view.id, { stage: "review", review: reviewSnapshot(disk, plan, selectedSet, nowIso()) })
              focusHeading("t5-cleanup-review-title")
            }}
          />
        )}
      </PageBody>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="destructive"
        title={`Send ${plural(movable.length, "file")} to the OS Trash?`}
        description="Each file is checked against its review again just before it moves. Anything that changed, lost its retained original or kept copy, or sits where the OS Trash is unsupported is refused and stays."
        changes={[
          `Move ${plural(movable.length, "file")} from ${view.name}'s folder to the OS Trash`,
          ...(links.length > 0 ? [`Trash ${plural(links.length, "link entry", "link entries")} without following their targets`] : []),
          ...(protectedOnes.length > 0 ? [`Remove protected ${plural(protectedOnes.length, "product")}: ${protectedOnes.map((e) => baseName(e.path)).join(", ")}`] : []),
        ]}
        unchanged={[
          ...(refusedCount > 0 ? [`${plural(refusedCount, "selected file")} ${refusedCount === 1 ? "is" : "are"} refused and ${refusedCount === 1 ? "stays" : "stay"} in place`] : []),
          "Original captures outside this View stay where they are",
          "Unselected files, including Keep, stay in place",
          `${view.name} ${view.completedAt ? "stays Complete" : "keeps its status"}; membership does not change`,
          "No file is deleted permanently",
        ]}
        confirmLabel={`Send ${plural(movable.length, "file")} to Trash`}
        onConfirm={() => {
          if (!review) return
          const opId = startCleanup(view.id, view.name, review.viewPath, review.selected)
          setDraft(view.id, { operationId: opId, stage: "choose", selected: [], review: null })
        }}
      />
    </div>
  )
}

function groupStats(entries: CleanupEntry[]) {
  const bytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0)
  const reclaim = entries.reduce((sum, e) => sum + (e.reclaimBytes ?? 0), 0)
  return { bytes, reclaim }
}

function CleanupChooser({ plan, selected, onChange, onReview }: { plan: CleanupPlan; selected: Set<string>; onChange: (keys: string[]) => void; onReview: () => void }) {
  const disk = useStore((s) => s.disk)
  const support = trashSupport(disk, plan.entries)
  const count = [...selected].length
  return (
    <>
      <Section id="t5-trash-support" title="OS Trash support" description="Shown per location. An OS action that deletes immediately counts as unsupported.">
        <ul className="flex flex-wrap gap-2">
          {support.map((row) => (
            <li key={row.volumeId} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
              <span>{row.name}</span>
              <StatusBadge kind="trash" value={row.supported ? "supported" : "unsupported"} />
            </li>
          ))}
          {support.length === 0 ? <li className="text-sm text-muted-foreground">No files in the View folder.</li> : null}
        </ul>
      </Section>

      <Section
        id="t5-cleanup-groups"
        title="Files in this View"
        description="Recognized regenerable groups start selected. Selecting a group selects its files one by one; it never authorizes deleting a whole folder."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {plural(count, "file")} selected
            </span>
            <Button disabled={count === 0} onClick={onReview}>
              Review cleanup
            </Button>
          </div>
        }
      >
        {count === 0 ? <p className="text-xs text-muted-foreground">Review cleanup is available once at least one file is selected.</p> : null}
        <ul className="divide-y rounded-lg border">
          {GROUP_ORDER.map((group) => {
            const entries = plan.entries.filter((e) => e.group === group)
            if (entries.length === 0) return null
            return <GroupRow key={group} plan={plan} group={group} entries={entries} selected={selected} onChange={onChange} />
          })}
          {plan.entries.length === 0 ? <li className="p-4 text-sm text-muted-foreground">The View folder holds no files.</li> : null}
        </ul>
      </Section>
    </>
  )
}

function GroupRow({
  plan,
  group,
  entries,
  selected,
  onChange,
}: {
  plan: CleanupPlan
  group: CleanupGroupId
  entries: CleanupEntry[]
  selected: Set<string>
  onChange: (keys: string[]) => void
}) {
  const meta = GROUPS[group]
  const eligible = groupEligible(plan, group)
  const chosen = entries.filter((e) => selected.has(e.key))
  const all = chosen.length === entries.length
  const some = chosen.length > 0 && !all
  const { bytes, reclaim } = groupStats(entries)
  const blocked = entries.filter((e) => e.blocked).length
  const checkboxId = `t5-group-${group}`
  const hintId = `${checkboxId}-hint`
  const setGroup = (on: boolean) => {
    const others = [...selected].filter((k) => !entries.some((e) => e.key === k))
    onChange(on ? [...others, ...entries.map((e) => e.key)] : others)
  }
  const columns: Column<CleanupEntry>[] = [
    { id: "file", header: "File", rowHeader: true, sortValue: (e) => e.path, cell: (e) => <PathText path={e.path} className="max-w-md" /> },
    { id: "role", header: "Role", cell: (e) => e.role },
    {
      id: "refs",
      header: "Other references",
      cell: (e) => {
        const refs = [...e.references, ...e.dependents]
        return refs.length > 0 ? <span className="text-xs text-pretty">{refs.join("; ")}</span> : <span className="text-xs text-muted-foreground">None</span>
      },
    },
    {
      id: "proof",
      header: "Retained original",
      cell: (e) =>
        e.proof ? (
          <span className={e.proof.state === "verified" || e.proof.state === "not-needed" ? "text-xs text-pretty" : "text-xs text-pretty text-destructive"}>{e.proof.text}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Not needed: produced by processing</span>
        ),
    },
    {
      id: "bytes",
      header: "Estimated bytes",
      align: "right",
      sortValue: (e) => e.sizeBytes,
      cell: (e) => (
        <span className="text-xs">
          {e.linkKind === "symlink" ? "0 B (link)" : formatBytes(e.sizeBytes)}
          <span className="block text-muted-foreground">{e.reclaimNote}</span>
        </span>
      ),
    },
  ]
  return (
    <li className={group === "keep" ? "bg-secondary/40" : undefined}>
      <Collapsible>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5">
          <Checkbox
            id={checkboxId}
            className="mt-0.5"
            checked={all}
            indeterminate={some}
            disabled={!eligible}
            aria-describedby={hintId}
            onCheckedChange={(checked) => setGroup(Boolean(checked))}
          />
          <div className="min-w-0 space-y-0.5">
            <label htmlFor={checkboxId} className="text-sm font-medium">
              {meta.label}
            </label>
            <p id={hintId} className="text-xs text-pretty text-muted-foreground">
              {!eligible ? "Available after Mark processing complete. " : ""}
              {meta.description}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {plural(entries.length, "file")} · {formatBytes(bytes)} on disk · {reclaim > 0 ? `up to ${formatBytes(reclaim)} reclaimed` : "no guaranteed reclaim"} · {formatCount(chosen.length)} selected
              {blocked > 0 ? ` · ${blocked} would be refused` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {group === "keep" ? <StatusBadge kind="custody" value="keep" /> : <span className="text-xs text-muted-foreground">{chosen.length > 0 ? "Send to OS Trash" : "Keep"}</span>}
            <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>Inspect files</CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent>
          <div className="border-t px-3 py-2">
            <DataTable
              label={`${meta.label}: files`}
              rows={entries}
              columns={columns}
              getRowId={(e) => e.key}
              className="max-h-96"
              selection={{
                selected: chosen.map((e) => e.key),
                onChange: (ids) => onChange([...[...selected].filter((k) => !entries.some((e) => e.key === k)), ...ids]),
                rowLabel: (e) => baseName(e.path),
                isSelectable: () => eligible,
              }}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function CleanupReview({ review, entries, onBack, onConfirm }: { review: ReviewSnapshot; entries: ReviewedEntry[]; onBack: () => void; onConfirm: () => void }) {
  const disk = useStore((s) => s.disk)
  const support = trashSupport(disk, entries)
  const reviewedBlocked = new Set(review.selected.filter((e) => e.blocked).map((e) => e.key))
  const movable = entries.filter((e) => !e.blocked)
  const refused = entries.filter((e) => reviewedBlocked.has(e.key))
  const changed = entries.filter((e) => e.blocked && !reviewedBlocked.has(e.key))
  const protectedOnes = movable.filter((e) => e.group === "keep")
  const sendHint = movable.length === 0 ? "No selected file can move: each one is refused, so nothing would go to the OS Trash." : null
  return (
    <Section
      id="t5-cleanup-review"
      title="Review cleanup"
      description={`Exactly these entries, recorded at ${formatDateTime(review.at)}. Each one moves only if it still matches this review. The default action is Send to OS Trash; there is no permanent delete.`}
      actions={
        <>
          <Button variant="outline" onClick={onBack}>
            Back to selection
          </Button>
          <Button variant="destructive" disabled={movable.length === 0} aria-describedby={sendHint ? "t5-cleanup-send-hint" : undefined} onClick={onConfirm}>
            Send selected files to Trash
          </Button>
        </>
      }
    >
      {sendHint ? (
        <p id="t5-cleanup-send-hint" className="text-xs text-muted-foreground">
          {sendHint}
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-2" aria-label="Trash support for the selected files">
        {support.map((row) => (
          <li key={row.volumeId} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm tabular-nums">
            <span className="font-medium">{row.name}</span>
            <StatusBadge kind="trash" value={row.supported ? "supported" : "unsupported"} />
            <span>
              {formatCount(row.movable)} can move · {formatCount(row.blocked)} blocked
            </span>
          </li>
        ))}
      </ul>
      {changed.length > 0 ? (
        <Notice tone="refusal" title={`${plural(changed.length, "selected file")} changed since review`}>
          <p>These stay in place. To include their current bytes, go back to selection and review again.</p>
          <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
            {changed.map((e) => (
              <li key={e.key}>
                <span className="font-mono text-xs">{baseName(e.path)}</span>: {e.blocked}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {protectedOnes.length > 0 ? (
        <Notice tone="warning" title={`${plural(protectedOnes.length, "protected product")} selected`}>
          <ul className="list-disc space-y-1 pl-5">
            {protectedOnes.map((e) => (
              <li key={e.key}>
                {baseName(e.path)}: {e.role}. {e.dependents.length > 0 ? `Depends on it: ${e.dependents.join("; ")}.` : "Nothing else depends on it."}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {refused.length > 0 ? (
        <Notice tone="refusal" title={`${plural(refused.length, "selected file")} would be refused`}>
          <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
            {refused.map((e) => (
              <li key={e.key}>
                <span className="font-mono text-xs">{baseName(e.path)}</span>: {e.blocked}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <ReviewList title={`Send to OS Trash (${formatCount(movable.length)})`} entries={movable} empty="No selected file can move." />
        <ReviewList title={`Keep (${formatCount(review.retained.length + refused.length + changed.length)})`} entries={[...changed, ...refused, ...review.retained]} empty="Every file is selected." />
      </div>
    </Section>
  )
}

function ReviewList({ title, entries, empty }: { title: string; entries: CleanupEntry[]; empty: string }) {
  const [all, setAll] = useState(false)
  const shown = all ? entries : entries.slice(0, 12)
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border text-xs">
          {shown.map((e) => (
            <li key={e.key} className="space-y-0.5 px-2.5 py-1.5">
              <PathText path={e.path} />
              <div className="text-muted-foreground">
                {e.role}
                {e.proof?.keptPath ? ` · kept copy: ${e.proof.keptPath}` : ""}
                {e.linkKind === "symlink" ? " · link target not followed" : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
      {entries.length > 12 ? (
        <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${formatCount(entries.length)}`}
        </Button>
      ) : null}
    </div>
  )
}

function CleanupRecord({ opId, viewPath }: { opId: string; viewPath: string }) {
  const op = useStore((s) => s.operations[opId])
  const trash = useStore((s) => s.disk.trash)
  const [outcome, setOutcome] = useState<ControlOutcome | null>(null)
  if (!op) return null
  const payload = op.payload as unknown as CleanupPayload
  const settled = isSettled(op.status)
  const inTrash = trash.filter((t) => t.trashedAt === payload.trashedAt && payload.removed.includes(t.originalPath))
  const refusedFolders = [...new Set(payload.refused.map((r) => parentFolder(r.path)))]
  return (
    <Section id="t5-cleanup-record" title="Cleanup record" description={`Last cleanup, started ${formatDateTime(op.createdAt)}. The View records what was removed and what remains.`}>
      <OperationPanel operationId={opId} />
      {settled ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold">Removed to the OS Trash ({formatCount(payload.removed.length)})</h3>
            <p className="text-xs text-pretty text-muted-foreground">Restoring relies on the OS Trash. PlateVault cannot restore files after the Trash is emptied.</p>
          </div>
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold">Refused and still in place ({formatCount(payload.refused.length)})</h3>
            {payload.refused.length > 0 ? (
              <>
                <p className="text-xs text-pretty text-muted-foreground">No permanent-delete fallback exists. Keep the files, or reveal their location to handle them yourself.</p>
                <div className="flex flex-wrap gap-2">
                  {payload.kept.length > 0 ? (
                    <span className="text-xs text-muted-foreground">Kept: {plural(payload.kept.length, "file")} stay where they are.</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => keepRefusedFiles(opId)}>
                      Keep files
                    </Button>
                  )}
                  {refusedFolders.slice(0, 3).map((folder) => (
                    <RevealLocation key={folder} path={folder} label={refusedFolders.length > 1 ? `Reveal ${baseName(folder)}` : "Reveal location"} />
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing was refused.</p>
            )}
          </div>
        </div>
      ) : null}
      {settled && inTrash.length > 0 ? (
        <PrototypeControls outcome={outcome} title="Prototype: OS Trash" description="Stand-in for Finder's Put Back on files this cleanup moved.">
          <ul className="max-h-48 w-full space-y-1 overflow-y-auto text-xs">
            {inTrash.slice(0, 20).map((t) => (
              <li key={t.originalPath} className="flex flex-wrap items-center justify-between gap-2">
                <PathText path={t.originalPath} className="min-w-0 flex-1" />
                <Button size="xs" variant="outline" onClick={() => setOutcome(putBackFromTrash(t.trashedAt, t.originalPath))}>
                  Put back {baseName(t.originalPath)}
                </Button>
              </li>
            ))}
          </ul>
          {inTrash.length > 20 ? <span className="text-xs text-muted-foreground">Showing 20 of {formatCount(inTrash.length)} items in the Trash from {viewPath}.</span> : null}
        </PrototypeControls>
      ) : null}
    </Section>
  )
}
