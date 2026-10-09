/**
 * S3 Project (`/projects/$projectId`; D-W9, D-W16, D-W26, D-W29, D-W33,
 * D-W36, D-W37, D-W38, D-W46, D-W59, D-W65, D-W72). The header holds the
 * state (Open / Done / Archived) and its actions: Mark Done names each run
 * that is not Complete and refuses until it is completed or trashed; Done
 * opens the Done / Archive sheet; Reopen returns the Project to open without
 * moving a file. The sections follow: subjects, rigs, goals, candidates,
 * runs, planning, archived sessions and Trash.
 *
 * Search keys (routes.tsx): `?sheet=done` opens the Done / Archive sheet,
 * `?start=run` opens Start a processing run, and `?candidates=unreviewed`
 * opens frame review over the candidates filtered to Unreviewed (PIX-FR-18).
 */
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { Archive, CheckCheck, Play, RotateCcw, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MissingRecord } from "@/app/missing-record"
import { GateLabel } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import { markDoneBlockers, projectStatus, projectTrash, rigName, runPipeline, subjectName } from "@/domain/derive"
import type { Project, Run } from "@/domain/types"
import { plural } from "@/lib/format"
import { markProjectDone, reopenProject } from "@/store/actions/projects"
import { completeRun, trashRun } from "@/store/actions/runs"
import { useStore } from "@/store/core"
import { projectChannels } from "./model"
import { InlineError, ProjectStateBadge, useCommitError } from "./parts"
import { ArchivedSection, CandidatesSection, CandidatesTable, GoalsSection, PlanningSection, RigsSection, RunsSection, SubjectsSection, TrashSection } from "./project-sections"

export function ProjectPage() {
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string }
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const navigate = useNavigate()
  const project = useStore((s) => s.catalog.projects[projectId])

  // Documented entry points open their sheet once, then leave a clean URL.
  useEffect(() => {
    if (!project) return
    const sheet = search.sheet === "done" ? "done-archive" : search.start === "run" ? "start-run" : null
    if (!sheet) return
    openSheet(sheet === "done-archive" ? { kind: "done-archive", projectId: project.id } : { kind: "start-run", projectId: project.id })
    void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: search.candidates ? { candidates: search.candidates } : {}, replace: true })
  }, [project, search.sheet, search.start, search.candidates, navigate])

  if (!project) return <MissingRecord noun="Project" backTo="/projects" backLabel="Open Projects" />
  if (search.candidates === "unreviewed") return <CandidateReviewPage project={project} />
  return <ProjectDetail project={project} />
}

function ProjectDetail({ project }: { project: Project }) {
  const catalog = useStore((s) => s.catalog)
  const trashCount = useStore((s) => projectTrash(s.catalog, project.id).length)
  const status = projectStatus(project)
  const reopen = useCommitError()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <Link to="/projects" className="underline-offset-2 hover:underline">
            Projects
          </Link>
        }
        title={project.name}
        meta={<ProjectStateBadge status={status} />}
        description={project.notes || `${plural(project.subjects.length, "subject")} · ${plural(project.rigIds.length, "rig")}`}
        actions={
          <>
            <Button size="sm" variant="ghost" render={<Link to="/projects/$projectId/trash" params={{ projectId: project.id }} />}>
              <Trash2 aria-hidden="true" data-icon="inline-start" />
              Trash ({trashCount})
            </Button>
            {project.state === "open" ? (
              <>
                <MarkDoneButton project={project} />
                <Button size="sm" onClick={() => openSheet({ kind: "start-run", projectId: project.id })}>
                  <Play aria-hidden="true" data-icon="inline-start" />
                  Start a processing run
                </Button>
              </>
            ) : (
              <>
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      <RotateCcw aria-hidden="true" data-icon="inline-start" />
                      Reopen…
                    </Button>
                  }
                  title={`Reopen ${project.name}?`}
                  description="The Project returns to open with its runs, goals and members unchanged."
                  changes={["Project state Done → Open", ...(project.archive ? [`${plural(project.archive.sessionIds.length, "archived session")} keep reading Archived until you restore them`] : [])]}
                  unchanged={["No file moves", "Every run, goal and member"]}
                  confirmLabel="Reopen"
                  onConfirm={() => reopenProject(project.id)}
                />
                <Button size="sm" onClick={() => openSheet({ kind: "done-archive", projectId: project.id })}>
                  <Archive aria-hidden="true" data-icon="inline-start" />
                  Done / Archive…
                </Button>
              </>
            )}
          </>
        }
      />
      <PageBody>
        <InlineError message={reopen.error} />
        {project.state === "done" ? (
          <Notice
            tone="info"
            title={status === "archived" ? "Done and archived" : "Done"}
            actions={
              <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "done-archive", projectId: project.id })}>
                Open Done / Archive
              </Button>
            }
          >
            {status === "archived"
              ? `${plural(project.archive!.sessionIds.length, "session")} archived. Remaining offers stay on the Done / Archive sheet; Reopen to start new runs.`
              : "Archive and the trash offers wait on the Done / Archive sheet; each is approved on its own. Reopen to start new runs."}
          </Notice>
        ) : null}
        <SubjectsSection project={project} />
        <RigsSection project={project} />
        <GoalsSection project={project} channels={projectChannels(catalog, project.rigIds)} />
        <CandidatesSection project={project} />
        <RunsSection project={project} />
        <PlanningSection project={project} />
        <ArchivedSection project={project} />
        <TrashSection project={project} />
      </PageBody>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mark Done (PRJ-FR-14, D-W46, D-W72)
