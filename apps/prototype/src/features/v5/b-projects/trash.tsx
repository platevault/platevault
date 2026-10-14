/**
 * S8 Project Trash (`/projects/$projectId/trash`; ListPage; D-W72, D-W75):
 * trashed runs with the step they were at. Restore brings a run back exactly
 * as it was (membership, prepared revisions, Results and step); nothing on
 * disk moves. Empty Trash… in the Trash ▾ menu empties every run; each
 * row's menu restores or empties that run alone (B: one Empty Trash, the
 * rest per row). Emptying moves the run record's prepared folders to the OS
 * Trash, and its Results folder only through "Empty with Results…"; the
 * confirm lists each file (P8). A trashed panel run stays listed in its
 * group as Trashed until emptied.
 */
import { useNavigate, useParams } from "@tanstack/react-router"
import { RotateCcw, Trash2 } from "lucide-react"
import { useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, ConfirmSpec, FileRow, MenuItem } from "@/components/app/contracts"
import { EmptyState } from "@/components/app/feedback"
import { ListPage } from "@/components/templates/list-page"
import { fileAt } from "@/domain/disk"
import { findPanel, findSubject, panelLabel, projectTrash, rigName, runPipeline, subjectName } from "@/domain/derive"
import { STEP_NAME } from "@/domain/labels"
import { matchesQuery } from "@/domain/sky"
import type { ProjectId, Run, RunId } from "@/domain/types"
import { fileName, formatDateTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { emptyTrash, restoreRun, trashRun } from "@/store/actions/runs"
import { preparedEntryItems, resultItems } from "@/store/actions/trash"
import { type PrototypeState, useStore } from "@/store/core"

interface Row {
  run: Run
  where: string
  step: string
  entries: number
  results: number
}

const folderOf = (path: string) => path.split("/").slice(0, -1).join("/")

/** What emptying these runs moves to the OS Trash, per run: its prepared files and, when asked, its Results; refused items stay with their reason. */
function emptyGroups(m: Messages, state: PrototypeState, runIds: RunId[], withResults: boolean): ConfirmSpec["groups"] {
  return runIds.flatMap((id) => {
    const run = state.catalog.runs[id]
    if (!run) return []
    const rows: FileRow[] = [
      ...preparedEntryItems(state, id).map(
        (item): FileRow => ({
          file: fileName(item.path),
          from: folderOf(item.path),
          action: item.refusedReason ? "trash" : fileAt(state.disk, item.path)?.linkTarget ? "unlink" : "trash",
          size: item.refusedReason ? 0 : (fileAt(state.disk, item.path)?.sizeBytes ?? 0),
          status: item.refusedReason ? { label: say(m, item.refusedReason) } : undefined,
        }),
      ),
      ...(withResults ? resultItems(state, id).map((item): FileRow => ({ file: fileName(item.path), from: folderOf(item.path), action: "trash", size: fileAt(state.disk, item.path)?.sizeBytes ?? 0 })) : []),
    ]
    return [{ label: run.name, rows }]
  })
}

function emptyAction(m: Messages, state: PrototypeState, projectId: ProjectId, runIds: RunId[], withResults: boolean, label: string): Action {
  const one = runIds.length === 1 ? state.catalog.runs[runIds[0]!] : undefined
  return {
    id: `empty-${withResults ? "results-" : ""}${runIds.join("-")}`,
    label,
    icon: Trash2,
    kind: "destructive",
    confirm: {
      title: one ? m.trash_empty_named_title({ name: one.name }) : m.trash_empty_runs_title({ count: runIds.length }),
      summary: withResults ? m.trash_empty_summary_results() : m.trash_empty_summary(),
      groups: emptyGroups(m, state, runIds, withResults),
      confirm: { label: one ? m.trash_empty_run() : m.trash_empty(), kind: "destructive" },
    },
    run: () => emptyTrash(projectId, runIds, withResults ? runIds : []),
  }
}

export function ProjectTrashPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string }
  const project = useStore((s) => s.catalog.projects[projectId])
  const state = useStore((s) => s)
  const [query, setQuery] = useState("")
  if (!project) return <MissingRecord title={m.project_missing_title()} backTo="/projects" backLabel={m.project_back_to_projects()} />

  const rows = projectTrash(state.catalog, projectId).map((run): Row => {
    const subject = findSubject(project, run.subjectId)
    const panel = findPanel(subject, run.panelId)
    const pipeline = runPipeline(state, run)
    return {
      run,
      where: [subject ? subjectName(m, state.catalog, subject) : m.project_unknown_subject(), panel ? panelLabel(m, panel) : null, rigName(m, state.catalog, run.rigId)].filter((part): part is string => part !== null).join(" · "),
      step: run.completion === "complete" ? m.status_finished() : say(m, STEP_NAME[pipeline.current.id]),
      entries: preparedEntryItems(state, run.id).length,
      results: resultItems(state, run.id).length,
    }
  })
  // An empty search matches every row (`matchesQuery` reads an empty query as no match).
  const shown = rows.filter((r) => query.trim() === "" || matchesQuery([r.run.name, r.where], query))
  const back = () => void navigate({ to: "/projects/$projectId", params: { projectId } })

  const columns: Column<Row>[] = [
    { id: "run", header: m.project_run_noun_capital(), cell: (r) => r.run.name, sortValue: (r) => r.run.name, rowHeader: true, truncate: true },
    { id: "where", header: m.project_col_subject(), cell: (r) => r.where, sortValue: (r) => r.where, truncate: true },
    { id: "step", header: m.project_col_step(), cell: (r) => r.step, sortValue: (r) => r.step },
    { id: "trashed", header: m.status_trashed(), cell: (r) => (r.run.trashedAt ? formatDateTime(r.run.trashedAt) : "–"), sortValue: (r) => r.run.trashedAt },
    { id: "prepared", header: m.status_prepared(), cell: (r) => (r.entries > 0 ? m.trash_entries({ count: r.entries }) : "–"), sortValue: (r) => r.entries, align: "right" },
    { id: "results", header: m.status_role_results(), cell: (r) => (r.results > 0 ? m.trash_results_count({ count: r.results }) : "–"), sortValue: (r) => r.results, align: "right" },
  ]
  const restore = (run: Run): Action => ({
    id: `restore-${run.id}`,
    label: m.trash_restore_run(),
    icon: RotateCcw,
    confirm: {
      title: m.trash_restore_title({ name: run.name }),
      summary: run.groupId ? m.trash_restore_to_group({ name: run.name }) : m.trash_restore_to_runs({ name: run.name }),
      confirm: { label: m.trash_restore_run() },
    },
    // Owner tick A1: One-click restores at once, and Undo moves the run back to Trash.
    quick: { oneClick: { undo: () => ({ message: m.trash_run_restored({ name: run.name }), run: () => trashRun(run.id) }) }, openPage: "keep" },
    run: () => restoreRun(run.id),
  })
  const rowActions = (r: Row): MenuItem[] => [
    restore(r.run),
    { separator: true },
    emptyAction(m, state, projectId, [r.run.id], false, m.trash_empty_run()),
    ...(r.results > 0 ? [emptyAction(m, state, projectId, [r.run.id], true, m.trash_empty_with_results())] : []),
  ]
  const ids = rows.map((r) => r.run.id)

  return (
    <ListPage
      title={m.trash_of_project({ name: project.name })}
      summary={m.project_runs_count({ count: rows.length })}
      menu={{ label: m.trash_title(), items: rows.length > 0 ? [emptyAction(m, state, projectId, ids, false, m.trash_empty())] : [] }}
      table={{
        label: m.trash_of_project({ name: project.name }),
        rows: shown,
        columns,
        getRowId: (r) => r.run.id,
        initialSort: { columnId: "trashed", direction: "desc" },
        rowLabel: (r) => r.run.name,
        rowActions,
        toolbar: { search: { label: m.trash_search(), placeholder: m.trash_search_placeholder(), value: query, onChange: setQuery }, matchCount: shown.length },
        empty:
          rows.length === 0 ? (
            <EmptyState icon={Trash2} title={m.trash_is_empty()} action={<ActionButton action={{ id: "open-project", label: m.activity_open_destination({ name: project.name }), run: back }} />} />
          ) : (
            <EmptyState icon={Trash2} title={m.trash_no_match()} action={<ActionButton action={{ id: "clear", label: m.filters_clear(), run: () => setQuery("") }} />} />
          ),
      }}
    />
  )
}
