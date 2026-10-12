/**
 * S5 Done: Complete (it needs no Result and removes nothing by itself) and
 * the Clean up review: only the entries the run's preparations created,
 * every one preselected, with the run's footprint. Clean up moves the chosen
 * entries to the OS Trash as an operation (D-W26, PREP-FR-14, RES-FR-06).
 * Complete confirms when the run has a run view or intermediates, offering
 * Remove run view (frees a Copies view's bytes; a Symlinks view is links
 * only) and Move intermediates to Trash, both on by default (P-PREP3), and
 * previews the open steps of a run that is not Done throughout
 * (`CompleteButton`). The Project's Wrap up takes over once every run is
 * Complete (P-WRAP1).
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { CircleCheck, Copy, ListChecks, ListX, RotateCcw, ShieldCheck, Trash2, Wand2 } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { GateLabel, gateWord, stepName } from "@/app/run-ui"
import { Box } from "@/components/app/box"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { type Column, DataTable } from "@/components/app/data-table"
import { OperationPanel } from "@/components/app/operation-panel"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { runPipeline } from "@/domain/derive"
import { fileName, formatBytes, formatCount, formatDateTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { completeRun, reopenRun } from "@/store/actions/runs"
import { useStore } from "@/store/core"
import { runIntermediatesOffer } from "@/features/v5/b-projects/model"
import { startCleanup, startRunIntermediatesCleanup } from "./actions"
import { type CleanupEntry, cleanupReview, type RunContext } from "./model"
import type { useOutcome } from "./parts"
import { FootprintPill } from "./prepare-step"
import { WrapUpLink } from "./results-step"

/** "frees 12.4 GB", or "links only" when the run view holds no bytes of its own. */
function viewFreesText(m: Messages, entries: CleanupEntry[]): string {
  const bytes = entries.reduce((n, e) => n + e.sizeBytes, 0)
  return bytes > 0 ? m.run_complete_frees({ bytes: formatBytes(bytes) }) : m.run_complete_links_only()
}

/**
 * Complete, from the run header or the Done step. A run with a run view or intermediates confirms first, offering Remove run
 * view and Move intermediates to Trash, both on by default (P-PREP3); a run whose earlier steps are not all Done (Blocked at
 * Calibrate, Partial at Prepare) names each open step in the same preview before it is recorded as Complete.
 */
