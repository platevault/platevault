/**
 * S5 Run (slice C): the run header (subject and rig, fixed; Open / Complete
 * / Trashed; Complete, Reopen, Move to Trash, Restore, Clean up) and the
 * Select, Calibrate, Prepare, Results and Done steps. The Review step is
 * slice D's `ReviewStep`, rendered here inside the run (D-W3, D-W50, D-W49,
 * D-W54, D-W5, D-W55, D-W51, D-W4, D-W56, D-W26, D-W72).
 * Foundation placeholder; slice C replaces this file and keeps rendering
 * `ReviewStep` for `review`.
 */
import { Link, useParams } from "@tanstack/react-router"
import { MissingRecord } from "@/app/missing-record"
import { GateLabel } from "@/app/run-ui"
import { SCREENS } from "@/app/screens"
import { PlaceholderPage } from "@/components/app/page"
import { findPanel, findSubject, latestRevision, panelLabel, rigName, runPipeline, runSetup, subjectName } from "@/domain/derive"
import { CALIBRATION_POLICY_LABEL, MODE_LABEL, RUN_STEPS, STEP_LABEL } from "@/domain/labels"
import type { RunStep } from "@/domain/types"
import { useStore } from "@/store/core"
import { ReviewStep } from "../d-review/review"

export function RunPage() {
  const { projectId, runId, step } = useParams({ strict: false }) as { projectId?: string; runId?: string; step?: string }
  const state = useStore((s) => s)
  const { catalog } = state
  const run = runId ? catalog.runs[runId] : undefined
  const project = run ? catalog.projects[run.projectId] : undefined
  if (!run || !project || run.projectId !== projectId) return <MissingRecord noun="run" backTo={projectId ? `/projects/${projectId}` : "/projects"} backLabel="Open the Project" />
  if (!RUN_STEPS.includes(step as RunStep)) return <MissingRecord noun="run step" backTo={`/projects/${project.id}/runs/${run.id}/select`} backLabel="Open Select" />
  const pipeline = runPipeline(state, run)
  const here = pipeline.steps.find((s) => s.id === step)!
  const subject = findSubject(project, run.subjectId)
  const panel = findPanel(subject, run.panelId)
  const setup = runSetup(catalog, run)
  const group = run.groupId ? catalog.runGroups[run.groupId] : undefined
  return (
    <PlaceholderPage
      screen={SCREENS.S5}
      title={run.name}
      eyebrow={
        <Link to="/projects/$projectId" params={{ projectId: project.id }}>
          {project.name}
        </Link>
      }
      facts={[
        { label: "Subject · rig", value: `${subject ? subjectName(catalog, subject) : "Unknown subject"}${panel ? ` ${panelLabel(panel)}` : ""} · ${rigName(catalog, run.rigId)} (fixed)` },
        { label: "Status", value: pipeline.status === "trashed" ? "Trashed" : pipeline.status === "complete" ? "Complete" : "Open" },
        { label: STEP_LABEL[here.id], value: <GateLabel state={here.state} label={here.status} /> },
        { label: "Next", value: pipeline.next ? `${pipeline.next.label}: ${pipeline.next.reason}` : "None" },
        { label: "Blocker", value: pipeline.blocker ? `${STEP_LABEL[pipeline.blocker.step]}: ${pipeline.blocker.message}` : "None" },
        { label: "Setup", value: `${setup.profileId ? (catalog.profiles[setup.profileId]?.name ?? setup.profileId) : "No profile"} · ${setup.inputMode ? MODE_LABEL[setup.inputMode] : "Mode not chosen"} · calibration ${CALIBRATION_POLICY_LABEL[setup.calibrationPolicy]}${group ? ` (shared by ${group.name})` : ""}` },
        { label: "Membership", value: latestRevision(run) ? `Revision ${latestRevision(run)!.revision}${run.draft ? " · unsaved changes" : ""}` : "Not saved yet" },
      ]}
    >
      {here.id === "review" ? <ReviewStep runId={run.id} /> : null}
    </PlaceholderPage>
  )
}
