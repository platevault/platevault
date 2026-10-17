/**
 * S2 Projects (`/projects`; ListPage): one row per Project with its
 * subjects, rigs, goal progress, the sessions it holds, its pending changes,
 * its state and its one Up next action (D-W1, D-W35, D-W48, PRJ-FR-18). The
 * State facet (Open · Closed · Archived) starts on Open, so closed Projects
 * stay out of the way until asked for (§5.6). A row opens its Project; its ⋯
 * menu and right click hold the rest: Edit…, Duplicate… and Wrap up, then
 * Dismiss issue for each issue on the row (the Project's own and those of
 * the sessions it holds) and Restore issue once dismissed; the Issues facet
 * is Show dismissed (F7, P-ISS1). A Project's own waiting work (Apply
 * refused, View (previous) to review) cannot be dismissed.
 */
import { useNavigate } from "@tanstack/react-router"
import { Copy, Eye, FolderKanban, PackageCheck, Pencil, Plus } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { openSheet } from "@/app/ui-state"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, Facet, MenuItem } from "@/components/app/contracts"
import { type IssueFilter, issuesFacet, matchesIssueFilter, type OwnIssues, parseIssueFilter, withIssueItems } from "@/components/app/issue-actions"
import { EmptyState } from "@/components/app/feedback"
import { useFollowLink } from "@/components/app/links"
import { StatusBadge, statusMeta } from "@/components/app/status"
import { ListPage } from "@/components/templates/list-page"
import { goalProgress, isLocked, isMosaic, type NextAction, panelGroups, rigName, subjectName } from "@/domain/derive"
import { projectIssues } from "@/domain/home"
import { pendingChanges, projectNext, wrapUpSummary } from "@/domain/project-view"
import { matchesQuery } from "@/domain/sky"
import type { Project, ProjectState } from "@/domain/types"
import { type Messages, say } from "@/lib/i18n"
import { nowIso, type PrototypeState, useStore } from "@/store/core"
import { useIssues } from "@/store/issues"
import { ProjectDetailsDialog } from "./details-dialog"
import { DuplicateProjectDialog } from "./duplicate-dialog"

interface Row {
  project: Project
  subjects: string[]
  rigs: string[]
  met: number
  goals: number
  sessions: number
  pending: number
  next: NextAction | null
  wrapUp: boolean
}

const STATES: ProjectState[] = ["open", "closed", "archived"]

function rowsOf(m: Messages, s: PrototypeState): Row[] {
  const now = Date.parse(nowIso())
  return Object.values(s.catalog.projects)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((project): Row => {
      const progress = goalProgress(s.catalog, project)
      const panels = isMosaic(project) ? panelGroups(project).length : 0
      return {
        project,
        subjects: project.subjects.map((subject) => (panels > 0 ? m.project_subject_with_panels({ name: subjectName(m, s.catalog, subject), count: panels }) : subjectName(m, s.catalog, subject))),
        rigs: project.rigIds.map((id) => rigName(m, s.catalog, id)),
        met: progress.filter((p) => p.met).length,
        goals: progress.length,
        sessions: project.inputs.length,
        pending: pendingChanges(s, project).length,
        next: projectNext(s, project, now),
        wrapUp: isLocked(project) || wrapUpSummary(s, project).available,
      }
    })
}

