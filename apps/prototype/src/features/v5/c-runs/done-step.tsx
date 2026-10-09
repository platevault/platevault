/**
 * S5 Done: Complete (it needs no Result and removes nothing) and the Clean
 * up review: only the entries the run's preparations created, every one
 * preselected. A Direct-source preparation creates no entries, so its list
 * is empty. Clean up moves the chosen entries to the OS Trash as an
 * operation (D-W26, PREP-FR-14, RES-FR-06). Complete on a run with open
 * steps shows a preview first (`CompleteButton`).
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { RotateCcw, ShieldCheck, Wand2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Notice } from "@/components/app/feedback"
import { type Column, DataTable } from "@/components/app/data-table"
import { OperationPanel } from "@/components/app/operation-panel"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { GATE_LABEL, runPipeline } from "@/domain/derive"
import { STEP_LABEL } from "@/domain/labels"
import { fileName, formatBytes, formatDateTime, plural } from "@/lib/format"
import { completeRun, reopenRun } from "@/store/actions/runs"
import { useStore } from "@/store/core"
import { startCleanup } from "./actions"
import { type CleanupEntry, cleanupReview, type RunContext } from "./model"
import type { useOutcome } from "./parts"

/**
 * Complete, from the run header or the Done step. A run whose earlier steps are not all Done (Blocked at
 * Calibrate, Partial at Prepare) gets a preview naming each open step before it is recorded as Complete.
 */
export function CompleteButton({ ctx, onOutcome, variant = "default" }: { ctx: RunContext; onOutcome: ReturnType<typeof useOutcome>["act"]; variant?: "default" | "outline" }) {
  const state = useStore((s) => s)
  const { run } = ctx
  const [preview, setPreview] = useState(false)
  const open = runPipeline(state, run)
    .steps.slice(0, 5)
    .filter((s) => s.state !== "done")
  const success = { title: `${run.name} is Complete`, reasons: ["Nothing was removed. Clean up is offered in Done."], tone: "info" as const }
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => (open.length > 0 ? setPreview(true) : onOutcome(completeRun(run.id), success))}>
        <ShieldCheck aria-hidden="true" data-icon="inline-start" />
        Complete{open.length > 0 ? "…" : ""}
      </Button>
      <ConfirmDialog
        open={preview}
        onOpenChange={setPreview}
        title={`Complete ${run.name} with ${plural(open.length, "open step")}?`}
        description="Complete records that processing is done. Steps that are not Done stay as they are and stop holding Next."
        changes={[`${run.name} reads Complete; Reopen returns it to ${STEP_LABEL[runPipeline(state, run).current.id]}`, ...open.map((s) => `${s.label} stays ${GATE_LABEL[s.state]}: ${s.items.find((i) => i.met === false)?.detail ?? s.status}`)]}
        unchanged={["Nothing is removed: prepared folders, Results and library frames stay", "Membership and calibration decisions"]}
        confirmLabel={`Complete with ${plural(open.length, "open step")}`}
        onConfirm={() => {
          const result = completeRun(run.id)
          onOutcome(result, success)
          return result
        }}
      />
    </>
  )
}

