/**
 * S3 Project (`/projects/$projectId`; DetailPage with the tabs Sessions ·
 * Calibrate · View · Output · Wrap up, PRJ-FR-07). The header carries the
 * path, the StatusBadge (Open, Closed or Archived), Apply… as the one
 * primary while the Project is open, and the Project ▾ menu: Edit…
 * (unavailable once closed) and Duplicate…. A Closed or Archived Project is
 * locked for good (there is no Reopen): it shows its standing state in the
 * notice slot, reads its frozen goal figures, and Duplicate… continues it
 * (PRJ-FR-25, PRJ-FR-30).
 *
 * Search keys (routes.tsx): `?stage=` picks the tab (sessions by default;
 * wrap-up takes `&step=`, a StepPage); `?add=goal` opens Add goal (the
 * Goals section).
 */
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { Copy, Pencil, RefreshCw } from "lucide-react"
import { type ReactNode, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import type { PageNotice } from "@/components/app/feedback"
import type { PathItem } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import type { ObjectMenu, PageViews } from "@/components/templates/parts"
import { isLocked, PROJECT_STATUS_NAME } from "@/domain/derive"
import { PROJECT_TABS, type ProjectTabId, projectTabs } from "@/domain/project-view"
import type { Project } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import { say } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { useCalibrateSections } from "./calibrate-step"
import { ProjectDetailsDialog } from "./details-dialog"
import { DuplicateProjectDialog } from "./duplicate-dialog"
import { useOutputSections } from "./output-step"
import { useArchivedSection, useGoalsSection, useGroupsSection, useHeldSection, usePlanningSection, useRigsSection, useSubjectsSection, useSuggestionsSection } from "./project-sections"
import { openApplySheet, useViewSections } from "./view-step"
import { WrapUpPage } from "./wrap-up"

function tabOf(stage: string | undefined): ProjectTabId {
  return PROJECT_TABS.find((id) => id === stage) ?? "sessions"
}

export function ProjectPage() {
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string }
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const m = useMessages()
  const project = useStore((s) => s.catalog.projects[projectId])
  if (!project) return <MissingRecord title={m.project_missing_title()} backTo="/projects" backLabel={m.project_back_to_projects()} />
  return <ProjectView project={project} tab={tabOf(search.stage)} step={search.step} />
}

/** The header every tab of the Project shares: path, status, Apply…, Project ▾ and the closed notice. */
export interface ProjectChrome {
  path: PathItem[]
  status: ReactNode
  actions: Action[]
  menu: ObjectMenu
  notice: PageNotice | null
  views: PageViews
}

function useProjectChrome(project: Project, tab: ProjectTabId, dialogs: { edit: () => void; duplicate: () => void }): ProjectChrome {
  const m = useMessages()
  const navigate = useNavigate()
  const tabs = useStore((s) => projectTabs(s, project))
  const locked = isLocked(project)
  const editLabel = m.project_edit()
  const edit: Action = {
    id: "edit",
    label: editLabel,
    icon: Pencil,
    opensDialog: true,
    unavailable: locked ? { action: m.actions_blocked({ action: editLabel }), reason: m.project_closed(), blockers: [] } : undefined,
    run: dialogs.edit,
  }
  const duplicate: Action = { id: "duplicate", label: m.project_duplicate(), icon: Copy, opensDialog: true, run: dialogs.duplicate }
  const apply: Action = {
    id: "apply",
    label: m.project_apply(),
    icon: RefreshCw,
    kind: "primary",
    opensDialog: true,
    run: () => {
      openApplySheet(project.id)
      if (tab !== "view") void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { stage: "view" } })
    },
  }
  return {
    path: [{ label: m.nav_projects(), link: { to: "/projects" } }],
    status: <StatusBadge kind="project" value={project.state} label={say(m, PROJECT_STATUS_NAME[project.state])} />,
    actions: locked ? [] : [apply],
    menu: { label: m.project_noun(), items: [edit, duplicate] },
    notice: locked
      ? {
          tone: "info",
          title: project.closedAt ? m.project_closed_notice({ date: formatDateTime(project.closedAt) }) : m.project_closed(),
          actions: <ActionButton action={duplicate} />,
        }
      : null,
    views: {
      label: m.project_views(),
      value: tab,
      items: tabs.tabs.map((t) => ({ id: t.id, label: say(m, t.label), count: t.count ?? undefined })),
      onChange: (id) => void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: id === "sessions" ? {} : { stage: id } }),
    },
  }
}

function ProjectView({ project, tab, step }: { project: Project; tab: ProjectTabId; step?: string }) {
  const [editing, setEditing] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const chrome = useProjectChrome(project, tab, { edit: () => setEditing(true), duplicate: () => setDuplicating(true) })
  return (
    <>
      {tab === "wrap-up" ? <WrapUpPage project={project} chrome={chrome} step={step} /> : <TabView project={project} chrome={chrome} tab={tab} />}
      <ProjectDetailsDialog project={project} open={editing} onOpenChange={setEditing} />
      <DuplicateProjectDialog project={project} open={duplicating} onOpenChange={setDuplicating} />
    </>
  )
}

function TabView({ project, chrome, tab }: { project: Project; chrome: ProjectChrome; tab: Exclude<ProjectTabId, "wrap-up"> }) {
  if (tab === "calibrate") return <CalibrateTab project={project} chrome={chrome} />
  if (tab === "view") return <ViewTab project={project} chrome={chrome} />
  if (tab === "output") return <OutputTab project={project} chrome={chrome} />
  return <SessionsTab project={project} chrome={chrome} />
}

/** The Sessions tab: the groups and the sessions they hold, the suggestions, then goals, subjects, rigs, tonight and the archived sessions. */
function SessionsTab({ project, chrome }: { project: Project; chrome: ProjectChrome }) {
  const m = useMessages()
  const groups = useGroupsSection(project)
  const held = useHeldSection(project)
  const suggestions = useSuggestionsSection(project)
  const goals = useGoalsSection(project)
  const subjects = useSubjectsSection(project)
  const rigs = useRigsSection(project)
  const planning = usePlanningSection(project)
  const archived = useArchivedSection(project)
  const notes: DetailSection | null = project.notes.trim() ? { id: "notes", title: m.newproject_notes(), content: project.notes } : null
  const sections = [notes, groups, held, suggestions, goals, subjects, rigs, planning, archived].filter((s): s is DetailSection => s !== null)
  return <DetailPage {...chrome} title={project.name} sections={sections} />
}

function CalibrateTab({ project, chrome }: { project: Project; chrome: ProjectChrome }) {
  return <DetailPage {...chrome} title={project.name} sections={useCalibrateSections(project)} />
}

function ViewTab({ project, chrome }: { project: Project; chrome: ProjectChrome }) {
  return <DetailPage {...chrome} title={project.name} sections={useViewSections(project)} />
}

function OutputTab({ project, chrome }: { project: Project; chrome: ProjectChrome }) {
  return <DetailPage {...chrome} title={project.name} sections={useOutputSections(project)} />
}
