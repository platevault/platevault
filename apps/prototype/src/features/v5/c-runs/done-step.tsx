/**
 * S5 Done: Complete (it needs no Result and removes nothing) and the Clean
 * up review: only the entries the run's preparations created, every one
 * preselected, with the run's footprint. A Direct-source preparation creates
 * no entries, so its list is empty. Clean up moves the chosen entries to the
 * OS Trash as an operation (D-W26, PREP-FR-14, RES-FR-06). Complete on a run
 * with open steps shows a preview first (`CompleteButton`). The Project's
 * Wrap up takes over once every run is Complete (P-WRAP1).
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { CircleCheck, Copy, ListChecks, ListX, RotateCcw, ShieldCheck, Trash2, Wand2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { GateLabel, gateWord, stepName } from "@/app/run-ui"
import { Box } from "@/components/app/box"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { type Column, DataTable } from "@/components/app/data-table"
import { OperationPanel } from "@/components/app/operation-panel"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { Button } from "@/components/ui/button"
import { runPipeline } from "@/domain/derive"
import { fileName, formatBytes, formatDateTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { completeRun, reopenRun } from "@/store/actions/runs"
import { useStore } from "@/store/core"
import { startCleanup } from "./actions"
import { type CleanupEntry, cleanupReview, type RunContext } from "./model"
import type { useOutcome } from "./parts"
import { FootprintPill } from "./prepare-step"
import { WrapUpLink } from "./results-step"

/**
 * Complete, from the run header or the Done step. A run whose earlier steps are not all Done (Blocked at
 * Calibrate, Partial at Prepare) gets a preview naming each open step before it is recorded as Complete.
 */
export function CompleteButton({ ctx, onOutcome, variant = "default" }: { ctx: RunContext; onOutcome: ReturnType<typeof useOutcome>["act"]; variant?: "default" | "outline" }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { run } = ctx
  const [preview, setPreview] = useState(false)
  const open = runPipeline(state, run)
    .steps.slice(0, 5)
    .filter((s) => s.state !== "done")
  const options = { blocked: m.run_complete_blocked(), success: { title: m.run_completed({ name: run.name }), tone: "info" as const } }
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => (open.length > 0 ? setPreview(true) : onOutcome(completeRun(run.id), options))}>
        <ShieldCheck aria-hidden="true" data-icon="inline-start" />
        {m.run_complete()}
        {open.length > 0 ? "…" : ""}
      </Button>
      <ConfirmDialog
        open={preview}
        onOpenChange={setPreview}
        title={m.run_complete_title({ name: run.name, count: open.length })}
        description={m.run_complete_description()}
        changes={[m.run_reopen_returns_to({ step: stepName(m, runPipeline(state, run).current.id) }), ...open.map((s) => `${m.run_complete_step_stays({ step: stepName(m, s.id), gate: gateWord(m, s.state) })} · ${say(m, s.items.find((i) => i.met === false)?.detail ?? s.status)}`)]}
        confirmLabel={m.run_complete()}
        onConfirm={() => {
          const result = completeRun(run.id)
          onOutcome(result, options)
          return result
        }}
      />
    </>
  )
}

function kindWord(m: Messages, kind: CleanupEntry["kind"]): string {
  if (kind === "link") return m.run_cleanup_kind_link()
  if (kind === "list") return m.run_cleanup_kind_list()
  return m.run_cleanup_kind_copy()
}

function copyPath(path: string) {
  void navigator.clipboard?.writeText(path).catch(() => {})
}

