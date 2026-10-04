/**
 * Verified archive (J28 S1-S5), reviewed filing (J30 S1-S4, S6) and the
 * Transfer page that journals their phases (J28 S5-S9a, J30 S4-S6).
 */
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { ArrowRightLeft, FolderInput } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList, PathText } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState, Notice } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fileAt, fileKey, volumeForPath } from "@/domain/disk"
import { assetAvailability, membershipSummary, viewStatus } from "@/domain/derive"
import type { Catalog, Disk, Session, View } from "@/domain/types"
import { formatBytes, formatCount, formatDuration, formatNight, plural } from "@/lib/format"
import { store, updateSlice, useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { retryTransferItems, startTransfer } from "./lib/operations"
import { type ControlOutcome, overwriteKeepingStat, restoreKeepingStat } from "./lib/prototype"
import {
  emptyDraft,
  PHASE_LABEL,
  type PlanItem,
  type ReferenceChoice,
  recordStatus,
  type TransferDraft,
  type TransferKind,
  type TransferPayload,
  type TransferRecord,
  transferPlan,
  type TransferPlan,
} from "./lib/transfer"
import { PrototypeControls, shortSha } from "./shared"

const COPY: Record<TransferKind, { title: string; description: string; review: string; approve: string; eyebrow: string; pickerTitle: string }> = {
  archive: {
    title: "Archive",
    description: "Move sessions to archive storage in one reviewed transfer that also rebuilds View references. No source is retired before its copy and every affected reference verify.",
    review: "Review transfer",
    approve: "Approve transfer",
    eyebrow: "Storage · Verified archive",
    pickerTitle: "Choose an archive destination",
  },
  filing: {
    title: "File into library",
    description: "Organize selected sessions into a managed library location by approving exactly the file operations shown. Index-in-place stays valid if you do not file.",
    review: "Review filing",
    approve: "Approve filing",
    eyebrow: "Storage · Reviewed filing",
    pickerTitle: "Choose a filing destination",
  },
}

function setDraft(kind: TransferKind, patch: Partial<TransferDraft>) {
  updateSlice("t5", (s) => ({ ...s, [kind]: { ...s[kind], ...patch } }))
}

function membershipLine(view: View, catalog: Catalog): string {
  const content = view.revisions.at(-1)
  if (!content) return "No saved membership"
  const summary = membershipSummary(catalog, content)
  return `${plural(summary.included.frames, "light")} / ${formatDuration(summary.included.seconds)} with ${plural(summary.excluded, "exclusion")}`
}

export function ArchivePage() {
  return <TransferPlanner kind="archive" />
}

export function FilingPage() {
  return <TransferPlanner kind="filing" />
}

function TransferPlanner({ kind }: { kind: TransferKind }) {
  const copy = COPY[kind]
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { sessionIds?: string; viewId?: string }
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const draft = useStore((s) => s.slices.t5[kind])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const blockersRef = useRef<HTMLDivElement>(null)
  const holdId = useId()

  // Search params seed the plan once per link (Sessions → File into library, Storage → Archive).
  useEffect(() => {
    let sessionIds: string[] | null = null
    if (search.sessionIds) sessionIds = search.sessionIds.split(",").filter((id) => catalog.sessions[id])
    else if (search.viewId) {
      const view = catalog.views[search.viewId]
      const included = new Set(view?.revisions.at(-1)?.included ?? [])
      sessionIds = Object.values(catalog.sessions)
        .filter((s) => !s.supersededBy && s.assetIds.some((id) => included.has(id)))
        .map((s) => s.id)
    }
    if (sessionIds) setDraft(kind, { sessionIds, stage: "plan" })
  }, [search.sessionIds, search.viewId])

  const plan = useMemo(() => transferPlan(disk, catalog, kind, draft), [disk, catalog, kind, draft])
  const sessions = Object.values(catalog.sessions)
    .filter((s) => !s.supersededBy && s.imageType === "light")
    .sort((a, b) => a.night.localeCompare(b.night) || (a.channel ?? "").localeCompare(b.channel ?? ""))
  const sessionBytes = (s: Session) => s.assetIds.reduce((sum, id) => sum + (catalog.assets[id]?.sizeBytes ?? 0), 0)
  const sessionAvailable = (s: Session) => s.assetIds.every((id) => {
    const a = catalog.assets[id]
    return a ? assetAvailability(disk, catalog, a) === "available" : false
  })

  const sessionColumns: Column<Session>[] = [
    { id: "night", header: "Night", rowHeader: true, sortValue: (s) => s.night, cell: (s) => formatNight(s.night, true) },
    { id: "target", header: "Target", cell: (s) => (s.target.value ? catalog.targets[s.target.value]?.name : null) ?? s.objectLabel ?? "Unassigned" },
    { id: "channel", header: "Channel", cell: (s) => s.channel ?? "No filter" },
    { id: "frames", header: "Frames", align: "right", sortValue: (s) => s.assetIds.length, cell: (s) => formatCount(s.assetIds.length) },
    { id: "bytes", header: "Size", align: "right", cell: (s) => formatBytes(sessionBytes(s)) },
    {
      id: "availability",
      header: "Availability",
      cell: (s) => (sessionAvailable(s) ? <StatusBadge kind="availability" value="available" /> : <StatusBadge kind="availability" value="offline" label="Offline: cannot be moved now" />),
    },
  ]

  const itemColumns: Column<PlanItem>[] = [
    { id: "file", header: "File", rowHeader: true, sortValue: (i) => i.fileName, cell: (i) => <span className="font-mono text-xs">{i.fileName}</span> },
    { id: "source", header: "Source", cell: (i) => <PathText path={i.sourcePath} truncate className="max-w-72" /> },
    { id: "destination", header: "Destination", cell: (i) => <PathText path={i.destinationPath || "Choose a destination"} className="max-w-96" /> },
    { id: "bytes", header: "Size", align: "right", cell: (i) => formatBytes(i.sizeBytes) },
    { id: "sha", header: "Source SHA-256", cell: (i) => <span className="font-mono text-xs">{shortSha(i.sha256)}</span> },
    {
      id: "status",
      header: "Check",
      cell: (i) =>
        i.problem ? (
          <span className="text-xs text-destructive">{i.problem}</span>
        ) : i.collision ? (
          <span className="text-xs text-destructive">Blocked: destination already exists; nothing is overwritten</span>
        ) : (
          <span className="text-xs text-muted-foreground">{i.destinationPath ? "Ready" : "Needs a destination"}</span>
        ),
    },
  ]

  function review() {
    setAttempted(true)
    if (plan.blockers.length > 0) {
      requestAnimationFrame(() => blockersRef.current?.focus())
      return
    }
    setDraft(kind, { stage: "review", reviewedShas: Object.fromEntries(plan.items.map((i) => [i.assetId, i.sha256])) })
  }

  const alreadyIndexed = plan.items.length
  const header = <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />

  if (draft.stage === "review" && plan.blockers.length === 0) {
    // Rows show the digests frozen at review; a source changed since then is flagged and will be blocked, never silently re-planned.
    const reviewedRows = plan.items.map((i) => {
      const reviewed = draft.reviewedShas?.[i.assetId]
      return reviewed && reviewed !== i.sha256 ? { ...i, sha256: reviewed, problem: "Source changed since review: this item will be blocked and its source kept" } : i
    })
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <PageBody>
          <Section
            id="t5-transfer-review"
            title={copy.review}
            description="Exactly these operations and reference changes. Nothing runs that is not listed here."
            actions={
              <>
                <Button variant="outline" onClick={() => setDraft(kind, { stage: "plan" })}>
                  Back to plan
                </Button>
                <Button onClick={() => setConfirmOpen(true)}>{copy.approve}</Button>
              </>
            }
          >
            <KeyValueList
              columns={2}
              items={[
                { label: "Sessions", value: plan.sessions.map((s) => `${formatNight(s.night)} ${s.channel ?? ""}`.trim()).join(", ") },
                { label: "Files", value: `${formatCount(plan.items.length)} (${formatBytes(plan.bytes)})` },
                { label: "Destination", value: plan.destination, mono: true },
                { label: "Volume identity", value: `${plan.volume?.name} · ${plan.volume?.volumeUuid}`, mono: true },
                { label: "Transfer", value: plan.sameVolume ? "Same-volume move: no extra space needed" : "Cross-volume verified copy, then source retirement" },
                { label: "Expected reclaim", value: formatBytes(plan.expectedReclaimBytes), source: "Observed reclaim is reported separately" },
              ]}
            />
            <ReferenceSummary plan={plan} editable={false} kind={kind} />
            <DataTable label="Operations to approve" rows={reviewedRows} columns={itemColumns} getRowId={(i) => i.assetId} />
            <FixedByPlan views={plan.affectedViews} />
          </Section>
        </PageBody>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`${copy.approve}: ${plural(plan.items.length, "file")}?`}
          description={`Each item is copied, durably written and hash-verified against its source snapshot. Its source is retired only when the snapshot, destination and every affected reference still verify immediately before retirement.`}
          changes={[
            `${plan.sameVolume ? "Move" : "Copy"} ${plural(plan.items.length, "file")} to ${plan.destination}`,
            ...plan.references.map((r) => `${r.viewName}: ${r.effect}`),
            "Retire each source only after its destination and references verify",
          ]}
          unchanged={[
            "Session boundaries and View membership, including exclusions",
            "Original basenames; no header is patched",
            "Any file already at a destination path is never overwritten",
            "A failed, interrupted or drifted item keeps its source",
          ]}
          confirmLabel={copy.approve}
          onConfirm={() => {
            const opId = startTransfer(kind, plan, draft)
            setDraft(kind, { ...emptyDraft() })
            navigate({ to: "/storage/transfers/$operationId", params: { operationId: opId } })
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <PageBody>
        <Section id="t5-transfer-sessions" title="Sessions" description={search.viewId && catalog.views[search.viewId] ? `Member sessions of ${catalog.views[search.viewId]!.name} are preselected.` : "Choose the sessions to move. Offline sessions cannot be read now."}>
          <DataTable
            label="Light sessions"
            rows={sessions}
            columns={sessionColumns}
            getRowId={(s) => s.id}
            className="max-h-80"
            selection={{
              selected: draft.sessionIds,
              onChange: (ids) => setDraft(kind, { sessionIds: ids, stage: "plan" }),
              rowLabel: (s) => `${formatNight(s.night)} ${s.channel ?? ""}`,
              isSelectable: (s) => sessionAvailable(s) || draft.sessionIds.includes(s.id),
            }}
            empty={<EmptyState icon={FolderInput} title="No light sessions indexed" description="Index a capture location first." action={<Button render={<Link to="/settings/locations" />}>Open Locations</Button>} />}
          />
        </Section>

        <Section
          id="t5-transfer-destination"
          title="Destination"
          actions={
            <Button variant="outline" onClick={() => setPickerOpen(true)}>
              {draft.destination ? "Choose another destination" : "Choose destination"}
            </Button>
          }
        >
          {draft.destination ? (
            <KeyValueList
              columns={2}
              items={[
                { label: "Folder", value: draft.destination, mono: true },
                { label: "Volume", value: plan.volume ? `${plan.volume.name} (${plan.volume.mounted ? "mounted" : "offline"})` : "No volume at this path" },
                { label: "Volume identity", value: plan.volume ? plan.volume.volumeUuid : "Unknown", mono: true },
                {
                  label: "Chosen for this plan",
                  value:
                    plan.volumeState === "different-volume" ? (
                      <span className="text-destructive">Conflict: identity {draft.intendedVolumeUuid} was chosen</span>
                    ) : (
                      <span>Matches {draft.intendedVolumeUuid}</span>
                    ),
                },
                { label: "Free space", value: plan.freeBytes !== null ? formatBytes(plan.freeBytes) : "Unknown while offline" },
                { label: "Writable", value: plan.volume?.mounted ? (plan.volumeState === "read-only" ? "No" : "Yes") : "Unknown while offline" },
                { label: "Registered location", value: plan.location ? `${plan.location.displayName}${kind === "filing" ? (plan.location.managed ? " · accepts reviewed filing" : " · does not accept filing") : ""}` : "None" },
                { label: "Transfer footprint", value: plan.sameVolume ? "Same-volume move: no extra space" : formatBytes(plan.bytes) },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No destination chosen. {kind === "archive" ? "Choose a folder on the archive volume." : "Choose a folder in a location that accepts reviewed filing."}</p>
          )}
          {plan.volumeState === "different-volume" ? (
            <Notice tone="refusal" title="Different volume at the destination path">
              {plan.volumeMessage}
            </Notice>
          ) : null}
        </Section>

        {plan.items.length > 0 ? (
          <Section
            id="t5-transfer-items"
            title="Planned operations"
            description={`${plural(plan.items.length, "file")}, ${formatBytes(plan.bytes)}. ${kind === "filing" ? `These ${formatCount(alreadyIndexed)} files are already indexed: filing moves them and does not re-index. ` : ""}Original basenames stay; every source and destination is listed.`}
          >
            <DataTable label="Planned operations" rows={plan.items} columns={itemColumns} getRowId={(i) => i.assetId} className="max-h-96" />
          </Section>
        ) : null}

        <ReferenceSummary plan={plan} editable kind={kind} />
        <FixedByPlan views={plan.affectedViews} />

        <div ref={blockersRef} tabIndex={-1} className="outline-none">
          {plan.blockers.length > 0 ? (
            <Notice tone={attempted ? "refusal" : "warning"} title={attempted ? `${copy.review} blocked` : "Before review"}>
              <ul className="list-disc space-y-1 pl-5">
                {plan.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={review}>{copy.review}</Button>
          <span className="text-xs text-muted-foreground">Review re-reads the destination and lists exactly what will run.</span>
        </div>

        <PrototypeControls title="Prototype: transfer fault" description="J28 P5: pause one item after destination verification and before source retirement.">
          <Label id={holdId} className="text-xs">
            Hold before retirement
          </Label>
          <Select
            items={[{ value: "none", label: "No hold" }, ...plan.items.map((i) => ({ value: i.assetId, label: `${formatNight(catalog.sessions[i.sessionId]?.night ?? "")} · ${i.fileName}` }))]}
            value={draft.holdAssetId ?? "none"}
            onValueChange={(v) => setDraft(kind, { holdAssetId: v === "none" ? null : (v as string) })}
          >
            <SelectTrigger aria-labelledby={holdId} size="sm" className="w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No hold</SelectItem>
              {plan.items.map((i) => (
                <SelectItem key={i.assetId} value={i.assetId}>
                  {formatNight(catalog.sessions[i.sessionId]?.night ?? "")} · {i.fileName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PrototypeControls>
      </PageBody>

      <FolderPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={copy.pickerTitle}
        initialPath={draft.destination ?? (kind === "archive" ? "/Volumes/Archive" : (Object.values(catalog.locations).find((l) => l.managed && l.role === "captures")?.path ?? null))}
        onChoose={(path) => {
          const s = store.getState()
          const volumeId = volumeForPath(s.disk, path)
          setDraft(kind, { destination: path, intendedVolumeUuid: volumeId ? (s.disk.volumes[volumeId]?.volumeUuid ?? null) : null, stage: "plan" })
        }}
      />
    </div>
  )
}

function ReferenceSummary({ plan, editable, kind }: { plan: TransferPlan; editable: boolean; kind: TransferKind }) {
  if (plan.references.length === 0) {
    return plan.affectedViews.length > 0 ? (
      <Section id="t5-transfer-refs" title="Affected View references" description="These Views include moved frames but have no prepared entries to rebuild.">
        <p className="text-sm text-muted-foreground">No references to update.</p>
      </Section>
    ) : null
  }
  return (
    <Section id="t5-transfer-refs" title="Affected View references" description="Each View's current and proposed reference mode. No mode is chosen for you.">
      <ul className="space-y-3">
        {plan.references.map((ref) => (
          <li key={ref.viewId} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{ref.viewName}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {plural(ref.entries.length, "entry", "entries")} · current mode: {ref.mode}
              </span>
            </div>
            <p className="text-sm text-pretty">{ref.effect}</p>
            {ref.needsChoice ? (
              editable ? (
                <fieldset className="space-y-1.5">
                  <legend className="text-xs font-medium text-muted-foreground">How {ref.viewName} references are rebuilt</legend>
                  <RadioGroup value={ref.choice ?? ""} onValueChange={(v) => updateSlice("t5", (s) => ({ ...s, [kind]: { ...s[kind], referenceModes: { ...s[kind].referenceModes, [ref.viewId]: v as ReferenceChoice }, stage: "plan" } }))}>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="symlink" id={`${ref.viewId}-symlink`} />
                      <Label htmlFor={`${ref.viewId}-symlink`} className="font-normal">
                        Symlink to the transferred file
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="keep-local" id={`${ref.viewId}-keep`} />
                      <Label htmlFor={`${ref.viewId}-keep`} className="font-normal">
                        Keep the local hardlink (its bytes stay on the source volume and are not reclaimed)
                      </Label>
                    </div>
                  </RadioGroup>
                </fieldset>
              ) : (
                <p className="text-xs text-muted-foreground">Chosen: {ref.choice === "symlink" ? "symlink to the transferred file" : "keep the local hardlink"}</p>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function FixedByPlan({ views }: { views: View[] }) {
  const catalog = useStore((s) => s.catalog)
  if (views.length === 0) return null
  return (
    <Section id="t5-transfer-fixed" title="Fixed by this plan" description="Membership and exclusions stay exactly as they are. Reference repair does not reopen a View or create a revision.">
      <ul className="divide-y rounded-lg border text-sm">
        {views.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="font-medium">{v.name}</span>
            <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
              {membershipLine(v, catalog)}
              <StatusBadge kind="view" value={viewStatus(catalog, v)} />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Transfer page
// ---------------------------------------------------------------------------

export function TransferPage() {
  const { operationId } = useParams({ strict: false }) as { operationId?: string }
  const op = useStore((s) => (operationId ? s.operations[operationId] : undefined))
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ControlOutcome | null>(null)
  if (!op || (op.kind !== "archive" && op.kind !== "filing")) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Transfer" />
        <PageBody>
          <EmptyState titleAs="h2" icon={ArrowRightLeft} title="Transfer not found" description="This transfer is not recorded. It may belong to data that was reset." action={<Button render={<Link to="/storage" />}>Open Storage</Button>} />
        </PageBody>
      </div>
    )
  }
  const payload = op.payload as unknown as TransferPayload
  const records = payload.records
  const count = (fn: (r: TransferRecord) => boolean) => records.filter(fn).length
  // Exclusive buckets: every item is in exactly one, so the counts add up to the item total.
  const phases = [
    { label: "Pending", value: count((r) => !r.blocked && r.uncertain === null && (r.phase === "pending" || r.phase === "copied" || r.phase === "written")) },
    { label: "Uncertain", value: count((r) => !r.blocked && r.uncertain !== null) },
    { label: "Destination verified", value: count((r) => !r.blocked && r.phase === "verified") },
    { label: "Reference updated", value: count((r) => !r.blocked && r.phase === "referenced") },
    { label: "Source retired", value: count((r) => r.phase === "retired") },
    { label: "Blocked", value: count((r) => r.blocked !== null) },
  ]
  const views = (op.scope.viewIds ?? []).map((id) => catalog.views[id]).filter((v): v is View => v !== undefined)
  const held = op.status === "paused" && payload.held ? records.find((r) => r.assetId === payload.holdAssetId) : undefined
  // J28 S9a: a drifted item keeps the same prototype control, so its saved bytes can be put back before Retry.
  const controlled = held ?? records.find((r) => r.blocked?.kind === "drift")
  const keptLocal = records.some((r) => r.references.some((ref) => ref.action === "keep-local"))
  const retryable = records.filter((r) => r.blocked && r.blocked.kind !== "drift").map((r) => r.id)
  const evidence = records.find((r) => r.id === evidenceFor) ?? null

  const columns: Column<TransferRecord>[] = [
    { id: "file", header: "File", rowHeader: true, sortValue: (r) => r.fileName, cell: (r) => <span className="font-mono text-xs">{r.fileName}</span> },
    { id: "phase", header: "Phase", sortValue: (r) => r.phase, cell: (r) => <span className="text-xs">{PHASE_LABEL[r.phase]}</span> },
    { id: "status", header: "Status", cell: (r) => <StatusBadge kind="item" value={recordStatus(r, op.status === "running")} /> },
    {
      id: "detail",
      header: "Detail",
      cell: (r) => <span className="text-xs text-pretty">{r.blocked?.reason ?? r.uncertain ?? (r.phase === "retired" ? "Source retired after destination and references verified." : "")}</span>,
    },
    {
      id: "refs",
      header: "References",
      cell: (r) =>
        r.references.length === 0 ? (
          <span className="text-xs text-muted-foreground">None</span>
        ) : (
          <span className="text-xs tabular-nums">
            {(["completed", "blocked", "uncertain", "pending"] as const)
              .map((status) => ({ status, n: r.references.filter((x) => x.status === status).length }))
              .filter((x) => x.n > 0)
              .map((x) => `${x.n} ${x.status}`)
              .join(" · ")}
          </span>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (r) => (
        <span className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" aria-label={`Review evidence for ${r.fileName}`} onClick={() => setEvidenceFor(r.id)}>
            Review evidence
          </Button>
          {r.blocked && r.blocked.kind !== "drift" ? (
            <Button size="xs" variant="outline" aria-label={`Retry ${r.fileName}`} onClick={() => retryTransferItems(op.id, [r.id])}>
              Retry item
            </Button>
          ) : null}
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader eyebrow={op.kind === "archive" ? "Storage · Verified archive" : "Storage · Reviewed filing"} title={op.title} meta={<StatusBadge kind="operation" value={op.status} />} />
      <PageBody>
        <OperationPanel operationId={op.id} itemLimit={0} onRetry={retryable.length > 0 ? () => retryTransferItems(op.id, retryable) : undefined} />
        {isSettled(op.status) && records.some((r) => r.blocked?.kind === "drift") ? (
          <Notice tone="warning" title="Source drift needs review">
            Retry skips drifted items. Open Review evidence for each, compare the current source with the verified snapshot, and retry from there.
          </Notice>
        ) : null}

        <Section id="t5-transfer-phases" title="Recorded phases" description="Every item is in exactly one phase, and every phase is journaled. Retry resumes this record and never trusts a file name alone.">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {phases.map((p) => (
              <div key={p.label} className="rounded-md border px-3 py-2">
                <dt className="text-xs text-muted-foreground">{p.label}</dt>
                <dd className="text-base font-semibold tabular-nums">{formatCount(p.value)}</dd>
              </div>
            ))}
          </dl>
          <KeyValueList
            columns={2}
            items={[
              { label: "Sources retained", value: `${formatCount(count((r) => r.phase !== "retired"))} of ${formatCount(records.length)}` },
              { label: "Destination", value: payload.destination, mono: true },
              { label: "Destination identity", value: payload.destinationVolumeUuid, mono: true },
              { label: "Expected reclaim", value: payload.sameVolume ? "None: same-volume move" : formatBytes(payload.expectedReclaimBytes) },
              {
                label: "Observed reclaim",
                value: payload.sameVolume ? "None: same-volume move" : formatBytes(payload.observedReclaimBytes),
                ...(keptLocal ? { source: "Hardlinks kept locally still hold bytes" } : {}),
              },
              ...(payload.revalidated ? [{ label: "Last revalidation", value: payload.revalidated }] : []),
            ]}
          />
        </Section>

        {controlled ? (
          <PrototypeControls
            outcome={outcome}
            title={held ? "Prototype: held item" : "Prototype: drifted item"}
            description={
              held
                ? `J28 P5: ${held.fileName} is verified and awaiting retirement. Change its source now, then Resume above.`
                : `J28 P5: ${controlled.fileName} is blocked by source drift. Put back its saved bytes, then open Review evidence and retry it.`
            }
          >
            <PathText path={controlled.sourcePath} className="w-full" />
            <Button size="sm" variant="outline" onClick={() => setOutcome(overwriteKeepingStat(controlled.sourcePath))}>
              Overwrite source (same size and mtime)
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOutcome(restoreKeepingStat(controlled.sourcePath))}>
              Restore saved bytes
            </Button>
          </PrototypeControls>
        ) : null}

        <Section id="t5-transfer-records" title="Items" description="Per item: phase, outcome and reference status.">
          <DataTable label="Transfer items" rows={records} columns={columns} getRowId={(r) => r.id} className="max-h-[32rem]" />
        </Section>

        <Section id="t5-transfer-views" title="Affected Views" description="Membership, exclusions and status are unchanged by this transfer.">
          {views.length === 0 ? (
            <p className="text-sm text-muted-foreground">No View includes these frames.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {views.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <Link to="/views/$viewId/results" params={{ viewId: v.id }} className="font-medium text-primary hover:underline">
                    {v.name}
                  </Link>
                  <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                    {membershipLine(v, catalog)}
                    <StatusBadge kind="view" value={viewStatus(catalog, v)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageBody>

      <Dialog open={evidence !== null} onOpenChange={(open) => !open && setEvidenceFor(null)}>
        <DialogContent className="sm:max-w-2xl">
          {evidence ? (
            <>
              <DialogHeader>
                <DialogTitle>Evidence for {evidence.fileName}</DialogTitle>
                <DialogDescription>Current values read from the disk now, beside the snapshot this transfer copied and verified.</DialogDescription>
              </DialogHeader>
              <EvidenceBody record={evidence} payload={payload} disk={disk} />
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
                {evidence.blocked ? (
                  <Button
                    onClick={() => {
                      retryTransferItems(op.id, [evidence.id])
                      setEvidenceFor(null)
                    }}
                  >
                    Retry with current evidence
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EvidenceBody({ record, payload, disk }: { record: TransferRecord; payload: TransferPayload; disk: Disk }) {
  const source = fileAt(disk, record.sourcePath)
  const destination = disk.files[fileKey(payload.destinationVolumeId, record.destinationPath)]
  const destinationMounted = disk.volumes[payload.destinationVolumeId]?.mounted
  const sourceMatches = source && record.snapshotSha ? source.sha256 === record.snapshotSha : null
  return (
    <div className="space-y-3">
      {record.blocked ? (
        <Notice tone="warning" title="Blocked">
          {record.blocked.reason}
        </Notice>
      ) : null}
      <KeyValueList
        items={[
          { label: "Phase", value: PHASE_LABEL[record.phase] },
          { label: "SHA-256 at review", value: record.planSha, mono: true },
          { label: "Snapshot copied", value: record.snapshotSha ?? "Not copied yet", mono: true },
          {
            label: "Source now",
            value:
              record.phase === "retired" ? (
                "Retired after verification"
              ) : source ? (
                <>
                  {source.sha256}
                  {sourceMatches === false ? <span className="font-sans font-medium text-destructive"> (differs from snapshot)</span> : sourceMatches ? " (matches snapshot)" : ""}
                </>
              ) : (
                "Not found"
              ),
            mono: true,
          },
          {
            label: "Destination now",
            value: !destinationMounted ? (
              "Offline"
            ) : destination ? (
              <>
                {destination.sha256}
                {destination.sha256 === record.snapshotSha ? " (matches snapshot)" : <span className="font-sans font-medium text-destructive"> (does not match)</span>}
              </>
            ) : (
              "Not written"
            ),
            mono: true,
          },
          { label: "Source path", value: record.sourcePath, mono: true },
          { label: "Destination path", value: record.destinationPath, mono: true },
        ]}
      />
      {record.references.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">References</h3>
          <ul className="space-y-1 text-xs">
            {record.references.map((ref) => (
              <li key={ref.entryPath} className="flex flex-wrap items-start justify-between gap-2">
                <PathText path={ref.entryPath} className="min-w-0 flex-1" />
                <span className="text-muted-foreground">
                  {ref.status}
                  {ref.detail ? `: ${ref.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