// ---------------------------------------------------------------------------

function MarkDoneButton({ project }: { project: Project }) {
  const [open, setOpen] = useState(false)
  const blockers = useStore((s) => markDoneBlockers(s.catalog, project))
  const done = useCommitError()
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CheckCheck aria-hidden="true" data-icon="inline-start" />
        Mark Done…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Mark {project.name} Done?</DialogTitle>
            <DialogDescription>
              {blockers.length > 0
                ? `Every run outside the Trash must be Complete first. Complete each run below, or move it to the Project's Trash.`
                : "Done opens the Done / Archive sheet. No file moves until you approve an offer there, and you can Reopen at any time."}
            </DialogDescription>
          </DialogHeader>
          {blockers.length > 0 ? (
            <div className="space-y-2 text-sm">
              <Notice tone="refusal" title={`Mark Done refused: ${plural(blockers.length, "run")} not Complete`} />
              <ul className="divide-y divide-separator rounded-[0.3125rem] border border-separator">
                {blockers.map((run) => (
                  <BlockerRow key={run.id} run={run} onNavigate={() => setOpen(false)} />
                ))}
              </ul>
            </div>
          ) : (
            <div className="divide-y divide-separator rounded-[0.3125rem] border border-separator text-sm">
              <p className="px-3 py-2">Project state Open → Done; the Done / Archive sheet opens with Archive and the trash offers.</p>
              <p className="bg-muted/40 px-3 py-2 text-muted-foreground">Unchanged: every run, goal and member. Reaching goals never marks a Project Done; only you do.</p>
            </div>
          )}
          <InlineError message={done.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {blockers.length > 0 ? "Close" : "Cancel"}
            </Button>
            <Button
              onClick={() => {
                if (
                  done.run(() => {
                    const result = markProjectDone(project.id)
                    return result
                  })
                ) {
                  setOpen(false)
                  openSheet({ kind: "done-archive", projectId: project.id })
                }
              }}
            >
              Mark Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function BlockerRow({ run, onNavigate }: { run: Run; onNavigate: () => void }) {
  const state = useStore((s) => s)
  const pipeline = runPipeline(state, run)
  const project = state.catalog.projects[run.projectId]
  const subject = project?.subjects.find((s) => s.id === run.subjectId)
  const action = useCommitError()
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium">{run.name}</span>
          <span className="block text-xs text-muted-foreground">
            {subject ? subjectName(state.catalog, subject) : "Unknown subject"} · {rigName(state.catalog, run.rigId)}
          </span>
        </div>
        <GateLabel state={pipeline.current.state} label={`At ${pipeline.current.label}: ${pipeline.current.status}`} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: run.projectId, runId: run.id, step: pipeline.current.id }} onClick={onNavigate} />}>
          Open run
        </Button>
        <Button size="sm" variant="outline" onClick={() => action.run(() => completeRun(run.id))}>
          Complete<span className="sr-only"> {run.name}</span>
        </Button>
        <Button size="sm" variant="destructive" onClick={() => action.run(() => trashRun(run.id))}>
          Move to Trash<span className="sr-only"> {run.name}</span>
        </Button>
      </div>
      <InlineError message={action.error} />
    </li>
  )
}

// ---------------------------------------------------------------------------
// Candidate review (`?candidates=unreviewed`, PIX-FR-18)
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
        title="Review new frames"
        description="Frame review over the Project's candidate sessions, filtered to Unreviewed."
        actions={
          <Button size="sm" variant="outline" render={<Link to="/projects/$projectId" params={{ projectId: project.id }} />}>
            Back to {project.name}
          </Button>
        }
      />
      <CandidateReviewRegion projectId={project.id} />
    </div>
  )
}

/**
 * The full-height region for `?candidates=unreviewed`: slice D's
 * `CandidateReview` mounts here at integration. Until then it lists the
 * candidate sessions with Unreviewed frames, each opening its session.
 */
function CandidateReviewRegion({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.catalog.projects[projectId])
  if (!project) return null
  // INTEGRATE: <CandidateReview projectId={id} /> from d-review/review
  return (
    <div className="flex min-h-[40rem] min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
      <CandidatesTable project={project} filter="unreviewed" />
    </div>
  )
}
