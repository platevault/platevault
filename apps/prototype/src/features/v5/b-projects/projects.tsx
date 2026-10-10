/**
 * S2 Projects list (`/projects`): one row per Project with its subjects and
 * rigs, goal progress ("in project" / "captured"), open runs, stage and one
 * Next action (D-W1, D-W35, D-W48). Done Projects stay behind "Show done".
 * Column priority keeps Next in view from 1024 px: subjects and rigs fold
 * into the Project cell's second and third lines, State (only when it
 * differs between rows) and the unmet goal line show from 64rem of table,
 * Open runs from 52rem, and long cells truncate with the whole text in
 * their tooltip. Right click opens the row's menu.
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { Eye, FolderKanban, Grid2x2Plus, PackageCheck, Play, Plus, Trash2 } from "lucide-react"
import { useId } from "react"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { GateLabel, useFollowLink } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import { useMessages } from "@/app/preferences"
import { type GoalProgress, goalProgress, type NextAction, projectGroups, projectNext, projectRuns, projectStage, projectStatus, projectWrapUp, rigName, subjectName } from "@/domain/derive"
import type { Project } from "@/domain/types"
import { say } from "@/lib/i18n"
import { nowIso, updateSlice, useStore } from "@/store/core"

interface Row {
  project: Project
  subjects: string[]
  rigs: string[]
  progress: GoalProgress[]
  openRuns: number
  groups: number
  stage: ReturnType<typeof projectStage>
  next: NextAction | null
  wrapUp: boolean
  trashed: number
}

export function ProjectsPage() {
  const m = useMessages()
  const showDone = useStore((s) => s.slices.b.showDone)
  const rows = useStore((s) => {
    const now = Date.parse(nowIso())
    return Object.values(s.catalog.projects)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((project): Row => {
        const runs = projectRuns(s.catalog, project.id)
        return {
          project,
          subjects: project.subjects.map((subject) => (subject.mosaic ? m.project_subject_with_panels({ name: subjectName(m, s.catalog, subject), count: subject.mosaic.panels.length }) : subjectName(m, s.catalog, subject))),
          rigs: project.rigIds.map((id) => rigName(m, s.catalog, id)),
          progress: goalProgress(s.catalog, project),
          openRuns: runs.filter((r) => r.completion === "open").length,
          groups: projectGroups(s.catalog, project.id).length,
          stage: projectStage(s, project),
          next: projectNext(s, project, now),
          wrapUp: project.state === "done" || projectWrapUp(s.catalog, project).available,
          trashed: Object.values(s.catalog.runs).filter((r) => r.projectId === project.id && r.trashedAt).length,
        }
      })
  })
  const follow = useFollowLink()
  const navigate = useNavigate()
  const switchId = useId()
  const shown = rows.filter((r) => showDone || r.project.state === "open")
  const hiddenDone = rows.length - shown.length

  // State is hidden while every shown Project has the same one (all Open until Show done adds Done ones).
  const stateVaries = new Set(shown.map((r) => projectStatus(r.project))).size > 1
  const columns: Column<Row>[] = [
    {
      id: "name",
      header: m.project_noun(),
      rowHeader: true,
      sortValue: (r) => r.project.name,
      cell: (r) => {
        const subjects = r.subjects.join(", ") || m.projects_no_subjects()
        const rigs = r.rigs.join(", ") || m.equipment_no_rigs()
        // Subjects, then rigs: each its own line that wraps at the column's width, so no name is cut.
        const line = "block max-w-[12rem] text-xs whitespace-normal text-muted-foreground @min-[52rem]:max-w-[18rem]"
        return (
          <span className="block min-w-0">
            <Link to="/projects/$projectId" params={{ projectId: r.project.id }} className="font-medium underline-offset-2 hover:underline">
              {r.project.name}
            </Link>
            <span className={line}>{subjects}</span>
            <span className={line}>{rigs}</span>
          </span>
        )
      },
    },
    ...(stateVaries ? [{ id: "state", header: m.projects_col_state(), className: "@max-[64rem]:hidden", sortValue: (r: Row) => projectStatus(r.project), cell: (r: Row) => <StatusBadge kind="project" value={projectStatus(r.project)} /> }] : []),
    {
      id: "goals",
      header: m.projects_col_goals(),
      sortValue: (r) => (r.progress.length === 0 ? null : r.progress.filter((p) => p.met).length / r.progress.length),
      cell: (r) => <GoalSummary progress={r.progress} />,
    },
    {
      id: "runs",
      header: m.projects_col_open_runs(),
      align: "right",
      className: "@max-[52rem]:hidden",
      sortValue: (r) => r.openRuns,
      cell: (r) => (
        <span className="tabular-nums">
          {r.openRuns}
          {r.groups > 0 ? <span className="text-xs text-muted-foreground"> · {m.projects_groups({ count: r.groups })}</span> : null}
        </span>
      ),
    },
    { id: "stage", header: m.projects_col_stage(), sortValue: (r) => say(m, r.stage.label), cell: (r) => <GateLabel state={r.stage.state} label={say(m, r.stage.label)} className="whitespace-nowrap" /> },
    {
      id: "next",
      header: m.projects_col_next(),
      cell: (r) =>
        r.next ? (
          <Button size="sm" variant="outline" className="max-w-[12rem] min-w-0" title={`${say(m, r.next.label)}: ${say(m, r.next.reason)}`} onClick={() => follow(r.next!.link)}>
            <span className="truncate">{say(m, r.next.label)}</span>
            <span className="sr-only"> {m.projects_next_for({ name: r.project.name })}</span>
          </Button>
        ) : (
          <span className="text-muted-foreground">–</span>
        ),
    },
  ]

  const open = (r: Row, search?: Record<string, string>) => void navigate({ to: "/projects/$projectId", params: { projectId: r.project.id }, search: search ?? {} })
  const menu = (r: Row): MenuEntry[] => [
    { heading: r.project.name },
    { label: m.verb_open(), icon: Eye, onSelect: () => open(r) },
    ...(r.next ? [{ label: say(m, r.next.label), onSelect: () => follow(r.next!.link) }] : []),
    { separator: true },
    ...(r.project.state === "open"
      ? [
          { label: m.startrun_open(), icon: Play, onSelect: () => openSheet({ kind: "start-run", projectId: r.project.id }) },
          { label: m.mosaic_new(), icon: Grid2x2Plus, onSelect: () => open(r, { mosaic: "new" }) },
        ]
      : []),
    ...(r.wrapUp ? [{ label: m.wrapup_action(), icon: PackageCheck, onSelect: () => open(r, { stage: "wrap-up" }) }] : []),
    { label: r.trashed > 0 ? m.trash_with_count({ count: r.trashed }) : m.trash_title(), icon: Trash2, onSelect: () => void navigate({ to: "/projects/$projectId/trash", params: { projectId: r.project.id } }) },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={m.nav_projects()}
        meta={shown.length > 0 ? <CountBadge count={shown.length} label={m.projects_count({ count: shown.length })} /> : null}
        actions={
          <>
            <div className="flex items-center gap-2">
              <Switch id={switchId} checked={showDone} onCheckedChange={(checked) => updateSlice("b", (b) => ({ ...b, showDone: checked }))} />
              <Label htmlFor={switchId}>{m.projects_show_done()}</Label>
              {!showDone && hiddenDone > 0 ? <Pill tone="muted">{m.projects_hidden({ count: hiddenDone })}</Pill> : null}
            </div>
            <Button size="sm" onClick={() => openSheet({ kind: "new-project" })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {m.newproject_title()}
            </Button>
          </>
        }
      />
      <PageBody className="@container">
        <DataTable
          label={m.nav_projects()}
          rows={shown}
          columns={columns}
          getRowId={(r) => r.project.id}
          scroll="none"
          contextMenu={menu}
          empty={
            <EmptyState
              icon={FolderKanban}
              title={rows.length === 0 ? m.projects_empty() : m.projects_all_done()}
              description={null}
              action={
                rows.length === 0 ? (
                  <Button size="sm" onClick={() => openSheet({ kind: "new-project" })}>
                    {m.newproject_title()}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => updateSlice("b", (b) => ({ ...b, showDone: true }))}>
                    {m.projects_show_done()}
                  </Button>
                )
              }
            />
          }
        />
      </PageBody>
    </div>
  )
}

/** Met count plus the first unmet goal's line (from 64rem of table), with every line in the tooltip and to screen readers. */
function GoalSummary({ progress }: { progress: GoalProgress[] }) {
  const m = useMessages()
  if (progress.length === 0) return <span className="text-muted-foreground">{m.projects_no_goals()}</span>
  const met = progress.filter((p) => p.met).length
  const unmet = progress.find((p) => !p.met)
  return (
    <span className="block min-w-0" title={progress.map((p) => say(m, p.line)).join("\n")}>
      <span className="font-medium tabular-nums">
        {m.projects_goals_met({ met, total: progress.length })}
      </span>
      {unmet ? <span className="block max-w-[18rem] truncate text-xs text-muted-foreground tabular-nums @max-[64rem]:hidden">{say(m, unmet.line)}</span> : null}
      <span className="sr-only">{progress.map((p) => (p.met ? `${say(m, p.line)}, ${m.projects_goal_met()}` : say(m, p.line))).join("; ")}</span>
    </span>
  )
}
