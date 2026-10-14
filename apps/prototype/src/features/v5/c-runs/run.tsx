/**
 * S5 Run (slice C) as a StepPage (§5.4): Select → Calibrate → Prepare →
 * Results on the run flow (`runFlow`), with Finish run as Results' Proceed.
 * There is no Review step (review happens at intake, P-REV2) and no Done
 * step. Run ▾ holds Edit run…, Open in {app}, Reopen run… and Move to
 * Trash…. A Finished run is read-only, with Results reading "Finished
 * {date}" and no Proceed; a trashed run is read-only with Restore in its
 * notice (D-W72).
 */
import { useNavigate, useParams } from "@tanstack/react-router"
import { useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, MenuItem } from "@/components/app/contracts"
import type { PageNotice } from "@/components/app/feedback"
import { TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import type { PathItem } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { stepEditable } from "@/components/app/step-flow"
import { StepPage } from "@/components/templates/step-page"
import { groupStepLink, projectLink, RUN_FLOW_STEPS, runFlowState, runPreparations, runStepLink, trashRefusals } from "@/domain/derive"
import { profileRef } from "@/domain/labels"
import type { Run, RunFlowStepId } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { runFlow } from "@/store/actions/flows"
import { finishRun, renameRun, reopenRun, restoreRun, trashRun } from "@/store/actions/runs"
import { store, useStore } from "@/store/core"
import { openPreparation, startPrepare } from "./actions"
import { CalibrateStep } from "./calibrate-step"
import { currentPreparation, preparePlan, type RunContext, runContext } from "./model"
import { PrepareStep, prepareConfirm } from "./prepare-step"
import { ResultsStep } from "./results-step"
import { SelectStep } from "./select-step"

export function RunPage() {
  const m = useMessages()
  const { projectId, runId, step } = useParams({ strict: false }) as { projectId?: string; runId?: string; step?: string }
  const state = useStore((s) => s)
  const ctx = runId ? runContext(state, runId) : null
  if (!ctx || ctx.run.projectId !== projectId) return <MissingRecord title={m.run_missing_title()} backTo={projectId ? `/projects/${projectId}` : "/projects"} backLabel={m.run_open_project()} />
  if (!isRunFlowStep(step)) return <MissingRecord title={m.run_step_missing_title()} backTo={`/projects/${ctx.project.id}/runs/${ctx.run.id}/${runFlowState(state, ctx.run).current}`} backLabel={m.run_open_current_step()} />
  return <RunScreen ctx={ctx} step={step} />
}

export function isRunFlowStep(step: string | undefined): step is RunFlowStepId {
  return RUN_FLOW_STEPS.includes(step as RunFlowStepId)
}

function RunScreen({ ctx, step }: { ctx: RunContext; step: RunFlowStepId }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const [editing, setEditing] = useState(false)
  const { run, project, group } = ctx
  const plan = preparePlan(state, run)
  const flow = runFlow(state, run, m, { prepare: { confirm: prepareConfirm(m, plan), start: () => startPrepare(run.id).result } })
  const editable = stepEditable(flow, step)
  const path: PathItem[] = [
    { label: m.nav_projects(), link: { to: "/projects" } },
    { label: project.name, link: projectLink(project.id) },
    ...(group ? [{ label: group.name, link: groupStepLink(group, step) }] : []),
  ]
  return (
    <>
      <StepPage
        path={path}
        title={run.name}
        status={<RunBadge run={run} />}
        menu={{ label: m.project_run_noun_capital(), items: useRunMenu(ctx, () => setEditing(true)) }}
        flow={flow}
        viewing={step}
        stepsLabel={m.calibration_steps_of({ name: run.name })}
        notice={trashNotice(m, run)}
        step={
          step === "select" ? (
            <SelectStep ctx={ctx} editable={editable} />
          ) : step === "calibrate" ? (
            <CalibrateStep key={run.id} ctx={ctx} editable={editable} />
          ) : step === "prepare" ? (
            <PrepareStep ctx={ctx} plan={plan} editable={editable} />
          ) : (
            <ResultsStep ctx={ctx} editable={editable} />
          )
        }
      />
      <EditRunDialog run={run} open={editing} onOpenChange={setEditing} />
    </>
  )
}

/** The header's StatusBadge: Open, Finished (C2) or Trashed. */
function RunBadge({ run }: { run: Run }) {
  const m = useMessages()
  if (run.trashedAt) return <StatusBadge kind="run" value="trashed" />
  if (run.completion === "complete") return <StatusBadge kind="run" value="complete" label={m.status_finished()} />
  return <StatusBadge kind="run" value="open" />
}

/** A trashed run's standing state: when it went, with Restore (D-W72). */
function trashNotice(m: Messages, run: Run): PageNotice | null {
  if (!run.trashedAt) return null
  const restore: Action = { id: "restore", label: m.run_restore(), run: () => restoreRun(run.id) }
  return { tone: "warning", title: m.run_in_trash({ date: formatDateTime(run.trashedAt) }), detail: m.run_trash_waits_detail(), actions: <ActionButton action={restore} /> }
}

/** Run ▾ (C-7): Edit run…, Open in {app} once prepared, Reopen run… once Finished, and Move to Trash…. */
function useRunMenu(ctx: RunContext, edit: () => void): MenuItem[] {
  const m = useMessages()
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const { run } = ctx
  if (run.trashedAt) return []
  const prep = currentPreparation(run, runPreparations(state.catalog, run.id))
  const profile = prep ? state.catalog.profiles[prep.profileId] : undefined
  const items: MenuItem[] = [{ id: "edit", label: m.run_edit(), opensDialog: true, run: edit }]
  if (prep?.state === "prepared" && profile) items.push({ id: "open", label: m.run_open_in({ app: say(m, profileRef(profile)) }), run: () => openPreparation(run.id) })
  if (run.completion === "complete") {
    items.push({
      id: "reopen",
      label: m.run_reopen_run(),
      confirm: { title: m.project_reopen_title({ name: run.name }), summary: m.run_reopen_summary(), confirm: { label: m.run_reopen_run() } },
      // Owner tick A2: Undo is Finish run, keeping the run view, so nothing on disk moves either way.
      quick: { oneClick: { undo: () => ({ message: m.run_reopened({ name: run.name }), run: () => finishRun(run.id, { keepView: true }).result }) }, openPage: "keep" },
      run: () => {
        const { result } = reopenRun(run.id)
        if (result.ok) void navigate(runStepLink(run, runFlowState(store.getState(), store.getState().catalog.runs[run.id]!).current) as never)
        return result
      },
    })
  }
  const blockers = trashRefusals(state, run)
  items.push({
    id: "trash",
    label: m.run_move_to_trash(),
    kind: "destructive",
    unavailable: blockers.length > 0 ? { action: m.run_trash_blocked(), reason: m.refusal_blockers({ count: blockers.length }), blockers: blockers.map((b) => ({ label: say(m, b) })) } : undefined,
    confirm: { title: m.run_trash_title({ name: run.name }), summary: m.run_trash_leaves(), confirm: { label: m.run_move_to_trash(), kind: "destructive" } },
    run: () => trashRun(run.id),
  })
  return items
}

/** Edit run (B S10): the run's name, unique within its Project among runs and run groups. */
function EditRunDialog({ run, open, onOpenChange }: { run: Run; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const [name, setName] = useState(run.name)
  const confirm: Action = { id: "save-run", label: m.verb_save(), kind: "primary", run: () => renameRun(run.id, name) }
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setName(run.name)
        onOpenChange(next)
      }}
      title={m.run_edit()}
      size="sm"
      confirm={confirm}
    >
      <TextField label={m.run_name_label()} value={name} onChange={setName} autoFocus />
    </FormDialog>
  )
}
