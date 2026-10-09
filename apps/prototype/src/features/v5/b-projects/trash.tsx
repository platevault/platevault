/**
 * S8 Project Trash (`/projects/$projectId/trash`, D-W72, D-W75). Trashed runs
 * with the stage they were at. Restore brings a run back exactly as it was:
 * membership revisions, prepared revisions, Results and stage; nothing on
 * disk moves. Empty Trash, per run or for all, previews what goes (the run
 * record, its prepared folders and, only when ticked, its Results folder, all
 * to the OS Trash) and what stays (library frames and quality decisions),
 * then runs one "trash" operation. A trashed panel run stays listed in its
 * group as Trashed until emptied.
 */
import { Link, useParams } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { MissingRecord } from "@/app/missing-record"
import { GateLabel } from "@/app/run-ui"
import { findPanel, findSubject, panelLabel, projectTrash, rigName, runPipeline, subjectName } from "@/domain/derive"
import type { OperationId, ProjectId, Run, RunId } from "@/domain/types"
import { formatDateTime, plural } from "@/lib/format"
import { emptyTrash, restoreRun } from "@/store/actions/runs"
import { preparedEntryItems, resultItems } from "@/store/actions/trash"
import { type CommitResult, type PrototypeState, store, updateSlice, useStore } from "@/store/core"
import type { DoneApproval } from "@/store/slices/b"

