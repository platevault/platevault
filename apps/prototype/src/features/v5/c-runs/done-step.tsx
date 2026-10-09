/**
 * S5 Done: Complete (it needs no Result and removes nothing) and the Clean
 * up review: only the entries the run's preparations created, every one
 * preselected. A Direct-source preparation creates no entries, so its list
 * is empty. Clean up moves the chosen entries to the OS Trash as an
 * operation (D-W26, PREP-FR-14, RES-FR-06).
 */
import { Link } from "@tanstack/react-router"
import { RotateCcw, ShieldCheck, Wand2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Notice } from "@/components/app/feedback"
import { type Column, DataTable } from "@/components/app/data-table"
import { OperationPanel } from "@/components/app/operation-panel"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { runPipeline } from "@/domain/derive"
import { STEP_LABEL } from "@/domain/labels"
import { formatBytes, formatDateTime, plural } from "@/lib/format"
import { completeRun, reopenRun } from "@/store/actions/runs"
import { useStore } from "@/store/core"
import { useNavigate } from "@tanstack/react-router"
import { startCleanup } from "./actions"
import { type CleanupEntry, cleanupReview, type RunContext } from "./model"
import { fileName, OutcomeNotice, useOutcome } from "./parts"

export function DoneStep({ ctx }: { ctx: RunContext }) {
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const { run } = ctx
  const outcome = useOutcome()
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
  const columns: Column<CleanupEntry>[] = [
    { id: "file", header: "Entry", rowHeader: true, truncate: true, cell: (e) => <span title={e.path}>{e.path.slice(e.prep.folderPath.length + 1)}</span>, sortValue: (e) => e.path },
    { id: "kind", header: "Kind", cell: (e) => (e.kind === "link" ? "Link" : e.kind === "list" ? "Handoff list" : "Copy or clone") },
    { id: "size", header: "Size", align: "right", cell: (e) => (e.kind === "link" ? "0 B" : formatBytes(e.sizeBytes)), sortValue: (e) => e.sizeBytes },
  ]

  return (
    <div className="space-y-6">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      <Section
        title="Completion"
        id="done-complete"
        description={run.completion === "complete" ? `Complete since ${formatDateTime(run.completedAt ?? "")}. Reopen returns the run to ${STEP_LABEL[run.stageBeforeComplete ?? "select"]}.` : "Complete records that processing is done. It needs no accepted Result, removes nothing, and does not infer that the application finished."}
        actions={
          run.trashedAt ? null : run.completion === "complete" ? (
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
            <Button size="sm" onClick={() => outcome.act(completeRun(run.id), { title: `${run.name} is Complete`, reasons: ["Nothing was removed. Review the Clean up list below."], tone: "info" })}>
              <ShieldCheck aria-hidden="true" data-icon="inline-start" />
              Complete
            </Button>
          )
        }
      >
        <ul className="grid gap-1 text-[0.75rem] sm:grid-cols-2">
          {pipeline.steps.slice(0, 5).map((s) => (
            <li key={s.id} className="flex gap-2">
              <span className="w-20 text-muted-foreground">{s.label}</span>
              <span>{s.status}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Clean up"
        id="cleanup"
        description="Only the links, clones and copies this run's preparations created. Original sources, Direct-source paths, library frames and Results are never listed; rejected frames belong to the Project's Done / Archive sheet."
        actions={
          <Button
            size="sm"
            variant={run.completion === "complete" ? "default" : "outline"}
            onClick={() => {
              if (run.completion !== "complete" || chosen.length === 0) {
                outcome.act(startCleanup(run.id, selected))
                return
              }
              setConfirm(true)
            }}
          >
            <Wand2 aria-hidden="true" data-icon="inline-start" />
            Clean up {plural(chosen.length, "entry", "entries")}…
          </Button>
        }
      >
        {run.completion !== "complete" && !run.trashedAt ? <Notice tone="info" title="Clean up comes after Complete">Mark the run Complete first; the list below is what Clean up will offer.</Notice> : null}
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
        description="The chosen prepared entries move to the OS Trash, where you can put them back. Nothing is deleted permanently."
        changes={[`Moves ${plural(chosen.length, "prepared entry", "prepared entries")} (${formatBytes(bytes)}) to the OS Trash`, ...folders.map((f) => `From ${f}/`)]}
        unchanged={["Original frames and Direct-source paths", "The Results folder and every accepted Result", "Library quality decisions and the run's membership"]}
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
