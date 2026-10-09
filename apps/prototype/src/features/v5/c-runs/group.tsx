/**
 * S7 Run group (slice C): panels with per-panel status, the shared setup,
 * Review all (slice D's `GroupReviewStep`), calibration readiness per panel,
 * Prepare all and the group outcome; a trashed panel is listed as Trashed
 * (D-W38, D-W41, D-W73, D-W75). Foundation placeholder; slice C replaces
 * this file and keeps rendering `GroupReviewStep` for `review`.
 */
import { Link, useParams } from "@tanstack/react-router"
import { MissingRecord } from "@/app/missing-record"
import { GateLabel } from "@/app/run-ui"
import { SCREENS } from "@/app/screens"
import { PlaceholderPage } from "@/components/app/page"
import { groupPipeline, panelLabel, rigName } from "@/domain/derive"
import { RUN_STEPS, STEP_LABEL } from "@/domain/labels"
import type { RunStep } from "@/domain/types"
import { useStore } from "@/store/core"
import { GroupReviewStep } from "../d-review/review"

export function RunGroupPage() {
  const { projectId, groupId, step } = useParams({ strict: false }) as { projectId?: string; groupId?: string; step?: string }
  const state = useStore((s) => s)
  const group = groupId ? state.catalog.runGroups[groupId] : undefined
  const project = group ? state.catalog.projects[group.projectId] : undefined
  if (!group || !project || group.projectId !== projectId) return <MissingRecord noun="run group" backTo={projectId ? `/projects/${projectId}` : "/projects"} backLabel="Open the Project" />
  if (!RUN_STEPS.includes(step as RunStep)) return <MissingRecord noun="run step" backTo={`/projects/${project.id}/groups/${group.id}/select`} backLabel="Open Select" />
  const pipeline = groupPipeline(state, group)
  const here = pipeline.steps.find((s) => s.id === step)!
  return (
    <PlaceholderPage
      screen={SCREENS.S7}
      title={group.name}
      eyebrow={
        <Link to="/projects/$projectId" params={{ projectId: project.id }}>
          {project.name}
        </Link>
      }
      facts={[
        { label: "Rig", value: `${rigName(state.catalog, group.rigId)} (fixed)` },
        { label: STEP_LABEL[here.id], value: <GateLabel state={here.state} label={here.status} /> },
        ...pipeline.panels.map((p) => ({
          label: panelLabel(p.panel),
          value: p.trashed ? "Trashed" : <GateLabel state={p.pipeline.current.state} label={`${p.pipeline.current.label}: ${p.pipeline.current.status}`} />,
        })),
        { label: "Open group folder", value: pipeline.allVerified ? "Every panel is verified" : "Only when every panel is verified" },
      ]}
    >
      {here.id === "review" ? <GroupReviewStep groupId={group.id} /> : null}
    </PlaceholderPage>
  )
}
