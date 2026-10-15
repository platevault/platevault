/**
 * S2 Projects (`/projects`; ListPage): one row per Project with its
 * subjects, rigs, goal progress, open runs, state and its one Up next action
 * (D-W1, D-W35, D-W48). The State facet (Open · Closed · Archived) starts on
 * Open, so closed Projects stay out of the way until asked for (§5.6). A row
 * opens its Project; its ⋯ menu and right click hold the rest.
 */
import { useNavigate } from "@tanstack/react-router"
import { Eye, FolderKanban, Grid2x2Plus, PackageCheck, Pencil, Play, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, Facet, MenuItem } from "@/components/app/contracts"
import { EmptyState } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { ListPage } from "@/components/templates/list-page"
import { goalProgress, type NextAction, PROJECT_STATUS_NAME, projectNext, projectRuns, type ProjectStatus, projectStatus, rigName, subjectName } from "@/domain/derive"
import type { Project } from "@/domain/types"
import { matchesQuery } from "@/domain/sky"
import { type Messages, say } from "@/lib/i18n"
import { nowIso, type PrototypeState, useStore } from "@/store/core"
import { ProjectDetailsDialog } from "./details-dialog"
import { wrapUpOf } from "./model"

interface Row {
  project: Project
  status: ProjectStatus
  subjects: string[]
  rigs: string[]
  met: number
  goals: number
  openRuns: number
  next: NextAction | null
  wrapUp: boolean
  trashed: number
}

const STATES: ProjectStatus[] = ["open", "done", "archived"]

function rowsOf(m: Messages, s: PrototypeState): Row[] {
  const now = Date.parse(nowIso())
  return Object.values(s.catalog.projects)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((project): Row => {
      const progress = goalProgress(s.catalog, project)
      return {
        project,
        status: projectStatus(project),
        subjects: project.subjects.map((subject) => (subject.mosaic ? m.project_subject_with_panels({ name: subjectName(m, s.catalog, subject), count: subject.mosaic.panels.length }) : subjectName(m, s.catalog, subject))),
        rigs: project.rigIds.map((id) => rigName(m, s.catalog, id)),
        met: progress.filter((p) => p.met).length,
        goals: progress.length,
        openRuns: projectRuns(s.catalog, project.id).filter((r) => r.completion === "open").length,
        next: projectNext(s, project, now, (p) => wrapUpOf(s, p)),
        wrapUp: project.state === "done" || wrapUpOf(s, project).available,
        trashed: Object.values(s.catalog.runs).filter((r) => r.projectId === project.id && r.trashedAt).length,
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
  const [editing, setEditing] = useState<Project | null>(null)
  // An empty search matches every row (`matchesQuery` reads an empty query as no match).
  const shown = rows.filter((r) => (state === "" || r.status === state) && (query.trim() === "" || matchesQuery([r.project.name, ...r.subjects], query)))

  const open = (r: Row, search: Record<string, string> = {}) => void navigate({ to: "/projects/$projectId", params: { projectId: r.project.id }, search })
  const newProject: Action = { id: "new-project", label: m.newproject_title(), icon: Plus, kind: "primary", opensDialog: true, run: () => openSheet({ kind: "new-project" }) }
  const nextAction = (r: Row): Action | null => (r.next ? { id: `next-${r.project.id}`, label: say(m, r.next.label), run: () => follow(r.next!.link) } : null)
  const statusLabel = (r: Row) => say(m, PROJECT_STATUS_NAME[r.status])

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
    { id: "runs", header: m.projects_col_open_runs(), cell: (r) => r.openRuns, sortValue: (r) => r.openRuns, align: "right" },
    { id: "state", header: m.projects_col_state(), cell: (r) => <StatusBadge kind="project" value={r.status} label={statusLabel(r)} />, sortValue: statusLabel },
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
    const editable = r.project.state === "open"
    const next = nextAction(r)
    return [
      { id: "open", label: m.verb_open(), icon: Eye, run: () => open(r) },
      ...(next ? [next] : []),
      { separator: true },
      ...(editable
        ? [
            { id: "edit", label: m.project_edit(), icon: Pencil, opensDialog: true, run: () => setEditing(r.project) },
            { id: "start-run", label: m.startrun_title(), icon: Play, opensDialog: true, run: () => openSheet({ kind: "start-run", projectId: r.project.id }) },
            { id: "new-mosaic", label: m.mosaic_new_ellipsis(), icon: Grid2x2Plus, run: () => open(r, { mosaic: "new" }) },
          ]
        : []),
      ...(r.wrapUp ? [{ id: "wrap-up", label: m.wrapup_action(), icon: PackageCheck, run: () => open(r, { stage: "wrap-up" }) }] : []),
      { id: "trash", label: r.trashed > 0 ? m.trash_with_count({ count: r.trashed }) : m.trash_title(), icon: Trash2, run: () => void navigate({ to: "/projects/$projectId/trash", params: { projectId: r.project.id } }) },
    ]
  }

  const facets: Facet[] = [
    {
      id: "state",
      label: m.projects_col_state(),
      kind: "single",
      value: state,
      options: STATES.map((value) => ({ value, label: say(m, PROJECT_STATUS_NAME[value]), count: rows.filter((r) => r.status === value).length })),
    },
  ]
  const clear = () => {
    setQuery("")
    setState("")
  }

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
            facets: { items: facets, onChange: (patch) => typeof patch.state === "string" && setState(patch.state) },
            matchCount: shown.length,
          },
          empty:
            rows.length === 0 ? (
              <EmptyState icon={FolderKanban} title={m.projects_empty()} action={<ActionButton action={newProject} />} />
            ) : (
              <EmptyState icon={FolderKanban} title={m.projects_no_match()} action={<ActionButton action={{ id: "clear-filters", label: m.filters_clear(), run: clear }} />} />
            ),
        }}
      />
      {editing ? <ProjectDetailsDialog project={rows.find((r) => r.project.id === editing.id)?.project ?? editing} open onOpenChange={(next) => !next && setEditing(null)} /> : null}
    </>
  )
}
