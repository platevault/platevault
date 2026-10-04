/**
 * Results area of the View workspace (spec 070; J26 S1-S4, S7, S7a; J27 S1-S3).
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { FileSearch, Inbox, Paperclip } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList, PathText } from "@/components/app/data"
import { type Column, DataTable, SelectionBar } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice, SaveState } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge, type StatusValue } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { stableHash } from "@/domain/indexing"
import type { DiskFile, ResultKind, ResultRecord, View } from "@/domain/types"
import { formatBytes, formatCount, formatDateTime, plural } from "@/lib/format"
import { nowIso, store, useStore } from "@/store/core"
import { unsettledOperationsForView } from "@/store/operations"
import { acceptResults, attachResult, markComplete, recordRehash, saveViewNotes } from "./lib/actions"
import {
  baseName,
  dependentViews,
  kindLabel,
  OUTPUT_ROLE_LABEL,
  type OutputRole,
  outputInventory,
  outputLocation,
  pathAvailability,
  RESULT_KIND_LABEL,
  type ResultRow,
  resultRowsForView,
} from "./lib/files"
import { type ControlOutcome, finishWriting, overwriteKeepingStat, restoreKeepingStat, saveExternalImage, simulateApplicationOutput } from "./lib/prototype"
import { FileChooser, PrototypeControls, shortSha } from "./shared"

const REUSABLE_KINDS: ResultKind[] = ["linear-integration", "channel-product", "mosaic-panel"]
const REHASH_MS = 650

/**
 * Rehash accepted products against their acceptance digest (RES-FR-05,
 * RES-AC-09). Until it finishes they read Verifying and are not offered.
 * Equal size and modification time never stand in for this check.
 */
function useRehash(ids: string[], trigger: number) {
  const [verifying, setVerifying] = useState(ids.length > 0)
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null)
  const key = ids.join(",")
  useEffect(() => {
    if (ids.length === 0) {
      setVerifying(false)
      return
    }
    setVerifying(true)
    const timer = window.setTimeout(() => {
      const { disk, catalog } = store.getState()
      const outcomes: Array<{ id: string; state: ResultRecord["contentState"] }> = []
      for (const id of ids) {
        const record = catalog.results[id]
        const file = record ? pathAvailability(disk, record.path).file : undefined
        // An unavailable product cannot be rehashed; its last recorded state stands.
        if (record && file) outcomes.push({ id, state: file.sha256 === record.sha256 ? "unchanged" : "drifted" })
      }
      recordRehash(outcomes)
      setVerifiedAt(nowIso())
      setVerifying(false)
    }, REHASH_MS)
    return () => window.clearTimeout(timer)
  }, [key, trigger])
  return { verifying, verifiedAt }
}

type ProductState = "verifying" | "drifted" | "unchanged" | "offline" | "absent"

function productState(row: ResultRow, verifying: boolean): ProductState {
  if (row.availability === "offline") return "offline"
  if (row.availability === "absent") return "absent"
  if (verifying) return "verifying"
  return row.record?.contentState === "drifted" ? "drifted" : "unchanged"
}

function ProductStateBadge({ state }: { state: ProductState }) {
  if (state === "verifying") return <StatusBadge kind="operation" value="running" label="Verifying" />
  if (state === "offline") return <StatusBadge kind="availability" value="offline" />
  if (state === "absent") return <StatusBadge kind="availability" value="absent" />
  return <StatusBadge kind="content" value={state} />
}

function AssociationText({ row }: { row: ResultRow }) {
  return row.association === "user-linked" ? (
    <StatusBadge kind="lineage" value="user-linked" />
  ) : (
    <span className="text-xs text-muted-foreground">Recorded output location</span>
  )
}

export function ResultsPage() {
  const { viewId } = useParams({ strict: false }) as { viewId?: string }
  const view = useStore((s) => (viewId ? s.catalog.views[viewId] : undefined))
  if (!view) {
    return (
      <PageBody>
        <EmptyState titleAs="h2" icon={Inbox} title="View not found" description="This View does not exist in the catalog." action={<Button render={<Link to="/views" />}>Open Views</Button>} />
      </PageBody>
    )
  }
  return <ResultsArea view={view} />
}

