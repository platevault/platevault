/**
 * S3 Project (`/projects/$projectId`; D-W9, D-W16, D-W26, D-W29, D-W33,
 * D-W36, D-W37, D-W38, D-W46, D-W59, D-W65, D-W69, D-W72, P-WRAP1). The
 * header carries the stage strip, Open → Runs → Wrap up → Done (or
 * Archived), from `projectStageStrip`; Runs opens the Project's work and
 * Wrap up its stage page. A Done Project offers Reopen, which moves no file.
 * The toolbar Next is the one primary action, so the header has none.
 *
 * Search keys (routes.tsx): `?start=run` opens Start run; `?stage=wrap-up`
 * opens the Wrap up stage; `?candidates=unreviewed|all` opens frame review
 * over the candidates (PIX-FR-18, with `&filter=` and `&assetId=`);
 * `?mosaic=new|<subjectId>` opens the mosaic editor (`&rig=`, `&profile=`,
 * `&sessions=`).
 */
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { Check, ChevronRight, RotateCcw } from "lucide-react"
import { useEffect } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PageBody, PageHeader } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import type { Tone } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { MissingRecord } from "@/app/missing-record"
import { openSheet } from "@/app/ui-state"
import { type ProjectStageId, projectGroups, projectLink, projectRuns, projectStageStrip, projectWrapUp, type StepLink } from "@/domain/derive"
import type { Project } from "@/domain/types"
import { plural } from "@/lib/format"
import { reopenProject } from "@/store/actions/projects"
import { useStore } from "@/store/core"
import { CandidateReview } from "../d-review/review"
import { MosaicEditor } from "./mosaic-editor"
import { ArchivedSection, CandidatesSection, GoalsSection, PlanningSection, RigsSection, RunsSection, SubjectsSection } from "./project-sections"
import { WrapUpStage } from "./wrap-up"

type View = "runs" | "wrap-up"

export function ProjectPage() {
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string }
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const navigate = useNavigate()
  const project = useStore((s) => s.catalog.projects[projectId])

  // `?start=run` opens its sheet once, then leaves a clean URL.
  useEffect(() => {
    if (!project || search.start !== "run") return
    openSheet({ kind: "start-run", projectId: project.id })
    void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: {}, replace: true })
  }, [project, search.start, navigate])

  if (!project) return <MissingRecord noun="Project" backTo="/projects" backLabel="Open Projects" />
  if (search.candidates) return <CandidateReviewPage project={project} />
  if (search.mosaic) {
    return (
      <MosaicEditor
        key={`${search.mosaic}|${search.sessions ?? ""}`}
        project={project}
        subjectId={search.mosaic === "new" ? null : search.mosaic}
        rigId={search.rig}
        profileId={search.profile}
        sessionIds={search.sessions ? search.sessions.split(",") : undefined}
      />
    )
  }
  return <ProjectDetail project={project} view={search.stage === "wrap-up" ? "wrap-up" : "runs"} />
}

function ProjectDetail({ project, view }: { project: Project; view: View }) {
  const archived = project.archive?.sessionIds.length ?? 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <Link to="/projects" className="underline-offset-2 hover:underline">
            Projects
          </Link>
        }
        title={project.name}
        meta={<StageStrip project={project} view={view} />}
        description={project.notes || undefined}
        actions={
          project.state === "done" ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline">
                  <RotateCcw aria-hidden="true" data-icon="inline-start" />
                  Reopen…
                </Button>
              }
              title={`Reopen ${project.name}?`}
              description="No file moves."
              changes={["Project Done → Open"]}
              unchanged={archived > 0 ? [`${plural(archived, "session")} stay archived until restored`] : undefined}
              confirmLabel="Reopen"
              onConfirm={() => reopenProject(project.id)}
            />
          ) : null
        }
      />
      <PageBody className="space-y-4">
        {view === "wrap-up" ? (
          <WrapUpStage project={project} />
        ) : (
          <>
            <RunsSection project={project} />
            <CandidatesSection project={project} />
            <GoalsSection project={project} />
            <div className="grid gap-4 xl:grid-cols-2">
              <SubjectsSection project={project} />
              <RigsSection project={project} />
            </div>
            <PlanningSection project={project} />
            <ArchivedSection project={project} />
          </>
        )}
      </PageBody>
    </div>
  )
}

const STAGE_TONE: Record<"done" | "current" | "todo", Tone> = { done: "success", current: "info", todo: "muted" }

/** Open → Runs → Wrap up → Done / Archived; Runs and Wrap up switch the page between the Project's work and its Wrap up stage. */
function StageStrip({ project, view }: { project: Project; view: View }) {
  const strip = useStore((s) => projectStageStrip(s.catalog, project))
  const runs = useStore((s) => projectRuns(s.catalog, project.id).filter((r) => !r.groupId).length + projectGroups(s.catalog, project.id).length)
  const wrapOpen = useStore((s) => projectWrapUp(s.catalog, project).available) || project.state === "done"
  const link = (id: ProjectStageId): StepLink | undefined => (id === "runs" && view !== "runs" ? projectLink(project.id) : id === "wrap-up" && wrapOpen && view !== "wrap-up" ? projectLink(project.id, { stage: "wrap-up" }) : undefined)
  return (
    <ol aria-label="Project stage" className="flex flex-wrap items-center gap-1">
      {strip.stages.map((stage, index) => (
        <li key={stage.id} aria-current={stage.state === "current" ? "step" : undefined} className="flex items-center gap-1">
          {index > 0 ? <ChevronRight aria-hidden="true" className="size-3 text-muted-foreground" /> : null}
          <Pill tone={STAGE_TONE[stage.state]} icon={stage.state === "done" ? Check : undefined} link={link(stage.id)} className={view === stage.id ? "ring-2 ring-ring/60" : undefined}>
            {stage.id === "runs" ? `Runs · ${runs}` : stage.label}
            {stage.state === "current" ? <span className="sr-only"> (current stage)</span> : null}
          </Pill>
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Candidate review (`?candidates=`, PIX-FR-18)
// ---------------------------------------------------------------------------

function CandidateReviewPage({ project }: { project: Project }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <Link to="/projects/$projectId" params={{ projectId: project.id }} className="underline-offset-2 hover:underline">
            {project.name}
          </Link>
        }
        title="Candidate frames"
        actions={
          <Button size="sm" variant="outline" render={<Link to="/projects/$projectId" params={{ projectId: project.id }} />}>
            Done
          </Button>
        }
      />
      <CandidateReview projectId={project.id} />
    </div>
  )
}
