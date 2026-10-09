/**
 * S5 Run (slice C): the run header (subject and rig as pills, fixed at
 * creation; Open / Complete / Trashed; Complete, Reopen, Move to Trash,
 * Restore and Clean up), the step bar, and the Select, Calibrate, Prepare,
 * Results and Done steps. The Review step is slice D's `ReviewStep`, mounted
 * here as the last child of the pane's flex column (D-W3, D-W50, D-W49,
 * D-W54, D-W5, D-W55, D-W51, D-W4, D-W56, D-W26, D-W72).
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ChevronRight, Lock, RotateCcw, Telescope, Trash2, Undo2, Wand2 } from "lucide-react"
import { useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PageBody, PageHeader } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { nextFrom, panelLabel, rigName, runPipeline, runStepLink, subjectName, trashRefusals } from "@/domain/derive"
import { RUN_STEPS, STEP_LABEL } from "@/domain/labels"
import type { RunStep } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import { reopenRun, restoreRun, trashRun } from "@/store/actions/runs"
import { useStore } from "@/store/core"
import { ReviewStep } from "../d-review/review"
import { CalibrateStep } from "./calibrate-step"
import { CompleteButton, DoneStep } from "./done-step"
import { type RunContext, runContext } from "./model"
import { OutcomeNotice, StepBar, useOutcome } from "./parts"
import { PrepareStep } from "./prepare-step"
import { ResultsStep } from "./results-step"
import { SelectStep } from "./select-step"

export function RunPage() {
  const { projectId, runId, step } = useParams({ strict: false }) as { projectId?: string; runId?: string; step?: string }
  const state = useStore((s) => s)
  const ctx = runId ? runContext(state, runId) : null
  if (!ctx || ctx.run.projectId !== projectId) return <MissingRecord noun="run" backTo={projectId ? `/projects/${projectId}` : "/projects"} backLabel="Open the Project" />
  if (!RUN_STEPS.includes(step as RunStep)) return <MissingRecord noun="run step" backTo={`/projects/${ctx.project.id}/runs/${ctx.run.id}/select`} backLabel="Open Select" />
  return <RunScreen ctx={ctx} step={step as RunStep} />
}

function RunScreen({ ctx, step }: { ctx: RunContext; step: RunStep }) {
  const state = useStore((s) => s)
  const { run, project, subject, panel, group } = ctx
  const pipeline = runPipeline(state, run)
  const outcome = useOutcome(`${run.id}:${step}`)
  const subjectText = `${subject ? subjectName(state.catalog, subject) : "Unknown subject"}${panel ? ` · ${panelLabel(panel)}` : ""}`
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-screen="S5">
      <PageHeader
        title={run.name}
        eyebrow={
          <>
            <Link to="/projects/$projectId" params={{ projectId: project.id }}>
              {project.name}
            </Link>
            {group ? (
              <>
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                <Link to="/projects/$projectId/groups/$groupId/$step" params={{ projectId: project.id, groupId: group.id, step }}>
                  {group.name}
                </Link>
              </>
            ) : null}
          </>
        }
        meta={<StatusBadge kind="run" value={pipeline.status} />}
        description={
          <span className="flex flex-wrap items-center gap-1.5" data-run-facts>
            <Pill tone="muted" icon={Telescope} title="Subject (fixed)">
              {subjectText}
            </Pill>
            <Pill tone="muted" icon={Lock} title="Rig (fixed)">
              {rigName(state.catalog, run.rigId)}
            </Pill>
          </span>
        }
        actions={<RunActions ctx={ctx} step={step} onOutcome={outcome.act} />}
      />
      <StepBar
        label={`${run.name} steps`}
        steps={pipeline.steps}
        here={step}
        nextId={nextFrom(pipeline.steps, pipeline.next, step)?.step?.id ?? null}
        linkFor={(id) => runStepLink(run, id) as { to: string; params: Record<string, string> }}
      />
      {outcome.outcome || run.trashedAt ? (
        <div className="space-y-2 px-5 pt-3">
          <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
          {run.trashedAt ? (
            <div className="flex flex-wrap items-center gap-2" data-run-trashed>
              <Pill tone="muted" icon={Trash2} title={`Restore returns it to ${STEP_LABEL[pipeline.current.id]}`}>
                In Trash · {formatDateTime(run.trashedAt)}
              </Pill>
              <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/trash" params={{ projectId: project.id }} />}>
                Open Trash
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {step === "review" ? (
        <ReviewStep runId={run.id} />
      ) : (
        <PageBody>
          {step === "select" ? <SelectStep ctx={ctx} /> : null}
          {step === "calibrate" ? <CalibrateStep ctx={ctx} /> : null}
          {step === "prepare" ? <PrepareStep ctx={ctx} /> : null}
          {step === "results" ? <ResultsStep ctx={ctx} /> : null}
          {step === "done" ? <DoneStep ctx={ctx} outcome={outcome} /> : null}
        </PageBody>
      )}
    </div>
  )
}

/** Header actions: each one does what it says, or names why it is refused. On Done, Complete and Clean up live in the step itself. */
function RunActions({ ctx, step: here, onOutcome }: { ctx: RunContext; step: RunStep; onOutcome: ReturnType<typeof useOutcome>["act"] }) {
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const { run, project } = ctx
  const [confirmTrash, setConfirmTrash] = useState(false)
  const goTo = (step: RunStep) => void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: run.projectId, runId: run.id, step } })
  if (run.trashedAt) {
    return (
      <Button size="sm" onClick={() => onOutcome(restoreRun(run.id), { title: `${run.name} restored`, tone: "info" })}>
        <Undo2 aria-hidden="true" data-icon="inline-start" />
        Restore
      </Button>
    )
  }
  const requestTrash = () => {
    const blockers = trashRefusals(state, run)
    if (blockers.length > 0) {
      onOutcome(trashRun(run.id))
      return
    }
    setConfirmTrash(true)
  }
  return (
    <>
      {here === "done" ? null : run.completion === "complete" ? (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const { result, step } = reopenRun(run.id)
              if (onOutcome(result)) goTo(step)
            }}
          >
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            Reopen
          </Button>
          <Button size="sm" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: run.projectId, runId: run.id, step: "done" }} hash="cleanup" />}>
            <Wand2 aria-hidden="true" data-icon="inline-start" />
            Clean up
          </Button>
        </>
      ) : (
        <CompleteButton ctx={ctx} onOutcome={onOutcome} variant="outline" />
      )}
      <Button size="sm" variant="ghost" onClick={requestTrash}>
        <Trash2 aria-hidden="true" data-icon="inline-start" />
        Move to Trash
      </Button>
      <ConfirmDialog
        open={confirmTrash}
        onOpenChange={setConfirmTrash}
        title={`Move ${run.name} to the Trash?`}
        description="No file moves."
        changes={[`Waits in ${project.name}'s Trash at ${STEP_LABEL[runPipeline(state, run).current.id]}`, "Leaves run lists, pickers and goal totals"]}
        confirmLabel="Move to Trash"
        tone="destructive"
        onConfirm={() => {
          const result = trashRun(run.id)
          onOutcome(result)
          return result
        }}
      />
    </>
  )
}