function ResultsArea({ view }: { view: View }) {
  const navigate = useNavigate()
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const rows = useMemo(() => resultRowsForView(disk, catalog, view), [disk, catalog, view])
  const candidates = rows.filter((r) => r.acceptance === "candidate")
  const accepted = rows.filter((r) => r.acceptance === "accepted")
  const productInputIds = view.revisions.at(-1)?.productInputs ?? []
  const rehashIds = useMemo(() => [...new Set([...accepted.map((r) => r.id), ...productInputIds])], [accepted.map((r) => r.id).join(","), productInputIds.join(",")])
  const [rehashTrigger, setRehashTrigger] = useState(0)
  const rehash = useRehash(rehashIds, rehashTrigger)
  const root = outputLocation(catalog, view)
  const inventory = root ? outputInventory(disk, root) : null
  const profile = view.profileId ? catalog.profiles[view.profileId] : null
  const appName = profile?.name ?? "the external application"

  const [selected, setSelected] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [acceptedSelection, setAcceptedSelection] = useState<string[]>([])
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeRefusal, setCompleteRefusal] = useState<string | null>(null)
  const complete = Boolean(view.completedAt)

  const selectedRows = candidates.filter((r) => selected.includes(r.id))
  const acceptable = (r: ResultRow) => r.processingState === "written" && r.kind !== null && r.availability === "available"
  const activeRow = rows.find((r) => r.id === active) ?? null

  const candidateColumns: Column<ResultRow>[] = [
    {
      id: "file",
      header: "File",
      rowHeader: true,
      sortValue: (r) => r.fileName,
      cell: (r) => (
        <Button variant="link" size="sm" className="h-auto px-0 font-normal" aria-label={`Inspect ${r.fileName}`} onClick={() => setActive(r.id)}>
          {r.fileName}
        </Button>
      ),
    },
    { id: "kind", header: "Kind", sortValue: (r) => kindLabel(r.kind, r.channel), cell: (r) => (r.kind ? kindLabel(r.kind, r.channel) : <span className="text-muted-foreground">Not known yet</span>) },
    { id: "processing", header: "Processing", cell: (r) => <StatusBadge kind="processing" value={r.processingState} /> },
    { id: "association", header: "View association", cell: (r) => <AssociationText row={r} /> },
    { id: "lineage", header: "Lineage", cell: (r) => <StatusBadge kind="lineage" value={r.lineage} /> },
    { id: "availability", header: "Availability", cell: (r) => <StatusBadge kind="availability" value={r.availability} /> },
    { id: "acceptance", header: "Acceptance", cell: () => <StatusBadge kind="acceptance" value="candidate" /> },
  ]

  const acceptedColumns: Column<ResultRow>[] = [
    {
      id: "file",
      header: "File",
      rowHeader: true,
      sortValue: (r) => r.fileName,
      cell: (r) => (
        <Button variant="link" size="sm" className="h-auto px-0 font-normal" aria-label={`Inspect ${r.fileName}`} onClick={() => setActive(r.id)}>
          {r.fileName}
        </Button>
      ),
    },
    { id: "kind", header: "Kind", cell: (r) => kindLabel(r.kind, r.channel) },
    { id: "accepted", header: "Accepted", sortValue: (r) => r.acceptedAt ?? "", cell: (r) => (r.acceptedAt ? formatDateTime(r.acceptedAt) : "—") },
    { id: "sha", header: "SHA-256 at acceptance", cell: (r) => <span className="font-mono text-xs">{shortSha(r.acceptedSha)}</span> },
    { id: "lineage", header: "Lineage", cell: (r) => <StatusBadge kind="lineage" value={r.lineage} /> },
    { id: "content", header: "Content", cell: (r) => <ProductStateBadge state={productState(r, rehash.verifying)} /> },
    { id: "custody", header: "Cleanup", cell: () => <StatusBadge kind="custody" value="keep" /> },
  ]

  function startComplete() {
    const blocking = unsettledOperationsForView(store.getState(), view.id)
    if (blocking.length > 0) {
      setCompleteRefusal(
        `Mark processing complete refused: ${blocking.map((op) => op.title).join(", ")} ${blocking.length === 1 ? "is" : "are"} not settled for this View. Complete waits until ${blocking.length === 1 ? "it settles" : "they settle"}.`,
      )
      return
    }
    setCompleteRefusal(null)
    setCompleteOpen(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        level={2}
        title="Results"
        description="Files the application wrote into this View's output location, and Results you attached. Nothing is accepted until you accept it."
        meta={complete ? <StatusBadge kind="view" value="complete" /> : null}
        actions={
          <>
            <Button variant="outline" onClick={() => setAttachOpen(true)}>
              <Paperclip aria-hidden="true" data-icon="inline-start" />
              Attach Result
            </Button>
            {complete ? (
              <Button render={<Link to="/views/$viewId/cleanup" params={{ viewId: view.id }} />}>Clean up View</Button>
            ) : (
              <Button onClick={startComplete}>Mark processing complete</Button>
            )}
          </>
        }
      />
      <PageBody>
        {completeRefusal ? (
          <Notice tone="refusal" title="Mark processing complete refused" actions={<Button size="sm" variant="outline" render={<Link to="/activity" />}>Open Activity</Button>}>
            {completeRefusal}
          </Notice>
        ) : null}

        {root ? (
          <Notice tone={inventory?.availability === "offline" ? "offline" : "info"} title="Recorded output location">
            <PathText path={root} />
            <span className="text-xs text-muted-foreground tabular-nums">
              {inventory?.availability === "offline"
                ? "Offline: discovered files cannot be read until the volume is connected."
                : `${plural(candidates.filter((c) => c.discovered === "output-location").length, "product candidate")} · ${plural(
                    candidates.filter((c) => c.processingState === "pending").length,
                    "file",
                  )} still being written · ${plural(inventory?.files.filter((f) => f.role !== "product").length ?? 0, "other file")}`}
            </span>
          </Notice>
        ) : null}

        <Section
          id="t5-candidates"
          title="Result candidates"
          description="A file in the output folder is not accepted by being there, and nothing claims it used the whole reviewed selection."
        >
          {!root && candidates.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="No output location yet"
              description="Results lists what the application writes into this View's output folder. Prepare the View, or attach a file saved elsewhere."
              action={<Button render={<Link to="/views/$viewId/prepare" params={{ viewId: view.id }} />}>Open Prepare</Button>}
            />
          ) : (
            <div className="space-y-2">
              <SelectionBar
                count={selected.length}
                noun="candidate"
                onClear={() => setSelected([])}
                actions={
                  <Button
                    size="sm"
                    disabled={selectedRows.length === 0 || !selectedRows.every(acceptable)}
                    onClick={() => {
                      setAcceptError(null)
                      setAcceptOpen(true)
                    }}
                  >
                    Accept Result{selectedRows.length > 1 ? ` (${selectedRows.length})` : ""}
                  </Button>
                }
              />
              {selectedRows.some((r) => !acceptable(r)) ? (
                <p className="text-xs text-muted-foreground">Accept Result is unavailable: a selected file is still being written, unavailable, or has no kind.</p>
              ) : null}
              {acceptError ? <ActionError message={acceptError} onRetry={() => setAcceptOpen(true)} /> : null}
              <DataTable
                label="Result candidates"
                rows={candidates}
                columns={candidateColumns}
                getRowId={(r) => r.id}
                activeRowId={active}
                scroll="none"
                selection={{
                  selected,
                  onChange: setSelected,
                  rowLabel: (r) => r.fileName,
                  isSelectable: (r) => r.processingState !== "pending",
                }}
                empty={
                  <EmptyState
                    icon={Inbox}
                    title="Nothing in the output location yet"
                    description={`When ${appName} writes files into the output folder, they appear here as candidates.`}
                    action={
                      <Button variant="outline" onClick={() => setAttachOpen(true)}>
                        Attach Result
                      </Button>
                    }
                  />
                }
              />
              {candidates.some((c) => c.processingState === "pending") ? (
                <p className="text-xs text-muted-foreground">Pending files are still being written and cannot be selected until they finish.</p>
              ) : null}
            </div>
          )}
        </Section>

        {activeRow ? <ResultDetail row={activeRow} verifying={rehash.verifying} onClose={() => setActive(null)} /> : null}

        <Section
          id="t5-accepted"
          title="Accepted Results"
          description="Accepted products appear on this View, its Project and its Target, and stay in Keep during cleanup."
          actions={
            <Button size="sm" variant="outline" disabled={!Object.values(catalog.results).some((r) => r.acceptance === "accepted")} onClick={() => {
              setRehashTrigger((n) => n + 1)
              setPickerOpen(true)
            }}>
              Create View from results
            </Button>
          }
        >
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {rehash.verifying ? "Verifying accepted products against their acceptance digests…" : rehash.verifiedAt ? `Rehashed against acceptance digests at ${formatDateTime(rehash.verifiedAt)}.` : ""}
          </p>
          <DataTable
            label="Accepted Results"
            rows={accepted}
            columns={acceptedColumns}
            getRowId={(r) => r.id}
            activeRowId={active}
            scroll="none"
            selection={{ selected: acceptedSelection, onChange: setAcceptedSelection, rowLabel: (r) => r.fileName }}
            empty={<p className="p-4 text-sm text-muted-foreground">No accepted Results yet. Select candidates above and choose Accept Result.</p>}
          />
        </Section>

        {productInputIds.length > 0 ? <ProductInputs ids={productInputIds} verifying={rehash.verifying} /> : null}

        {inventory && inventory.files.length > 0 ? <OutputFiles files={inventory.files.filter((f) => f.role !== "product")} viewId={view.id} /> : null}

        <Section id="t5-completion" title="Completion" description="Complete records that this processing attempt is finished. It is independent of accepted Results and of cleanup.">
          {complete ? (
            <KeyValueList
              items={[
                { label: "Status", value: <StatusBadge kind="view" value="complete" /> },
                { label: "Marked complete", value: formatDateTime(view.completedAt!) },
                { label: "What it means", value: `The attempt is finished. It does not say that ${appName} stopped or succeeded, and nothing was removed.` },
                { label: "Membership", value: "New membership or preparation revisions need Reopen in the View header." },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Not Complete. Mark processing complete when you are done with this attempt; Clean up View is a separate action.</p>
          )}
        </Section>

        <NotesSection view={view} />

        <ResultsPrototypeControls view={view} root={root} accepted={accepted} onChanged={() => setRehashTrigger((n) => n + 1)} />
      </PageBody>

      <ConfirmDialog
        open={acceptOpen}
        onOpenChange={setAcceptOpen}
        title={`Accept ${selectedRows.length === 1 ? "this Result" : `${selectedRows.length} Results`}?`}
        description={selectedRows.map((r) => `${r.fileName} (${kindLabel(r.kind, r.channel)})`).join(", ")}
        changes={[
          "Record each product's SHA-256 as its acceptance digest",
          "Show the products on this View, its Project and its Target",
          "Keep them protected in cleanup",
        ]}
        unchanged={[
          "Lineage values stay as recorded; acceptance never upgrades them",
          `Acceptance does not claim that all ${formatCount(view.revisions.at(-1)?.included.length ?? 0)} planned frames were used`,
          "No file is moved or changed",
        ]}
        confirmLabel={`Accept ${selectedRows.length === 1 ? "Result" : `${selectedRows.length} Results`}`}
        onConfirm={() => {
          const result = acceptResults(view, selectedRows)
          if (result.ok) {
            setSelected([])
            setAcceptError(null)
          } else setAcceptError(result.message)
          return result
        }}
      />

      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="Mark processing complete?"
        description={`${view.name} will read Complete${accepted.length === 0 ? " with no accepted Result" : ""}.`}
        changes={["The View reads Complete", "Creating a new membership or preparation revision needs Reopen"]}
        unchanged={[
          "No file is removed and cleanup does not start",
          accepted.length === 0 ? "No Result is required" : `${plural(accepted.length, "accepted Result")} unchanged`,
          `PlateVault does not infer that ${appName} stopped or succeeded`,
          "Notes, Result acceptance and reviewed cleanup stay available",
        ]}
        confirmLabel="Mark processing complete"
        onConfirm={() => {
          const result = markComplete(view)
          if (!result.ok && result.reason === "blocked") {
            setCompleteRefusal(result.message)
            return { ok: true }
          }
          return result.ok ? result : { ok: false, reason: result.reason as "write-failed" | "stale", message: result.message }
        }}
      />

      <AttachDialog open={attachOpen} onOpenChange={setAttachOpen} view={view} />
      <ResultPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        preselected={acceptedSelection}
        verifying={rehash.verifying}
        onCreate={(ids) => navigate({ to: "/views/new", search: { from: "results", resultIds: ids.join(",") } })}
        onAdd={(targetViewId, ids) => navigate({ to: "/views/new", search: { viewId: targetViewId, resultIds: ids.join(",") } })}
      />
    </div>
  )
}

function ResultDetail({ row, verifying, onClose }: { row: ResultRow; verifying: boolean; onClose: () => void }) {
  const catalog = useStore((s) => s.catalog)
  const dependents = dependentViews(catalog, row.id)
  const state = productState(row, verifying)
  return (
    <section aria-labelledby="t5-detail-title" className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 id="t5-detail-title" className="text-sm font-semibold">
            Inspect {row.fileName}
          </h3>
          <PathText path={row.path} className="text-muted-foreground" />
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close inspection
        </Button>
      </div>
      {row.acceptance === "accepted" && state === "drifted" ? (
        <Notice tone="warning" title="Drifted: requires review">
          The bytes on disk no longer match the SHA-256 recorded at acceptance. The acceptance and lineage below describe the earlier bytes; this product is not offered for reuse until its accepted bytes are restored.
        </Notice>
      ) : null}
      <KeyValueList
        columns={2}
        items={[
          { label: "Kind", value: kindLabel(row.kind, row.channel) },
          { label: "Processing", value: <StatusBadge kind="processing" value={row.processingState} /> },
          { label: "Availability", value: <StatusBadge kind="availability" value={row.availability} /> },
          { label: "Size", value: row.file ? formatBytes(row.file.sizeBytes) : "Unknown" },
          { label: "Modified", value: row.file ? formatDateTime(row.file.modifiedAt) : "Unknown" },
          { label: "Found by", value: row.discovered === "attached" ? "Attached by you" : "Output location discovery" },
          { label: "View association", value: <AssociationText row={row} /> },
          { label: "Input-frame lineage", value: <StatusBadge kind="lineage" value={row.lineage} />, source: row.lineage === "unknown" ? "No input-frame record was read" : "Recorded by the tool" },
          { label: "SHA-256 now", value: row.currentSha ?? "Unavailable", mono: true },
          { label: "SHA-256 at acceptance", value: row.acceptedSha ?? "Not accepted", mono: true },
          { label: "Acceptance", value: row.acceptedAt ? `Accepted ${formatDateTime(row.acceptedAt)}` : "Candidate" },
          { label: "Used by Views", value: dependents.length > 0 ? dependents.map((v) => v.name).join(", ") : "None" },
        ]}
      />
    </section>
  )
}

function ProductInputs({ ids, verifying }: { ids: string[]; verifying: boolean }) {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const rows = ids.map((id) => catalog.results[id]).filter((r): r is ResultRecord => r !== undefined)
  return (
    <Section id="t5-product-inputs" title="Product inputs of this View" description="Accepted Results this View uses instead of raw sessions. Each is rehashed against its acceptance digest before it is offered or prepared.">
      <ul className="divide-y rounded-lg border">
        {rows.map((record) => {
          const { availability, file } = pathAvailability(disk, record.path)
          const state: ProductState =
            availability !== "available" ? availability : verifying ? "verifying" : file && file.sha256 !== record.sha256 ? "drifted" : record.contentState
          const origin = catalog.views[record.viewId]
          return (
            <li key={record.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-3 py-2 text-sm">
              <div className="min-w-0 space-y-0.5">
                <div className="font-medium">{baseName(record.path)}</div>
                <PathText path={record.path} className="text-muted-foreground" />
                <div className="text-xs text-muted-foreground">
                  {kindLabel(record.kind, record.channel)} · from View {origin?.name ?? "unknown"} · accepted {record.acceptedAt ? formatDateTime(record.acceptedAt) : "—"} · digest{" "}
                  <span className="font-mono">{shortSha(record.sha256)}</span>
                </div>
                {state === "drifted" ? (
                  <p className="text-xs text-warning">Drifted: rehash differs from the acceptance digest. Review required; its acceptance and lineage are history for the earlier bytes.</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <ProductStateBadge state={state} />
                <StatusBadge kind="lineage" value={record.lineage} />
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

const OUTPUT_ROLE_ORDER: OutputRole[] = ["calibrated", "registered", "intermediate", "temp", "master", "log", "unknown"]

function OutputFiles({ files, viewId }: { files: Array<{ file: DiskFile; role: OutputRole }>; viewId: string }) {
  const masters = useStore((s) => s.catalog.masters)
  return (
    <Section id="t5-output" title="Intermediates and other output files" description="Listed apart from Result candidates. Recognized intermediates are regenerable; Clean up View decides what to remove.">
      <ul className="divide-y rounded-lg border">
        {OUTPUT_ROLE_ORDER.map((role) => {
          const group = files.filter((f) => f.role === role)
          if (group.length === 0) return null
          const bytes = group.reduce((sum, f) => sum + f.file.sizeBytes, 0)
          return (
            <li key={role} className="px-3 py-2">
              <Collapsible>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{role === "master" ? "Generated calibration masters" : `${OUTPUT_ROLE_LABEL[role]}s`.replace("Unknown files", "Unknown files")}</span>{" "}
                    <span className="text-muted-foreground tabular-nums">
                      {plural(group.length, "file")} · {formatBytes(bytes)}
                    </span>
                  </span>
                  <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>Show files</CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
                    {group.map(({ file }) => {
                      const masterId = `mst_${stableHash(file.path)}`
                      const master = masters[masterId] ?? Object.values(masters).find((m) => m.origin.sourcePath === file.path)
                      return (
                        <li key={file.path} className="flex flex-wrap items-center justify-between gap-2">
                          <PathText path={file.path} className="min-w-0 flex-1" />
                          {role === "master" ? (
                            master ? (
                              <Button size="xs" variant="outline" render={<Link to="/calibration/$calibrationId" params={{ calibrationId: master.id }} search={{ viewId }} />}>
                                Open in Calibration ({master.state === "adopted" ? "Adopted" : "Candidate"})
                              </Button>
                            ) : (
                              <Button size="xs" variant="outline" render={<Link to="/calibration" />}>
                                Check in Calibration
                              </Button>
                            )
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                  {role === "master" ? (
                    <p className="mt-2 text-xs text-muted-foreground">Generated masters are never reused by being found. Calibration adopts one only after a reviewed, verified copy.</p>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function NotesSection({ view }: { view: View }) {
  const id = useId()
  const [notes, setNotes] = useState(view.notes)
  const [state, setState] = useState<StatusValue<"save">>("saved")
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [baseRevision, setBaseRevision] = useState(view.revision)
  useEffect(() => {
    if (state === "saved") {
      setNotes(view.notes)
      setBaseRevision(view.revision)
    }
  }, [view.notes, view.revision])
  const dirty = notes !== view.notes
  function save() {
    const current = store.getState().catalog.views[view.id]
    if (!current) return
    const result = saveViewNotes({ ...current, revision: baseRevision }, notes)
    if (result.ok) {
      setState("saved")
      setMessage(undefined)
      setBaseRevision(baseRevision + 1)
    } else {
      setState(result.reason === "stale" ? "stale" : "failed")
      setMessage(result.message)
    }
  }
  return (
    <Section id="t5-notes" title="Notes" description="Notes are annotations: you can edit them while the View is Complete, and they never change membership.">
      <div className="max-w-2xl space-y-2">
        <Label htmlFor={id}>View notes</Label>
        <Textarea
          id={id}
          value={notes}
          rows={3}
          onChange={(e) => {
            setNotes(e.target.value)
            if (state === "saved") setState("unsaved")
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" disabled={!dirty && state !== "failed"} onClick={save}>
            Save notes
          </Button>
          <SaveState
            state={dirty && state === "saved" ? "unsaved" : state}
            message={message}
            onRetry={save}
            onReview={() => {
              const current = store.getState().catalog.views[view.id]
              if (!current) return
              setBaseRevision(current.revision)
              setNotes(current.notes)
              setState("saved")
              setMessage(undefined)
            }}
          />
          {!dirty && state === "saved" ? <span className="text-xs text-muted-foreground">Save notes is available after you edit them.</span> : null}
        </div>
      </div>
    </Section>
  )
}

function AttachDialog({ open, onOpenChange, view }: { open: boolean; onOpenChange: (open: boolean) => void; view: View }) {
  const views = useStore((s) => s.catalog.views)
  const ids = { kind: useId(), channel: useId(), view: useId(), file: useId() }
  const [chooserOpen, setChooserOpen] = useState(false)
  const [file, setFile] = useState<DiskFile | null>(null)
  const [kind, setKind] = useState<ResultKind | null>(null)
  const [channel, setChannel] = useState("")
  const [targetView, setTargetView] = useState(view.id)
  const [errors, setErrors] = useState<{ file?: string; kind?: string; save?: string }>({})
  useEffect(() => {
    if (open) {
      setFile(null)
      setKind(null)
      setChannel("")
      setTargetView(view.id)
      setErrors({})
    }
  }, [open])
  function submit() {
    const next: typeof errors = {}
    if (!file) next.file = "File: choose a file to attach."
    if (!kind) next.kind = "Kind: choose what this file is."
    const existing = file && Object.values(store.getState().catalog.results).find((r) => r.viewId === targetView && r.path === file.path)
    if (file && existing) next.file = `File: ${baseName(file.path)} is already listed for ${views[targetView]?.name ?? "this View"}.`
    setErrors(next)
    if (next.file || next.kind || !file || !kind) return
    const result = attachResult({ path: file.path, kind, channel: channel.trim() || null, viewId: targetView, sha256: file.sha256, growing: file.growing })
    if (!result.ok) {
      setErrors({ save: result.message })
      return
    }
    onOpenChange(false)
  }
  const viewItems = Object.values(views).map((v) => ({ value: v.id, label: v.name }))
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Attach Result</DialogTitle>
            <DialogDescription>Attach a file saved outside the output location. Its View association reads User-linked and its input-frame lineage stays Unknown.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <div className="space-y-1.5">
              <Label id={ids.file}>File</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" aria-labelledby={`${ids.file} ${ids.file}-btn`} id={`${ids.file}-btn`} aria-describedby={errors.file ? `${ids.file}-err` : undefined} onClick={() => setChooserOpen(true)}>
                  {file ? "Choose another file" : "Choose file"}
                </Button>
                {file ? <PathText path={file.path} className="min-w-0 flex-1" /> : <span className="text-sm text-muted-foreground">No file chosen</span>}
              </div>
              {errors.file ? <p id={`${ids.file}-err`} className="text-sm text-destructive">{errors.file}</p> : null}
              {file?.growing ? <p className="text-xs text-muted-foreground">This file is still being written; it is attached as Pending.</p> : null}
            </div>
            <fieldset className="space-y-1.5" aria-describedby={errors.kind ? `${ids.kind}-err` : undefined}>
              <legend className="text-sm font-medium">Kind</legend>
              <RadioGroup value={kind ?? ""} onValueChange={(v) => setKind(v as ResultKind)} className="grid-cols-2">
                {(Object.keys(RESULT_KIND_LABEL) as ResultKind[]).map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <RadioGroupItem value={k} id={`${ids.kind}-${k}`} />
                    <Label htmlFor={`${ids.kind}-${k}`} className="font-normal">
                      {RESULT_KIND_LABEL[k]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              {errors.kind ? <p id={`${ids.kind}-err`} className="text-sm text-destructive">{errors.kind}</p> : null}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor={ids.channel}>Channel (optional)</Label>
              <Input id={ids.channel} value={channel} placeholder="e.g. Ha" onChange={(e) => setChannel(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label id={ids.view}>View</Label>
              <Select items={viewItems} value={targetView} onValueChange={(v) => setTargetView(v as string)}>
                <SelectTrigger aria-labelledby={ids.view} className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {viewItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {errors.save ? <ActionError message={errors.save} onRetry={submit} /> : null}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit">Attach Result</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <FileChooser
        open={chooserOpen}
        onOpenChange={setChooserOpen}
        title="Choose a file to attach"
        initialPath={view.outputPath ? view.outputPath.replace(/\/Processing\/.*$/, "/Finals") : null}
        onChoose={(chosen) => {
          setFile(chosen)
          setErrors((e) => ({ ...e, file: undefined }))
          const name = baseName(chosen.path).toLowerCase()
          if (!kind && /\.(tiff?|png|jpe?g)$/.test(name)) setKind("final-image")
        }}
      />
    </>
  )
}

function ResultPicker({
  open,
  onOpenChange,
  preselected,
  verifying,
  onCreate,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  preselected: string[]
  verifying: boolean
  onCreate: (ids: string[]) => void
  onAdd: (viewId: string, ids: string[]) => void
}) {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const [checked, setChecked] = useState<string[]>([])
  const [addTo, setAddTo] = useState<string | null>(null)
  const addId = useId()
  useEffect(() => {
    if (open) {
      setChecked(preselected)
      setAddTo(null)
    }
  }, [open])
  const accepted = Object.values(catalog.results).filter((r) => r.acceptance === "accepted")
  const byView = new Map<string, ResultRecord[]>()
  for (const r of accepted) byView.set(r.viewId, [...(byView.get(r.viewId) ?? []), r])
  const reason = (r: ResultRecord): string | null => {
    const { availability, file } = pathAvailability(disk, r.path)
    if (availability === "offline") return "Offline: not offered until its volume is connected."
    if (availability === "absent") return "Not found at its path: not offered."
    if (verifying) return "Verifying against its acceptance digest."
    if (r.contentState === "drifted" || (file && file.sha256 !== r.sha256)) return "Drifted: bytes differ from the acceptance digest. Review required; not offered."
    if (!r.kind || !REUSABLE_KINDS.includes(r.kind)) return "Final images are not offered as product inputs."
    return null
  }
  const offered = checked.filter((id) => {
    const r = catalog.results[id]
    return r && !reason(r)
  })
  const viewItems = Object.values(catalog.views).map((v) => ({ value: v.id, label: v.name }))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose accepted Results</DialogTitle>
          <DialogDescription>
            Products are grouped by the View that produced them. The new View lists them apart from raw sessions and adds no raw integration; PlateVault never combines channels or stitches panels.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {verifying ? "Verifying products against their acceptance digests. Products are offered when verification finishes." : "Verification finished."}
        </p>
        {accepted.length === 0 ? (
          <EmptyState icon={Inbox} title="No accepted Results to reuse" description="Accept Results in a View first." action={<DialogClose render={<Button variant="outline" />}>Close</DialogClose>} />
        ) : (
          <div className="max-h-96 space-y-4 overflow-y-auto">
            {[...byView.entries()].map(([originId, records]) => (
              <fieldset key={originId} className="space-y-1">
                <legend className="text-sm font-semibold">From View {catalog.views[originId]?.name ?? originId}</legend>
                <ul className="divide-y rounded-lg border">
                  {records.map((r) => {
                    const why = reason(r)
                    const { availability } = pathAvailability(disk, r.path)
                    const inputId = `pick-${r.id}`
                    return (
                      <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-sm">
                        <input
                          id={inputId}
                          type="checkbox"
                          className="mt-1 size-4 accent-primary"
                          checked={checked.includes(r.id) && !why}
                          disabled={Boolean(why)}
                          aria-describedby={why ? `${inputId}-why` : undefined}
                          onChange={(e) => setChecked((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id)))}
                        />
                        <div className="min-w-0 space-y-0.5">
                          <label htmlFor={inputId} className="font-medium">
                            {baseName(r.path)}
                          </label>
                          <PathText path={r.path} className="text-muted-foreground" />
                          <div className="text-xs text-muted-foreground">{kindLabel(r.kind, r.channel)}</div>
                          {why ? (
                            <p id={`${inputId}-why`} className="text-xs text-pretty text-muted-foreground">
                              {why}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <StatusBadge kind="availability" value={availability} />
                          <StatusBadge kind="lineage" value={r.lineage} />
                          <ProductStateBadge state={availability !== "available" ? availability : verifying ? "verifying" : why?.startsWith("Drifted") ? "drifted" : "unchanged"} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        )}
        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Label id={addId} className="text-sm">
              Add to an existing View
            </Label>
            <Select items={viewItems} value={addTo} onValueChange={(v) => setAddTo(v as string)}>
              <SelectTrigger aria-labelledby={addId} size="sm" className="w-56">
                <SelectValue placeholder="Choose a View" />
              </SelectTrigger>
              <SelectContent>
                {viewItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!addTo || offered.length === 0} onClick={() => addTo && onAdd(addTo, offered)}>
              Add {offered.length > 0 ? plural(offered.length, "Result") : "Results"}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {offered.length === 0 ? <span className="text-xs text-muted-foreground">Select at least one offered product.</span> : null}
            <Button disabled={offered.length === 0} onClick={() => onCreate(offered)}>
              Create View from {offered.length > 0 ? plural(offered.length, "Result") : "Results"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResultsPrototypeControls({ view, root, accepted, onChanged }: { view: View; root: string | null; accepted: ResultRow[]; onChanged: () => void }) {
  const [outcome, setOutcome] = useState<ControlOutcome | null>(null)
  const [externalPath, setExternalPath] = useState("/Volumes/Astro-T7/Work/Finals/NGC7000-HOO.tif")
  const [productPath, setProductPath] = useState<string | null>(null)
  const pathId = useId()
  const productId = useId()
  const run = (result: ControlOutcome) => {
    setOutcome(result)
    onChanged()
  }
  const productItems = accepted.map((r) => ({ value: r.path, label: r.fileName }))
  return (
    <PrototypeControls outcome={outcome} description="Use these to stand in for the processing application and the journey's P5 helper.">
      <Button size="sm" variant="outline" disabled={!root} onClick={() => run(simulateApplicationOutput(view))}>
        Simulate application output
      </Button>
      <Button size="sm" variant="outline" disabled={!root} onClick={() => root && run(finishWriting(root))}>
        Finish writing
      </Button>
      {!root ? <span className="text-xs text-muted-foreground">Output controls need a prepared View.</span> : null}
      <div className="flex w-full flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={pathId} className="text-xs">
            Final image path outside the View
          </Label>
          <Input id={pathId} value={externalPath} onChange={(e) => setExternalPath(e.target.value)} className="w-96 font-mono text-xs" />
        </div>
        <Button size="sm" variant="outline" onClick={() => run(saveExternalImage(externalPath.trim()))}>
          Save final image
        </Button>
      </div>
      <div className="flex w-full flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label id={productId} className="text-xs">
            Accepted product
          </Label>
          <Select items={productItems} value={productPath} onValueChange={(v) => setProductPath(v as string)}>
            <SelectTrigger aria-labelledby={productId} size="sm" className="w-72">
              <SelectValue placeholder="Choose an accepted product" />
            </SelectTrigger>
            <SelectContent>
              {productItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" disabled={!productPath} onClick={() => productPath && run(overwriteKeepingStat(productPath))}>
          Overwrite in place (same size and mtime)
        </Button>
        <Button size="sm" variant="outline" disabled={!productPath} onClick={() => productPath && run(restoreKeepingStat(productPath))}>
          Restore saved bytes
        </Button>
        {!productPath ? <span className="text-xs text-muted-foreground">Choose an accepted product first.</span> : null}
      </div>
    </PrototypeControls>
  )
}