export function DoneStep({ ctx, outcome }: { ctx: RunContext; outcome: ReturnType<typeof useOutcome> }) {
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const { run } = ctx
  const pipeline = runPipeline(state, run)
  const review = cleanupReview(state, run)
  const paths = review.entries.map((e) => e.path)
  const key = paths.join("|")
  const [selected, setSelected] = useState<string[]>(paths)
  // Every prepared entry starts selected; the list changes after a Clean up or a new preparation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the listed entries change
  useEffect(() => setSelected(paths), [key])
  const [confirm, setConfirm] = useState(false)
  const cleanups = Object.values(state.operations)
    .filter((op) => op.kind === "cleanup" && op.scope.runIds?.includes(run.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const lastCleanup = cleanups[0]
  const chosen = review.entries.filter((e) => selected.includes(e.path))
  const bytes = chosen.reduce((n, e) => n + e.sizeBytes, 0)
  const folders = useMemo(() => [...new Set(review.entries.map((e) => e.prep.folderPath))], [review.entries])
  const complete = run.completion === "complete"
  const columns: Column<CleanupEntry>[] = [
    { id: "file", header: "Entry", rowHeader: true, truncate: true, cell: (e) => <span title={e.path}>{e.path.slice(e.prep.folderPath.length + 1)}</span>, sortValue: (e) => e.path },
    { id: "kind", header: "Kind", cell: (e) => (e.kind === "link" ? "Link" : e.kind === "list" ? "Handoff list" : "Copy or clone") },
    { id: "size", header: "Size", align: "right", cell: (e) => (e.kind === "link" ? "0 B" : formatBytes(e.sizeBytes)), sortValue: (e) => e.sizeBytes },
  ]

  return (
    <div className="space-y-6">
      <Section
        title="Completion"
        id="done-complete"
        description={complete ? `Complete since ${formatDateTime(run.completedAt ?? "")}. Reopen returns the run to ${STEP_LABEL[run.stageBeforeComplete ?? "select"]}.` : "Complete records that processing is done; it needs no accepted Result and removes nothing."}
        actions={
          run.trashedAt ? null : complete ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const { result, step } = reopenRun(run.id)
                if (outcome.act(result)) void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: run.projectId, runId: run.id, step } })
              }}
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              Reopen
            </Button>
          ) : (
            <CompleteButton ctx={ctx} onOutcome={outcome.act} />
          )
        }
      >
        <ul className="grid gap-1 text-xs sm:grid-cols-2">
          {pipeline.steps.slice(0, 5).map((s) => (
            <li key={s.id} className="flex gap-2">
              <span className="w-20 text-muted-foreground">{s.label}</span>
              <span>
                {s.state === "done" ? "" : `${GATE_LABEL[s.state]} · `}
                {s.status}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Clean up"
        id="cleanup"
        description="Only the links, clones and copies this run's preparations created; originals, Results and rejected frames are never listed."
        actions={
          complete && !run.trashedAt ? (
            <Button
              size="sm"
              disabled={chosen.length === 0}
              onClick={() => setConfirm(true)}
            >
              <Wand2 aria-hidden="true" data-icon="inline-start" />
              Clean up {plural(chosen.length, "entry", "entries")}…
            </Button>
          ) : null
        }
      >
        {!complete && !run.trashedAt ? <p className="text-xs text-muted-foreground">Clean up comes after Complete. The list below is what it will offer.</p> : null}
        {review.directSource.length > 0 ? (
          <Notice tone="info" title={`${plural(review.directSource.length, "Direct-source preparation")}: nothing to clean up`}>
            Direct source passed exact original paths and created no links, clones or copies.
          </Notice>
        ) : null}
        {review.refused.map((r) => (
          <Notice key={r.path} tone="offline" title={`${fileName(r.path)} cannot be listed`}>
            {r.reason}. Its entries are kept until it is back.
          </Notice>
        ))}
        {lastCleanup ? <OperationPanel operationId={lastCleanup.id} /> : null}
        <DataTable
          label={`Prepared entries of ${run.name}`}
          rows={review.entries}
          columns={columns}
          getRowId={(e) => e.path}
          scroll="none"
          groups={{ key: (e) => e.prep.folderPath, label: (folder, rows) => `${fileName(folder)}/ · ${plural(rows.length, "entry", "entries")}` }}
          selection={{ selected, onChange: setSelected, rowLabel: (e) => fileName(e.path), isSelectable: () => !run.trashedAt }}
          empty={
            <p className="px-3 py-6 text-sm text-muted-foreground">
              {review.directSource.length > 0 && folders.length === 0 ? "Empty: a Direct-source run has no prepared entries." : lastCleanup ? "Every prepared entry is already in the OS Trash." : "No prepared entries. "}
              {lastCleanup || review.directSource.length > 0 ? null : (
                <Link className="text-link underline-offset-4 hover:underline" to="/projects/$projectId/runs/$runId/$step" params={{ projectId: run.projectId, runId: run.id, step: "prepare" }}>
                  Open Prepare
                </Link>
              )}
            </p>
          }
        />
      </Section>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Clean up ${run.name}?`}
        description="The chosen prepared entries move to the OS Trash, where you can put them back."
        changes={[`Moves ${plural(chosen.length, "prepared entry", "prepared entries")} (${formatBytes(bytes)}) to the OS Trash`, ...folders.map((f) => `From ${f}/`)]}
        unchanged={["Original frames and Direct-source paths", "The Results folder and every accepted Result", "Library quality decisions and the run's membership", "Nothing is deleted permanently"]}
        confirmLabel={`Move ${plural(chosen.length, "entry", "entries")} to the OS Trash`}
        tone="destructive"
        onConfirm={() => {
          const r = startCleanup(run.id, selected)
          outcome.act(r)
          return r.result
        }}
      />
    </div>
  )
}