export function DoneStep({ ctx, outcome }: { ctx: RunContext; outcome: ReturnType<typeof useOutcome> }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const { run, project } = ctx
  const pipeline = runPipeline(state, run)
  const review = cleanupReview(state, run)
  const paths = review.entries.map((e) => e.path)
  const key = paths.join("|")
  const [selected, setSelected] = useState<string[]>(paths)
  // Every prepared entry starts selected; the list changes after a Clean up or a new preparation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the listed entries change
  useEffect(() => setSelected(paths), [key])
  const [confirm, setConfirm] = useState<string[] | null>(null)
  const cleanups = Object.values(state.operations)
    .filter((op) => op.kind === "cleanup" && op.scope.runIds?.includes(run.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const lastCleanup = cleanups[0]
  const chosenPaths = confirm ?? selected
  const chosen = review.entries.filter((e) => chosenPaths.includes(e.path))
  const bytes = chosen.reduce((n, e) => n + e.sizeBytes, 0)
  const folders = useMemo(() => [...new Set(review.entries.map((e) => e.prep.folderPath))], [review.entries])
  const complete = run.completion === "complete"
  const canClean = complete && !run.trashedAt
  const entries = (e: CleanupEntry): MenuEntry[] => {
    const on = selected.includes(e.path)
    return [
      { heading: fileName(e.path) },
      ...(run.trashedAt ? [] : [{ label: on ? m.run_exclude() : m.run_include(), icon: on ? ListX : ListChecks, onSelect: () => setSelected((cur) => (on ? cur.filter((p) => p !== e.path) : [...cur, e.path])) }]),
      ...(canClean ? [{ label: m.run_clean_up_this(), icon: Trash2, destructive: true, onSelect: () => setConfirm([e.path]) }] : []),
      { separator: true },
      { label: m.session_copy_path(), icon: Copy, onSelect: () => copyPath(e.path) },
    ]
  }
  const columns: Column<CleanupEntry>[] = [
    { id: "file", header: m.run_col_entry(), rowHeader: true, truncate: true, cell: (e) => <span title={e.path}>{e.path.slice(e.prep.folderPath.length + 1)}</span>, sortValue: (e) => e.path },
    { id: "kind", header: m.run_col_kind(), cell: (e) => kindWord(m, e.kind) },
    { id: "size", header: m.run_col_size(), align: "right", cell: (e) => formatBytes(e.sizeBytes), sortValue: (e) => e.sizeBytes },
  ]

  return (
    <div className="space-y-4">
      <Box
        id="done-complete"
        level={2}
        title={m.run_completion()}
        actions={
          run.trashedAt ? null : complete ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                const { result, step } = reopenRun(run.id)
                if (outcome.act(result, { blocked: m.run_reopen_blocked() })) void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: run.projectId, runId: run.id, step } })
              }}
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              {m.run_reopen()}
            </Button>
          ) : (
            <CompleteButton ctx={ctx} onOutcome={outcome.act} />
          )
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {complete ? (
            <Pill tone="success" icon={CircleCheck} title={m.run_reopen_returns_to({ step: stepName(m, run.stageBeforeComplete ?? "select") })}>
              {m.run_complete_at({ date: formatDateTime(run.completedAt ?? "") })}
            </Pill>
          ) : null}
          {pipeline.steps.slice(0, 5).map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full px-2 text-xs ring-1 ring-border ring-inset">
              <span className="text-muted-foreground">{stepName(m, s.id)}</span>
              <GateLabel state={s.state} label={say(m, s.status)} />
            </span>
          ))}
        </div>
      </Box>

      {/* The header's and Run group's Clean up links land here (`#cleanup`); Box ids name only its heading. */}
      <div id="cleanup">
      <Box
        id="cleanup-box"
        level={2}
        flush
        title={
          <span className="flex items-center gap-1.5">
            {m.run_clean_up()} <CountBadge count={review.entries.length} label={m.run_entries_count({ count: review.entries.length })} />
          </span>
        }
        actions={
          <>
            <FootprintPill run={run} />
            <WrapUpLink project={project} />
            {canClean ? (
              <Button size="xs" disabled={selected.length === 0} onClick={() => setConfirm(selected)}>
                <Wand2 aria-hidden="true" data-icon="inline-start" />
                {m.run_clean_up_ellipsis()}
              </Button>
            ) : null}
          </>
        }
      >
        {(!complete && !run.trashedAt) || review.directSource.length > 0 || review.refused.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
            {!complete && !run.trashedAt ? <Pill tone="muted">{m.run_after_complete()}</Pill> : null}
            {review.directSource.length > 0 ? <Pill tone="muted">{m.run_direct_source_nothing_to_clean({ count: review.directSource.length })}</Pill> : null}
            {review.refused.map((r) => (
              <Pill key={r.path} tone="warning" title={r.path}>
                {fileName(r.path)} · {say(m, r.reason)}
              </Pill>
            ))}
          </div>
        ) : null}
        {lastCleanup ? (
          <div className="border-b border-border px-3 py-2">
            <OperationPanel operationId={lastCleanup.id} />
          </div>
        ) : null}
        <DataTable
          label={m.run_prepared_entries_label({ name: run.name })}
          rows={review.entries}
          columns={columns}
          getRowId={(e) => e.path}
          scroll="none"
          groups={{ key: (e) => e.prep.folderPath, label: (folder, rows) => `${fileName(folder)}/ · ${m.run_entries_count({ count: rows.length })}` }}
          selection={{ selected, onChange: setSelected, rowLabel: (e) => fileName(e.path), isSelectable: () => !run.trashedAt }}
          contextMenu={entries}
          empty={
            <p className="flex flex-wrap items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              {review.directSource.length > 0 && folders.length === 0 ? m.run_no_prepared_entries() : lastCleanup ? m.run_all_in_os_trash() : m.run_nothing_prepared()}
              {lastCleanup || review.directSource.length > 0 ? null : (
                <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: run.projectId, runId: run.id, step: "prepare" }} />}>
                  {m.run_open_prepare()}
                </Button>
              )}
            </p>
          }
        />
      </Box>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={m.run_clean_up_title({ name: run.name })}
        description={m.run_clean_up_description()}
        changes={[m.run_clean_up_moves({ count: chosen.length, bytes: formatBytes(bytes) }), ...[...new Set(chosen.map((e) => e.prep.folderPath))].map((f) => m.run_clean_up_from({ folder: fileName(f) }))]}
        confirmLabel={m.run_clean_up_confirm({ count: chosen.length })}
        tone="destructive"
        onConfirm={() => {
          const r = startCleanup(run.id, chosenPaths)
          outcome.act(r, { blocked: m.run_clean_up_blocked() })
          return r.result
        }}
      />
    </div>
  )
}
