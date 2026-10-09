/**
 * S2 Projects list (`/projects`): one row per Project with its subjects, rigs,
 * goal progress ("in project" / "captured"), open runs, stage and one Next
 * action (D-W1, D-W35, D-W48). Done Projects stay behind "Show done".
 */
import { Link } from "@tanstack/react-router"
import { FolderKanban, Plus } from "lucide-react"
import { useId } from "react"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { GateLabel, useFollowLink } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import { type GoalProgress, goalProgress, type NextAction, projectGroups, projectNext, projectRuns, projectStage, projectStatus, rigName, subjectName } from "@/domain/derive"
import type { Project } from "@/domain/types"
import { plural } from "@/lib/format"
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
}

export function ProjectsPage() {
  const showDone = useStore((s) => s.slices.b.showDone)
  const rows = useStore((s) => {
    const now = Date.parse(nowIso())
    return Object.values(s.catalog.projects)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((project): Row => {
        const runs = projectRuns(s.catalog, project.id)
        return {
          project,
          subjects: project.subjects.map((subject) => `${subjectName(s.catalog, subject)}${subject.mosaic ? ` (${plural(subject.mosaic.panels.length, "panel")})` : ""}`),
          rigs: project.rigIds.map((id) => rigName(s.catalog, id)),
          progress: goalProgress(s.catalog, project),
          openRuns: runs.filter((r) => r.completion === "open").length,
          groups: projectGroups(s.catalog, project.id).length,
          stage: projectStage(s, project),
          next: projectNext(s, project, now),
        }
      })
  })
  const follow = useFollowLink()
  const switchId = useId()
  const shown = rows.filter((r) => showDone || r.project.state === "open")
  const hiddenDone = rows.length - shown.length

  const columns: Column<Row>[] = [
    {
      id: "name",
      header: "Project",
      rowHeader: true,
      sortValue: (r) => r.project.name,
      cell: (r) => (
        <Link to="/projects/$projectId" params={{ projectId: r.project.id }} className="font-medium underline-offset-2 hover:underline">
          {r.project.name}
        </Link>
      ),
    },
    { id: "state", header: "State", sortValue: (r) => projectStatus(r.project), cell: (r) => <StatusBadge kind="project" value={projectStatus(r.project)} /> },
    { id: "subjects", header: "Subjects", cell: (r) => <span className="block min-w-[11rem] whitespace-normal">{r.subjects.join(", ") || "None"}</span> },
    { id: "rigs", header: "Rigs", cell: (r) => <span className="block min-w-[10rem] whitespace-normal">{r.rigs.join(", ") || "None"}</span> },
    {
      id: "goals",
      header: "Goals (in project / captured)",
      sortValue: (r) => (r.progress.length === 0 ? null : r.progress.filter((p) => p.met).length / r.progress.length),
      cell: (r) => <GoalSummary progress={r.progress} />,
    },
    {
      id: "runs",
      header: "Open runs",
      align: "right",
      sortValue: (r) => r.openRuns,
      cell: (r) => (
        <span className="tabular-nums">
          {r.openRuns}
          {r.groups > 0 ? <span className="block text-[0.6875rem] text-muted-foreground">{plural(r.groups, "run group")}</span> : null}
        </span>
      ),
    },
    { id: "stage", header: "Stage", sortValue: (r) => r.stage.label, cell: (r) => <GateLabel state={r.stage.state} label={r.stage.label} /> },
    {
      id: "next",
      header: "Next",
      cell: (r) =>
        r.next ? (
          <Button size="sm" variant="outline" title={r.next.reason} onClick={() => follow(r.next!.link)}>
            {r.next.label}
            <span className="sr-only"> for {r.project.name}</span>
          </Button>
        ) : (
          <span className="text-muted-foreground">Nothing waiting</span>
        ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Projects"
        description="Campaigns: subjects, rigs and goals. Every processing run lives in a Project."
        actions={
          <>
            <div className="flex items-center gap-2">
              <Switch id={switchId} checked={showDone} onCheckedChange={(checked) => updateSlice("b", (b) => ({ ...b, showDone: checked }))} />
              <Label htmlFor={switchId}>Show done</Label>
            </div>
            <Button size="sm" onClick={() => openSheet({ kind: "new-project" })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              New Project
            </Button>
          </>
        }
      />
      <PageBody>
        <DataTable
          label="Projects"
          rows={shown}
          columns={columns}
          getRowId={(r) => r.project.id}
          scroll="none"
          empty={
            <EmptyState
              icon={FolderKanban}
              title={rows.length === 0 ? "No Projects yet" : "Every Project is Done"}
              description={rows.length === 0 ? "A Project names its subjects, rigs and goals; processing runs start inside it." : "Done Projects are hidden. Turn on Show done to list them."}
              action={
                <Button size="sm" onClick={() => openSheet({ kind: "new-project" })}>
                  New Project
                </Button>
              }
            />
          }
        />
        {!showDone && hiddenDone > 0 ? <p className="text-xs text-muted-foreground">{plural(hiddenDone, "Done Project")} hidden. Turn on Show done to list them.</p> : null}
      </PageBody>
    </div>
  )
}

/** Met count plus the first unmet goal's line, with every line in the tooltip and to screen readers. */
function GoalSummary({ progress }: { progress: GoalProgress[] }) {
  if (progress.length === 0) return <span className="text-muted-foreground">No goals</span>
  const met = progress.filter((p) => p.met).length
  const unmet = progress.find((p) => !p.met)
  return (
    <span className="block max-w-[26rem] whitespace-normal" title={progress.map((p) => p.line).join("\n")}>
      <span className="font-medium tabular-nums">
        {met} of {progress.length} met
      </span>
      {unmet ? <span className="block text-[0.6875rem] text-muted-foreground tabular-nums">{unmet.line}</span> : null}
      <span className="sr-only">{progress.map((p) => `${p.line}${p.met ? ", goal met" : ""}`).join("; ")}</span>
    </span>
  )
}
