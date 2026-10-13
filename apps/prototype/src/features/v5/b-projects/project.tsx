/**
 * S3 Project (`/projects/$projectId`; DetailPage with tabs Runs · Wrap up,
 * D10, §5.7). The header carries the path, the StatusBadge (Open, Closed or
 * Archived), Start run… as the one primary, and the Project ▾ menu: Edit…
 * (unavailable while closed, "Project closed · Reopen ▸") and, for a closed
 * Project, Reopen project…. A closed Project shows its standing state in the
 * notice slot and reads its frozen goal figures (§5.6, C7).
 *
 * Search keys (routes.tsx): `?start=run` opens Start run; `?stage=wrap-up`
 * (with `&step=`) shows the Wrap up tab, a StepPage; `?mosaic=new|<subjectId>`
 * opens the mosaic editor (`&rig=`, `&profile=`, `&sessions=`).
 */
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { PackageCheck, Pencil, Play, RotateCcw } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { openSheet } from "@/app/ui-state"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { EmptyState, type PageNotice } from "@/components/app/feedback"
import type { PathItem } from "@/components/app/page"
import { BlockersPreview } from "@/components/app/previews"
import { StatusBadge } from "@/components/app/status"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import type { ObjectMenu, PageViews } from "@/components/templates/parts"
import { PROJECT_STATUS_NAME, projectStatus, projectTabs } from "@/domain/derive"
import type { Project } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import { say } from "@/lib/i18n"
import { reopenProject } from "@/store/actions/projects"
import { useStore } from "@/store/core"
import { ProjectDetailsDialog } from "./details-dialog"
import { MosaicEditor } from "./mosaic-editor"
import { useArchivedSection, useCandidatesSection, useGoalsSection, usePlanningSection, useRigsSection, useRunsSection, useSubjectsSection } from "./project-sections"
import { WrapUpPage } from "./wrap-up"

type View = "runs" | "wrap-up"

export function ProjectPage() {
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string }
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const navigate = useNavigate()
  const m = useMessages()
  const project = useStore((s) => s.catalog.projects[projectId])

  // `?start=run` opens its dialog once, then leaves a clean URL.
  useEffect(() => {
    if (!project || search.start !== "run") return
    openSheet({ kind: "start-run", projectId: project.id })
    void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: {}, replace: true })
  }, [project, search.start, navigate])

  if (!project) return <MissingRecord title={m.project_missing_title()} backTo="/projects" backLabel={m.project_back_to_projects()} />
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
  return <ProjectView project={project} view={search.stage === "wrap-up" ? "wrap-up" : "runs"} step={search.step} />
}

/** The header every view of the Project shares: path, status, Start run…, Project ▾ and the closed notice. */
export interface ProjectChrome {
  path: PathItem[]
  status: ReactNode
  actions: Action[]
  menu: ObjectMenu
  notice: PageNotice | null
  views: PageViews
}

function useProjectChrome(project: Project, view: View, onEdit: () => void): ProjectChrome {
  const m = useMessages()
  const navigate = useNavigate()
  const tabs = useStore((s) => projectTabs(s, project))
  const status = projectStatus(project)
  const open = project.state === "open"
  const archived = project.archive?.sessionIds.length ?? 0
  const editLabel = m.project_edit()
  const reopen: Action = {
    id: "reopen",
    label: m.project_reopen_project(),
    icon: RotateCcw,
    confirm: {
      title: m.project_reopen_title({ name: project.name }),
      summary: archived > 0 ? m.project_reopen_summary_archived({ count: archived }) : m.project_reopen_summary(),
      confirm: { label: m.project_reopen_project() },
    },
    run: () => reopenProject(project.id),
  }
  const edit: Action = {
    id: "edit",
    label: editLabel,
    icon: Pencil,
    opensDialog: true,
    unavailable: open ? undefined : { action: m.actions_blocked({ action: editLabel }), reason: m.project_closed(), blockers: [{ label: m.project_reopen_project() }] },
    run: onEdit,
  }
  return {
    path: [{ label: m.nav_projects(), link: { to: "/projects" } }],
    status: <StatusBadge kind="project" value={status} label={say(m, PROJECT_STATUS_NAME[status])} />,
    actions: open ? [{ id: "start-run", label: m.startrun_title(), icon: Play, kind: "primary", opensDialog: true, run: () => openSheet({ kind: "start-run", projectId: project.id }) }] : [],
    menu: { label: m.project_noun(), items: open ? [edit] : [edit, reopen] },
    notice: open
      ? null
      : {
          tone: "info",
          title: project.doneAt ? m.project_closed_notice({ date: formatDateTime(project.doneAt) }) : m.project_closed(),
          actions: <ActionButton action={reopen} />,
        },
    views: {
      label: m.project_views(),
      value: view,
      items: tabs.tabs.map((tab) => ({ id: tab.id, label: say(m, tab.label), count: tab.count ?? undefined })),
      onChange: (id) => void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: id === "wrap-up" ? { stage: "wrap-up" } : {} }),
    },
  }
}

function ProjectView({ project, view, step }: { project: Project; view: View; step?: string }) {
  const [editing, setEditing] = useState(false)
  const chrome = useProjectChrome(project, view, () => setEditing(true))
  return (
    <>
      {view === "wrap-up" ? <WrapUpView project={project} chrome={chrome} step={step} /> : <RunsView project={project} chrome={chrome} />}
      <ProjectDetailsDialog project={project} open={editing} onOpenChange={setEditing} />
    </>
  )
}

/** The Runs tab: runs first, then candidates, goals, subjects, rigs, tonight and the archived sessions. */
function RunsView({ project, chrome }: { project: Project; chrome: ProjectChrome }) {
  const m = useMessages()
  const runs = useRunsSection(project)
  const candidates = useCandidatesSection(project)
  const goals = useGoalsSection(project)
  const subjects = useSubjectsSection(project)
  const rigs = useRigsSection(project)
  const planning = usePlanningSection(project)
  const archived = useArchivedSection(project)
  const notes: DetailSection | null = project.notes.trim() ? { id: "notes", title: m.newproject_notes(), content: project.notes } : null
  const sections = [notes, runs, candidates, goals, subjects, rigs, planning, archived].filter((s): s is DetailSection => s !== null)
  return <DetailPage {...chrome} title={project.name} sections={sections} />
}

/** The Wrap up tab: its StepPage once every run is Finished or Trashed; before then, one line and the runs it waits on (§5.5). */
function WrapUpView({ project, chrome, step }: { project: Project; chrome: ProjectChrome; step?: string }) {
  const m = useMessages()
  const unavailable = useStore((s) => projectTabs(s, project).wrapUpUnavailable)
  if (!unavailable) return <WrapUpPage project={project} chrome={chrome} step={step} />
  const section: DetailSection = {
    id: "wrap-up",
    title: m.wrapup_action(),
    content: (
      <EmptyState
        icon={PackageCheck}
        title={say(m, unavailable.reason)}
        action={
          unavailable.blockers.length > 0 ? (
            <BlockersPreview action={m.wrapup_action()} reason={m.wrapup_show_open_runs()} blockers={unavailable.blockers.map((b) => ({ label: say(m, b.label), link: b.link }))} />
          ) : (
            <ActionButton action={{ id: "start-run", label: m.startrun_title(), opensDialog: true, run: () => openSheet({ kind: "start-run", projectId: project.id }) }} />
          )
        }
      />
    ),
  }
  return <DetailPage {...chrome} title={project.name} sections={[section]} />
}