/** The newest "trash" operation of a Project, started just now by Empty Trash. */
function latestTrashOperation(state: PrototypeState, projectId: ProjectId): OperationId | null {
  return (
    Object.values(state.operations)
      .filter((op) => op.kind === "trash" && op.scope.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id ?? null
  )
}

export function rememberApproval(projectId: ProjectId, approval: DoneApproval, operationId: OperationId | null) {
  if (!operationId) return
  updateSlice("b", (b) => ({ ...b, approvals: { ...b.approvals, [projectId]: { ...b.approvals[projectId], [approval]: operationId } } }))
}

/** What Empty Trash moves and keeps for these runs, as preview lines (D-W72, STO-FR-17). */
export function emptyTrashPreview(state: PrototypeState, runIds: RunId[], ticked: RunId[]): { changes: string[]; unchanged: string[] } {
  const changes: string[] = []
  const unchanged = ["Library frames and their quality decisions", "Every other run of the Project"]
  for (const id of runIds) {
    const run = state.catalog.runs[id]
    if (!run) continue
    const entries = preparedEntryItems(state, id)
    const results = resultItems(state, id)
    const folders = [...new Set(Object.values(state.catalog.preparations).filter((p) => p.runId === id).map((p) => p.folderPath))]
    changes.push(`${run.name}: removes the run record`)
    changes.push(folders.length > 0 ? `${run.name}: moves ${plural(entries.length, "prepared entry", "prepared entries")} in ${folders.join(", ")} to the OS Trash` : `${run.name}: has no prepared folder`)
    const refused = entries.filter((e) => e.refusedReason)
    if (refused.length > 0) changes.push(`${run.name}: keeps ${plural(refused.length, "item")} in place: ${refused[0]!.refusedReason}`)
    if (results.length > 0) {
      if (ticked.includes(id)) changes.push(`${run.name}: moves its Results folder (${plural(results.length, "file")}) to the OS Trash`)
      else unchanged.push(`${run.name}: its Results folder (${plural(results.length, "file")}), not ticked`)
    }
  }
  changes.push("Nothing is deleted permanently: Put back in the OS Trash restores files only")
  return { changes, unchanged }
}

export function runEmptyTrash(projectId: ProjectId, runIds: RunId[], ticked: RunId[]): CommitResult {
  const result = emptyTrash(projectId, runIds, ticked)
  if (result.ok) rememberApproval(projectId, "empty-trash", latestTrashOperation(store.getState(), projectId))
  return result
}

interface Row {
  run: Run
  where: string
  stage: ReturnType<typeof runPipeline>["current"]
  entries: number
  folders: number
  results: number
}

export function ProjectTrashPage() {
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string }
  const project = useStore((s) => s.catalog.projects[projectId])
  const rows = useStore((s) =>
    projectTrash(s.catalog, projectId).map((run): Row => {
      const project = s.catalog.projects[run.projectId]
      const subject = project ? findSubject(project, run.subjectId) : undefined
      const panel = findPanel(subject, run.panelId)
      const group = run.groupId ? s.catalog.runGroups[run.groupId] : undefined
      return {
        run,
        where: `${subject ? subjectName(s.catalog, subject) : "Unknown subject"}${panel ? ` · ${panelLabel(panel)}${group ? ` of ${group.name}` : ""}` : ""} · ${rigName(s.catalog, run.rigId)}`,
        stage: runPipeline(s, run).current,
        entries: preparedEntryItems(s, run.id).length,
        folders: Object.values(s.catalog.preparations).filter((p) => p.runId === run.id).length,
        results: resultItems(s, run.id).length,
      }
    }),
  )
  const operationId = useStore((s) => s.slices.b.approvals[projectId]?.["empty-trash"] ?? null)
  const [ticked, setTicked] = useState<RunId[]>([])
  if (!project) return <MissingRecord noun="Project" backTo="/projects" backLabel="Open Projects" />
  const tickedLive = ticked.filter((id) => rows.some((r) => r.run.id === id))

  const columns: Column<Row>[] = [
    {
      id: "run",
      header: "Run",
      rowHeader: true,
      sortValue: (r) => r.run.name,
      cell: (r) => (
        <span className="block min-w-[14rem] whitespace-normal">
          <span className="font-medium">{r.run.name}</span>
          <span className="block text-[0.6875rem] text-muted-foreground">{r.where}</span>
        </span>
      ),
    },
    { id: "stage", header: "Stage", cell: (r) => <GateLabel state={r.run.completion === "complete" ? "done" : r.stage.state} label={r.run.completion === "complete" ? "Complete" : r.stage.label} /> },
    { id: "trashed", header: "Moved to Trash", sortValue: (r) => r.run.trashedAt, cell: (r) => (r.run.trashedAt ? formatDateTime(r.run.trashedAt) : "") },
    {
      id: "prepared",
      header: "Prepared",
      cell: (r) => (r.folders > 0 ? `${plural(r.folders, "folder")} · ${plural(r.entries, "entry", "entries")}` : <span className="text-muted-foreground">None</span>),
    },
    {
      id: "results",
      header: "Results folder",
      cell: (r) =>
        r.results === 0 ? (
          <span className="text-muted-foreground">No Results</span>
        ) : (
          <label className="inline-flex items-center gap-2">
            <Checkbox checked={tickedLive.includes(r.run.id)} onCheckedChange={(checked) => setTicked((list) => (checked ? [...list, r.run.id] : list.filter((id) => id !== r.run.id)))} />
            <span>
              Also trash {plural(r.results, "file")}
              <span className="sr-only"> of {r.run.name}</span>
            </span>
          </label>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (r) => (
        <span className="flex flex-wrap gap-1.5">
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="outline">
                Restore<span className="sr-only"> {r.run.name}</span>
              </Button>
            }
            title={`Restore ${r.run.name}?`}
            description="It comes back exactly as it was when you moved it to the Trash."
            changes={[
              `Returns ${r.run.name} to the Project's runs${r.run.groupId ? " and to its run group" : ""} at ${r.run.completion === "complete" ? "Complete" : r.stage.label}`,
              "Its membership revisions, prepared revisions and Results come back, and its members count in project again",
            ]}
            unchanged={["Nothing on disk moves", "Library frames and quality decisions"]}
            confirmLabel="Restore run"
            onConfirm={() => restoreRun(r.run.id)}
          />
          <EmptyTrashButton projectId={projectId} runIds={[r.run.id]} ticked={tickedLive} label="Empty Trash…" srLabel={` for ${r.run.name}`} />
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <Link to="/projects/$projectId" params={{ projectId }} className="underline-offset-2 hover:underline">
            {project.name}
          </Link>
        }
        title="Trash"
        description="Runs moved to the Trash are hidden everywhere else and stop counting toward goals. Nothing on disk moves until Empty Trash."
        actions={rows.length > 1 ? <EmptyTrashButton projectId={projectId} runIds={rows.map((r) => r.run.id)} ticked={tickedLive} label={`Empty Trash (${rows.length} runs)…`} /> : null}
      />
      <PageBody>
        <DataTable
          label={`Trash of ${project.name}`}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.run.id}
          scroll="none"
          empty={
            <EmptyState
              icon={Trash2}
              title="The Trash is empty"
              description="A run you no longer want goes here with Move to Trash on the run. Restore brings it back; Empty Trash moves its prepared folders to the OS Trash."
              action={
                <Button size="sm" variant="outline" render={<Link to="/projects/$projectId" params={{ projectId }} />}>
                  Back to {project.name}
                </Button>
              }
            />
          }
        />
        {operationId ? (
          <Section title="Last Empty Trash" level={2}>
            <OperationPanel operationId={operationId} />
          </Section>
        ) : null}
      </PageBody>
    </div>
  )
}

export function EmptyTrashButton({ projectId, runIds, ticked, label, srLabel }: { projectId: ProjectId; runIds: RunId[]; ticked: RunId[]; label: string; srLabel?: string }) {
  const preview = useStore((s) => emptyTrashPreview(s, runIds, ticked))
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="destructive">
          {label}
          {srLabel ? <span className="sr-only">{srLabel}</span> : null}
        </Button>
      }
      title={runIds.length === 1 ? "Empty this run from the Trash?" : `Empty ${plural(runIds.length, "run")} from the Trash?`}
      description="The run records go, and their files go to the OS Trash after each is re-verified."
      changes={preview.changes}
      unchanged={preview.unchanged}
      confirmLabel={runIds.length === 1 ? "Empty Trash for this run" : `Empty Trash for ${plural(runIds.length, "run")}`}
      tone="destructive"
      onConfirm={() => runEmptyTrash(projectId, runIds, ticked.filter((id) => runIds.includes(id)))}
    />
  )
}