export function CompleteButton({ ctx, onOutcome, variant = "default" }: { ctx: RunContext; onOutcome: ReturnType<typeof useOutcome>["act"]; variant?: "default" | "outline" }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { run } = ctx
  const [preview, setPreview] = useState(false)
  const [removeView, setRemoveView] = useState(true)
  const [trashIntermediates, setTrashIntermediates] = useState(true)
  const viewId = useId()
  const intermediatesId = useId()
  const open = runPipeline(state, run)
    .steps.slice(0, 5)
    .filter((s) => s.state !== "done")
  const prepared = cleanupReview(state, run).entries
  const intermediates = runIntermediatesOffer(state, run)
  const options = { blocked: m.run_complete_blocked(), success: { title: m.run_completed({ name: run.name }), tone: "info" as const } }
  const offers = prepared.length > 0 || intermediates.count > 0
  const ask = open.length > 0 || offers
  const intermediatesSize = formatBytes(intermediates.sizeBytes)
  const kept = [
    ...(prepared.length > 0 && !removeView ? [m.run_complete_keeps_prepared({ count: prepared.length })] : []),
    ...(intermediates.count > 0 && !trashIntermediates ? [m.run_complete_keeps_intermediates({ count: intermediates.count, n: formatCount(intermediates.count) })] : []),
  ]
  return (
    <>
      <Button
        size="sm"
        variant={variant}
        onClick={() => {
          setRemoveView(true)
          setTrashIntermediates(true)
          if (ask) setPreview(true)
          else onOutcome(completeRun(run.id), options)
        }}
      >
        <ShieldCheck aria-hidden="true" data-icon="inline-start" />
        {m.run_complete()}
        {ask ? "…" : ""}
      </Button>
      <ConfirmDialog
        open={preview}
        onOpenChange={setPreview}
        title={open.length > 0 ? m.run_complete_title({ name: run.name, count: open.length }) : m.project_run_complete_title({ name: run.name })}
        description={
          offers ? (
            <span className="flex flex-col gap-1.5 text-foreground" data-complete-cleanup>
              {prepared.length > 0 ? (
                <span className="flex items-center gap-2" data-complete-view>
                  <Checkbox id={viewId} checked={removeView} onCheckedChange={(checked) => setRemoveView(checked === true)} />
                  <Label htmlFor={viewId} className="font-normal">
                    {m.run_complete_remove_view({ frees: viewFreesText(m, prepared) })}
                  </Label>
                </span>
              ) : null}
              {intermediates.count > 0 ? (
                <span className="flex items-center gap-2" data-complete-intermediates>
                  <Checkbox id={intermediatesId} checked={trashIntermediates} onCheckedChange={(checked) => setTrashIntermediates(checked === true)} />
                  <Label htmlFor={intermediatesId} className="font-normal">
                    {m.run_complete_intermediates({ count: intermediates.count, n: formatCount(intermediates.count), size: intermediatesSize })}
                  </Label>
                </span>
              ) : null}
            </span>
          ) : (
            m.run_complete_description()
          )
        }
        changes={[
          m.run_reopen_returns_to({ step: stepName(m, runPipeline(state, run).current.id) }),
          ...open.map((s) => `${m.run_complete_step_stays({ step: stepName(m, s.id), gate: gateWord(m, s.state) })} · ${say(m, s.items.find((i) => i.met === false)?.detail ?? s.status)}`),
          ...(prepared.length > 0 && removeView ? [m.run_clean_up_moves({ count: prepared.length, bytes: formatBytes(prepared.reduce((n, e) => n + e.sizeBytes, 0)) })] : []),
          ...(intermediates.count > 0 && trashIntermediates ? [m.run_complete_moves_intermediates({ count: intermediates.count, n: formatCount(intermediates.count), size: intermediatesSize })] : []),
        ]}
        unchanged={kept.length > 0 ? kept : undefined}
        confirmLabel={m.run_complete()}
        onConfirm={() => {
          const result = completeRun(run.id)
          if (!onOutcome(result, options)) return result
          if (removeView && prepared.length > 0) onOutcome(startCleanup(run.id, prepared.map((e) => e.path)), { blocked: m.run_clean_up_blocked(), success: options.success })
          if (trashIntermediates && intermediates.count > 0) onOutcome(startRunIntermediatesCleanup(run.id), { blocked: m.run_clean_up_blocked(), success: options.success })
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
  // A finished Clean up needs no panel: its outcome is the one-line empty row below.
  const cleanupFinished = lastCleanup?.status === "succeeded"
  const chosenPaths = confirm ?? selected
  const chosen = review.entries.filter((e) => chosenPaths.includes(e.path))
  const bytes = formatBytes(chosen.reduce((n, e) => n + e.sizeBytes, 0))
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
        {(!complete && !run.trashedAt) || review.refused.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
            {!complete && !run.trashedAt ? <Pill tone="muted">{m.run_after_complete()}</Pill> : null}
            {review.refused.map((r) => (
              <Pill key={r.path} tone="warning" title={r.path}>
                {fileName(r.path)} · {say(m, r.reason)}
              </Pill>
            ))}
          </div>
        ) : null}
        {lastCleanup && !cleanupFinished ? (
          <div className="border-b border-border px-3 py-2">
            <OperationPanel operationId={lastCleanup.id} />
          </div>
        ) : null}
        {review.entries.length === 0 ? (
          <p className="flex flex-wrap items-center gap-x-1.5 px-3 py-2 text-sm text-muted-foreground tabular-nums">
            {lastCleanup ? (
              <span>{[m.run_all_in_os_trash(), ...(cleanupFinished ? [m.run_entries_count({ count: lastCleanup.progress.done }), formatDateTime(lastCleanup.settledAt ?? lastCleanup.updatedAt)] : [])].join(" · ")}</span>
            ) : (
              <>
                <span>{m.run_nothing_prepared()}</span>
                <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: run.projectId, runId: run.id, step: "prepare" }} />}>
                  {m.run_open_prepare()}
                </Button>
              </>
            )}
          </p>
        ) : (
          <DataTable
            label={m.run_prepared_entries_label({ name: run.name })}
            rows={review.entries}
            columns={columns}
            getRowId={(e) => e.path}
            scroll="none"
            groups={{ key: (e) => e.prep.folderPath, label: (folder, rows) => `${fileName(folder)}/ · ${m.run_entries_count({ count: rows.length })}` }}
            selection={{ selected, onChange: setSelected, rowLabel: (e) => fileName(e.path), isSelectable: () => !run.trashedAt }}
            contextMenu={entries}
          />
        )}
      </Box>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={m.run_clean_up_title({ name: run.name })}
        description={m.run_clean_up_description()}
        changes={[m.run_clean_up_moves({ count: chosen.length, bytes }), ...[...new Set(chosen.map((e) => e.prep.folderPath))].map((f) => m.run_clean_up_from({ folder: fileName(f) }))]}
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