export function ProjectsPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const follow = useFollowLink()
  const rows = useStore((s) => rowsOf(m, s))
  const [query, setQuery] = useState("")
  const [state, setState] = useState<string>("open")
  const [issueFilter, setIssueFilter] = useState<IssueFilter | "">("")
  const [editing, setEditing] = useState<Project | null>(null)
  const [duplicating, setDuplicating] = useState<Project | null>(null)
  const issueView = useIssues()
  const issuesOf = (r: Row): OwnIssues => ({ live: projectIssues(r.project, issueView.issues), dismissed: projectIssues(r.project, issueView.dismissed) })
  // An empty search matches every row (`matchesQuery` reads an empty query as no match).
  const shown = rows.filter(
    (r) => (state === "" || r.project.state === state) && matchesIssueFilter(issuesOf(r), issueFilter) && (query.trim() === "" || matchesQuery([r.project.name, ...r.subjects], query)),
  )

  const open = (r: Row, search: Record<string, string> = {}) => void navigate({ to: "/projects/$projectId", params: { projectId: r.project.id }, search })
  const newProject: Action = { id: "new-project", label: m.newproject_title(), icon: Plus, kind: "primary", opensDialog: true, run: () => openSheet({ kind: "new-project" }) }
  const nextAction = (r: Row): Action | null => (r.next ? { id: `next-${r.project.id}`, label: say(m, r.next.label), run: () => follow(r.next!.link) } : null)
  const statusLabel = (r: Row) => statusMeta("project", r.project.state).label

  const columns: Column<Row>[] = [
    { id: "name", header: m.project_noun(), cell: (r) => r.project.name, sortValue: (r) => r.project.name, rowHeader: true, truncate: true },
    { id: "subjects", header: m.project_subjects(), cell: (r) => r.subjects.join(", ") || m.projects_no_subjects(), sortValue: (r) => r.subjects.length, truncate: true },
    { id: "rigs", header: m.project_rigs(), cell: (r) => r.rigs.join(", ") || m.equipment_no_rigs(), sortValue: (r) => r.rigs.length, truncate: true },
    {
      id: "goals",
      header: m.projects_col_goals(),
      cell: (r) => (r.goals === 0 ? m.projects_no_goals() : m.projects_goals_met({ met: r.met, total: r.goals })),
      sortValue: (r) => (r.goals === 0 ? null : r.met / r.goals),
    },
    { id: "sessions", header: m.nav_sessions(), cell: (r) => r.sessions, sortValue: (r) => r.sessions, align: "right" },
    { id: "pending", header: m.project_pending_changes(), cell: (r) => r.pending, sortValue: (r) => r.pending, align: "right" },
    { id: "state", header: m.projects_col_state(), cell: (r) => <StatusBadge kind="project" value={r.project.state} />, sortValue: statusLabel },
    {
      id: "next",
      header: m.common_up_next(),
      static: true,
      cell: (r) => {
        const action = nextAction(r)
        return action ? <ActionButton action={action} size="xs" /> : "–"
      },
    },
  ]

  const rowActions = (r: Row): MenuItem[] => {
    const next = nextAction(r)
    return withIssueItems(
      m,
      [
        { id: "open", label: m.verb_open(), icon: Eye, run: () => open(r) },
        ...(next ? [next] : []),
        { separator: true },
        ...(isLocked(r.project) ? [] : [{ id: "edit", label: m.project_edit(), icon: Pencil, opensDialog: true, run: () => setEditing(r.project) }]),
        { id: "duplicate", label: m.project_duplicate(), icon: Copy, opensDialog: true, run: () => setDuplicating(r.project) },
        ...(r.wrapUp ? [{ id: "wrap-up", label: m.wrapup_action(), icon: PackageCheck, run: () => open(r, { stage: "wrap-up" }) }] : []),
      ],
      issuesOf(r),
    )
  }
  const facets: Facet[] = [
    {
      id: "state",
      label: m.projects_col_state(),
      kind: "single",
      value: state,
      options: STATES.map((value) => ({ value, label: statusMeta("project", value).label, count: rows.filter((r) => r.project.state === value).length })),
    },
    issuesFacet(m, rows.map(issuesOf), issueFilter),
  ]
  const live = (project: Project) => rows.find((r) => r.project.id === project.id)?.project ?? project

  return (
    <>
      <ListPage
        title={m.nav_projects()}
        summary={m.projects_count({ count: rows.length })}
        actions={[newProject]}
        table={{
          label: m.nav_projects(),
          rows: shown,
          columns,
          getRowId: (r) => r.project.id,
          onRowClick: (r) => open(r),
          rowLabel: (r) => r.project.name,
          rowActions,
          toolbar: {
            search: { label: m.projects_search(), placeholder: m.projects_search_placeholder(), value: query, onChange: setQuery },
            facets: {
              items: facets,
              onChange: (patch) => {
                if (typeof patch.state === "string") setState(patch.state)
                if ("issues" in patch) setIssueFilter(parseIssueFilter(patch.issues))
              },
            },
            matchCount: shown.length,
          },
          // With rows hidden by filters, the chip row above already offers Clear filters.
          empty: rows.length === 0 ? <EmptyState icon={FolderKanban} title={m.projects_empty()} action={<ActionButton action={newProject} />} /> : <EmptyState icon={FolderKanban} title={m.projects_no_match()} action={null} />,
        }}
      />
      {editing ? <ProjectDetailsDialog project={live(editing)} open onOpenChange={(next) => !next && setEditing(null)} /> : null}
      {duplicating ? <DuplicateProjectDialog project={live(duplicating)} open onOpenChange={(next) => !next && setDuplicating(null)} /> : null}
    </>
  )
}
