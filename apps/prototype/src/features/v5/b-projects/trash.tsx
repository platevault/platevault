/**
 * S8 Project Trash (`/projects/$projectId/trash`, D-W72, D-W75). Trashed runs
 * with the stage they were at. Restore brings a run back exactly as it was:
 * membership revisions, prepared revisions, Results and stage; nothing on
 * disk moves. One Empty Trash in the header empties every run; each row's
 * context menu restores or empties that run alone. Empty Trash previews what
 * goes (the run record, its prepared folders and, only when ticked, its
 * Results folder, all to the OS Trash), then runs one "trash" operation. A
 * trashed panel run stays listed in its group as Trashed until emptied.
 */
import { Link, useParams } from "@tanstack/react-router"
import { RotateCcw, Trash2 } from "lucide-react"
import { useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { Box } from "@/components/app/box"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { GateLabel, stepName } from "@/app/run-ui"
import { findPanel, findSubject, panelLabel, projectTrash, rigName, runPipeline, subjectName } from "@/domain/derive"
import type { OperationId, ProjectId, Run, RunId } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { emptyTrash, restoreRun } from "@/store/actions/runs"
import { preparedEntryItems, resultItems } from "@/store/actions/trash"
import { type CommitResult, type PrototypeState, store, updateSlice, useStore } from "@/store/core"
import type { WrapUpApproval } from "@/store/slices/b"

/** The newest "trash" operation of a Project, started just now by Empty Trash. */
function latestTrashOperation(state: PrototypeState, projectId: ProjectId): OperationId | null {
  return (
    Object.values(state.operations)
      .filter((op) => op.kind === "trash" && op.scope.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id ?? null
  )
}

export function rememberApproval(projectId: ProjectId, approval: WrapUpApproval, operationId: OperationId | null) {
  if (!operationId) return
  updateSlice("b", (b) => ({ ...b, approvals: { ...b.approvals, [projectId]: { ...b.approvals[projectId], [approval]: operationId } } }))
}

/** What Empty Trash moves for these runs, as preview lines; an unticked Results folder is the one thing that stays (D-W72, STO-FR-17). */
export function emptyTrashPreview(m: Messages, state: PrototypeState, runIds: RunId[], ticked: RunId[]): { changes: string[]; unchanged: string[] } {
  const changes: string[] = []
  const unchanged: string[] = []
  for (const id of runIds) {
    const run = state.catalog.runs[id]
    if (!run) continue
    const entries = preparedEntryItems(state, id)
    const results = resultItems(state, id)
    const refused = entries.filter((e) => e.refusedReason)
    changes.push(m.trash_preview_record({ name: run.name }))
    if (entries.length > 0) changes.push(m.trash_preview_prepared({ name: run.name, count: entries.length - refused.length }))
    if (refused.length > 0) changes.push(m.trash_preview_kept({ name: run.name, count: refused.length, reason: refused[0]!.refusedReason ?? "" }))
    if (results.length > 0) {
      if (ticked.includes(id)) changes.push(m.trash_preview_results({ name: run.name, count: results.length }))
      else unchanged.push(m.trash_preview_results_folder({ name: run.name }))
    }
  }
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
  results: number
}

type Pending = { kind: "restore"; run: Run } | { kind: "empty"; runIds: RunId[] } | null

export function ProjectTrashPage() {
  const m = useMessages()
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string }
  const project = useStore((s) => s.catalog.projects[projectId])
  const rows = useStore((s) =>
    projectTrash(s.catalog, projectId).map((run): Row => {
      const project = s.catalog.projects[run.projectId]
      const subject = project ? findSubject(project, run.subjectId) : undefined
      const panel = findPanel(subject, run.panelId)
      return {
        run,
        where: `${subject ? subjectName(m, s.catalog, subject) : m.project_unknown_subject()}${panel ? ` · ${panelLabel(m, panel)}` : ""} · ${rigName(m, s.catalog, run.rigId)}`,
        stage: runPipeline(s, run).current,
        entries: preparedEntryItems(s, run.id).length,
        results: resultItems(s, run.id).length,
      }
    }),
  )
  const operationId = useStore((s) => s.slices.b.approvals[projectId]?.["empty-trash"] ?? null)
  const [ticked, setTicked] = useState<RunId[]>([])
  const [pending, setPending] = useState<Pending>(null)
  const preview = useStore((s) => emptyTrashPreview(m, s, pending?.kind === "empty" ? pending.runIds : [], ticked))
  if (!project) return <MissingRecord title={m.project_missing_title()} backTo="/projects" backLabel={m.project_back_to_projects()} />
  const tickedLive = ticked.filter((id) => rows.some((r) => r.run.id === id))
  const allIds = rows.map((r) => r.run.id)

  const columns: Column<Row>[] = [
    {
      id: "run",
      header: m.project_run_noun_capital(),
      rowHeader: true,
      sortValue: (r) => r.run.name,
      cell: (r) => (
        <span className="block min-w-[14rem] whitespace-normal">
          <span className="font-medium">{r.run.name}</span>
          <span className="block text-[0.6875rem] text-muted-foreground">{r.where}</span>
        </span>
      ),
    },
    { id: "stage", header: m.projects_col_stage(), cell: (r) => <GateLabel state={r.run.completion === "complete" ? "done" : r.stage.state} label={r.run.completion === "complete" ? m.status_complete() : stepName(m, r.stage.id)} /> },
    { id: "trashed", header: m.status_trashed(), sortValue: (r) => r.run.trashedAt, cell: (r) => (r.run.trashedAt ? formatDateTime(r.run.trashedAt) : "–") },
    { id: "prepared", header: m.status_prepared(), align: "right", sortValue: (r) => r.entries, cell: (r) => (r.entries > 0 ? <Pill tone="muted">{m.trash_entries({ count: r.entries })}</Pill> : "–") },
    {
      id: "results",
      header: m.status_role_results(),
      cell: (r) =>
        r.results === 0 ? (
          "–"
        ) : (
          <label className="inline-flex items-center gap-2">
            <Checkbox checked={tickedLive.includes(r.run.id)} onCheckedChange={(checked) => setTicked((list) => (checked ? [...list, r.run.id] : list.filter((id) => id !== r.run.id)))} />
            <span>
              {m.trash_results_files({ count: r.results })}
              <span className="sr-only"> {m.trash_of_run({ name: r.run.name })}</span>
            </span>
          </label>
        ),
    },
    {
      id: "actions",
      header: m.project_col_actions(),
      align: "right",
      cell: (r) => (
        <Button size="sm" variant="outline" onClick={() => setPending({ kind: "restore", run: r.run })}>
          <RotateCcw aria-hidden="true" data-icon="inline-start" />
          {m.project_restore()}
          <span className="sr-only"> {r.run.name}</span>
        </Button>
      ),
    },
  ]

  const menu = (r: Row): MenuEntry[] => [
    { heading: r.run.name },
    { label: m.project_restore(), icon: RotateCcw, onSelect: () => setPending({ kind: "restore", run: r.run }) },
    { separator: true },
    { label: m.trash_empty_run_ellipsis(), icon: Trash2, destructive: true, onSelect: () => setPending({ kind: "empty", runIds: [r.run.id] }) },
  ]

  const restoring = pending?.kind === "restore" ? pending.run : null
  const emptying = pending?.kind === "empty" ? pending.runIds : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <Link to="/projects/$projectId" params={{ projectId }} className="underline-offset-2 hover:underline">
            {project.name}
          </Link>
        }
        title={m.trash_title()}
        meta={rows.length > 0 ? <CountBadge count={rows.length} label={m.project_runs_count({ count: rows.length })} /> : null}
        actions={
          rows.length > 0 ? (
            <Button size="sm" variant="destructive" onClick={() => setPending({ kind: "empty", runIds: allIds })}>
              <Trash2 aria-hidden="true" data-icon="inline-start" />
              {m.trash_empty_ellipsis()}
            </Button>
          ) : null
        }
      />
      <PageBody>
        <DataTable
          label={m.trash_of_project({ name: project.name })}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.run.id}
          scroll="none"
          contextMenu={menu}
          empty={
            <EmptyState
              icon={Trash2}
              title={m.trash_is_empty()}
              description={null}
              action={
                <Button size="sm" variant="outline" render={<Link to="/projects/$projectId" params={{ projectId }} />}>
                  {m.activity_open_destination({ name: project.name })}
                </Button>
              }
            />
          }
        />
        {operationId ? (
          <Box title={m.trash_last_empty()} level={2}>
            <OperationPanel operationId={operationId} />
          </Box>
        ) : null}
      </PageBody>
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={m.trash_restore_title({ name: restoring?.name ?? m.project_run_noun() })}
        description={m.trash_restore_description()}
        changes={restoring ? [restoring.groupId ? m.trash_restore_to_group({ name: restoring.name }) : m.trash_restore_to_runs({ name: restoring.name }), m.trash_restore_members()] : []}
        confirmLabel={m.trash_restore_run()}
        onConfirm={() => (restoring ? restoreRun(restoring.id) : undefined)}
      />
      <ConfirmDialog
        open={emptying !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={emptying && emptying.length === 1 ? m.trash_empty_run_title() : m.trash_empty_runs_title({ count: emptying?.length ?? 0 })}
        description={m.trash_empty_description()}
        changes={preview.changes}
        unchanged={preview.unchanged}
        confirmLabel={emptying && emptying.length === 1 ? m.trash_empty_run() : m.trash_empty()}
        tone="destructive"
        onConfirm={() => (emptying ? runEmptyTrash(projectId, emptying, tickedLive.filter((id) => emptying.includes(id))) : undefined)}
      />
    </div>
  )
}
