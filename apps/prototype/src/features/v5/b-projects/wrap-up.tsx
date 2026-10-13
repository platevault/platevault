/**
 * Wrap up (§5.5, C3, P-WRAP1, P-ARC1): the Project's Wrap up tab, a StepPage
 * driven by the domain's `wrapUpFlowState` through U11's `wrapUpFlow`:
 * Clean up runs → Trash → Archive, strictly in that order. Each step is a
 * selection step: its DataTable preselects the recommended rows, a row
 * expands to its files, and rows that cannot move say why in their Status
 * cell. Proceed confirms the selection with its file groups and starts the
 * step's work; the step reads Finished once that work succeeds (F2). With
 * nothing selected Proceed records the step Skipped, and with nothing left it
 * records it Finished ("Nothing to clean up"). Archive's Proceed is Close
 * project…: the Project closes when its transfer succeeds, or at once with
 * nothing to move. A settled step shows its record; an earlier one reopens
 * from the footer until Close (F5). A closed Project's Wrap up is read-only.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { UsedByPreview } from "@/components/app/previews"
import type { Column, ConfirmSpec, FileRow } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable, type DataTableToolbar } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { stepEditable } from "@/components/app/step-flow"
import { StepPage } from "@/components/templates/step-page"
import { type ArchiveRow, archivePlan, type OfferKind, type OfferRefusal } from "@/domain/archive"
import { fileAt } from "@/domain/disk"
import { archiveLocations, defaultArchiveLocation, projectRuns, runSetup, type StepLink, wrapUpFlowState } from "@/domain/derive"
import { WRAP_UP_NAME, WRAP_UP_STEPS } from "@/domain/labels"
import type { TrashItem } from "@/domain/storage"
import type { InputMode, OperationId, Project, Run, WrapUpStepId } from "@/domain/types"
import { fileName, formatBytes, formatCount, formatDateTime } from "@/lib/format"
import { type Messages, msg, say } from "@/lib/i18n"
import { startArchiveTransfer } from "@/store/actions/archive"
import { type WrapUpSelection, wrapUpFlow } from "@/store/actions/flows"
import { setProjectArchiveLocation } from "@/store/actions/projects"
import { startRunViewRemoval } from "@/store/actions/runs"
import { moveToOsTrash, preparedEntryItems } from "@/store/actions/trash"
import { type PrototypeState, useStore } from "@/store/core"
import { CheckCheck, Package, Trash2 } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { ActionButton } from "@/components/app/actions"
import { entryItems, OFFER_KINDS, trashOffers } from "./model"
import type { ProjectChrome } from "./project"

const OFFER_NAME: Record<OfferKind, ReturnType<typeof msg>> = { "rejected-frames": msg("wrapup_offer_rejects"), intermediates: msg("run_results_intermediates"), "duplicate-copies": msg("wrapup_offer_duplicates_label") }

/** The folder holding a path. */
function folderOf(path: string): string {
  return path.split("/").slice(0, -1).join("/")
}

/** A row that cannot move: its reason, linked to where it can be resolved (P-TRASH2). */
function StatusCell({ status }: { status: { label: string; link?: StepLink } | null }) {
  if (!status) return "–"
  return status.link ? <UsedByPreview label={status.label} link={status.link} items={[]} /> : status.label
}

// ---------------------------------------------------------------------------
// The rows of each step
// ---------------------------------------------------------------------------

interface CleanupRow {
  id: string
  run: Run
  view: InputMode
  items: TrashItem[]
  links: number
  copies: number
  bytes: number
  status: { label: string } | null
}

/** Finished runs whose view was kept (F6): their links are unlinked and their copies go to the OS Trash. */
function cleanupRows(m: Messages, state: PrototypeState, project: Project): CleanupRow[] {
  return projectRuns(state.catalog, project.id)
    .filter((run) => run.completion === "complete")
    .flatMap((run): CleanupRow[] => {
      const items = preparedEntryItems(state, run.id)
      if (items.length === 0) return []
      const refused = items.find((i) => i.refusedReason)
      const files = items.filter((i) => !i.refusedReason).map((i) => fileAt(state.disk, i.path))
      const links = files.filter((f) => f?.linkTarget).length
      return [
        {
          id: run.id,
          run,
          view: runSetup(state.catalog, run).inputMode ?? state.settings.defaultRunView,
          items: items.filter((i) => !i.refusedReason),
          links,
          copies: files.length - links,
          bytes: files.reduce((n, f) => n + (f && !f.linkTarget ? f.sizeBytes : 0), 0),
          status: refused?.refusedReason ? { label: say(m, refused.refusedReason) } : null,
        },
      ]
    })
}

function cleanupFiles(state: PrototypeState, row: CleanupRow): FileRow[] {
  return row.items.map((item) => {
    const file = fileAt(state.disk, item.path)
    return file?.linkTarget ? { file: fileName(item.path), from: folderOf(item.path), action: "unlink", size: 0 } : { file: fileName(item.path), from: folderOf(item.path), action: "trash", size: file?.sizeBytes ?? 0 }
  })
}

interface TrashRow {
  id: string
  kind: OfferKind
  label: string
  path: string | null
  detail: string | null
  size: number
  items: TrashItem[]
  status: { label: string; link?: StepLink } | null
}

/** Each offered file of the three groups, then the files that stay, with why (no Project-only rejects: P-REJ2). */
function trashRows(m: Messages, state: PrototypeState, project: Project): TrashRow[] {
  const offers = trashOffers(state, project)
  return OFFER_KINDS.flatMap((kind) => {
    const offer = offers[kind]
    const moved = offer.entries.map((entry): TrashRow => ({ id: `${kind}:${entry.key}`, kind, label: entry.label, path: entry.path, detail: entry.detail, size: entry.sizeBytes, items: entryItems(offer, entry), status: null }))
    const kept = offer.refusals.map(
      (refusal: OfferRefusal): TrashRow => ({ id: `${kind}:kept:${refusal.key}`, kind, label: refusal.label, path: refusal.path, detail: null, size: 0, items: [], status: { label: say(m, refusal.reason), link: refusal.link } }),
    )
    return [...moved, ...kept]
  })
}

interface ArchiveTableRow {
  id: string
  label: string
  row: ArchiveRow | null
  from: string
  to: string
  size: number
  status: { label: string } | null
}

function archiveRows(m: Messages, state: PrototypeState, project: Project): { rows: ArchiveTableRow[]; blocked: string | null } {
  const plan = archivePlan(state, project)
  const label = (session: ArchiveRow["session"]) => `${session.objectLabel ?? m.project_unknown_subject()} · ${session.channel ?? m.palette_session_no_filter()}`
  const name = (session: ArchiveRow["session"]) => {
    const target = session.target.value ? state.catalog.targets[session.target.value]?.name : undefined
    return target ? `${target} · ${session.channel ?? m.palette_session_no_filter()}` : label(session)
  }
  const rows: ArchiveTableRow[] = [
    ...plan.rows.map((row) => ({ id: row.session.id, label: name(row.session), row, from: row.moves[0] ? folderOf(row.moves[0].from.path) : "–", to: row.folder, size: row.sizeBytes, status: null })),
    ...plan.refused.map((r) => ({ id: r.session.id, label: name(r.session), row: null, from: "–", to: "–", size: 0, status: { label: say(m, r.reason) } })),
    ...plan.kept.map((k) => ({ id: k.session.id, label: name(k.session), row: null, from: "–", to: "–", size: 0, status: { label: m.wrapup_stays_used_by({ names: k.projects.join(", ") }) } })),
  ]
  return { rows, blocked: plan.blocked ? say(m, plan.blocked) : null }
}

function moveFiles(row: ArchiveRow): FileRow[] {
  return row.moves.map((move) => ({ file: fileName(move.from.path), from: folderOf(move.from.path), to: folderOf(move.to.path), action: "move", size: move.sizeBytes }))
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** Each step's selection; null keeps the recommended rows (every row that can move). */
type Picked = Record<WrapUpStepId, string[] | null>

export function WrapUpPage({ project, chrome, step }: { project: Project; chrome: ProjectChrome; step?: string }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const [picked, setPicked] = useState<Picked>({ cleanup: null, trash: null, archive: null })

  const cleanup = cleanupRows(m, state, project)
  const trash = trashRows(m, state, project)
  const archive = archiveRows(m, state, project)
  const movable = {
    cleanup: cleanup.filter((r) => !r.status).map((r) => r.id),
    trash: trash.filter((r) => !r.status).map((r) => r.id),
    archive: archive.rows.filter((r) => r.row).map((r) => r.id),
  }
  const chosen = (id: WrapUpStepId) => (picked[id] ?? movable[id]).filter((rowId) => movable[id].includes(rowId))

  /** The selection Proceed acts on, for the step the flow is at. */
  function selectionFor(id: WrapUpStepId): WrapUpSelection {
    const ids = chosen(id)
    if (id === "cleanup") {
      const rows = cleanup.filter((r) => ids.includes(r.id))
      const confirm: ConfirmSpec = {
        title: m.wrapup_cleanup_confirm_title({ count: rows.length }),
        summary: m.wrapup_cleanup_summary({ links: formatCount(rows.reduce((n, r) => n + r.links, 0)), copies: formatCount(rows.reduce((n, r) => n + r.copies, 0)), size: formatBytes(rows.reduce((n, r) => n + r.bytes, 0)) }),
        groups: rows.map((r) => ({ label: r.run.name, rows: cleanupFiles(state, r) })),
        confirm: { label: m.run_clean_up() },
      }
      return { offered: movable.cleanup.length, selected: rows.length, confirm, start: () => rows.flatMap((r) => startRunViewRemoval(r.run.id).operationId ?? []) }
    }
    if (id === "trash") {
      const rows = trash.filter((r) => ids.includes(r.id))
      const kinds = OFFER_KINDS.filter((kind) => rows.some((r) => r.kind === kind))
      const confirm: ConfirmSpec = {
        title: m.wrapup_trash_confirm_title({ count: rows.length }),
        summary: formatBytes(rows.reduce((n, r) => n + r.size, 0)),
        groups: kinds.map((kind) => ({
          label: say(m, OFFER_NAME[kind]),
          rows: rows.filter((r) => r.kind === kind).map((r): FileRow => ({ file: r.label, from: r.path ? folderOf(r.path) : "", action: "trash", size: r.size })),
        })),
        confirm: { label: m.run_move_to_trash(), kind: "destructive" },
      }
      const start = (): OperationId[] =>
        kinds.map((kind) =>
          moveToOsTrash({
            kind,
            title: msg("op_offer_to_trash", { offer: OFFER_NAME[kind], name: project.name }),
            projectId: project.id,
            runIds: [],
            items: rows.filter((r) => r.kind === kind).flatMap((r) => r.items),
            href: `/projects/${project.id}?stage=wrap-up&step=trash`,
          }),
        )
      return { offered: movable.trash.length, selected: rows.length, confirm, start }
    }
    const rows = archive.rows.filter((r) => ids.includes(r.id) && r.row).map((r) => r.row!)
    return {
      offered: movable.archive.length,
      selected: rows.length,
      confirm: { title: "", groups: [{ label: m.wrapup_archive_moves(), rows: rows.flatMap(moveFiles) }], confirm: { label: m.stepflow_close_project() } },
      start: () => [startArchiveTransfer(project.id, rows, "archive")],
    }
  }

  const current = wrapUpFlowState(state, project).current
  const flow = wrapUpFlow(state, project, m, selectionFor(current))
  const viewing = (WRAP_UP_STEPS as string[]).includes(step ?? "") ? (step as WrapUpStepId) : (flow.current as WrapUpStepId)
  const viewed = flow.steps.find((s) => s.id === viewing)
  const editable = stepEditable(flow, viewing)
  const settled = viewed?.state === "finished" || viewed?.state === "skipped" || (Boolean(viewed?.gate) && (project.wrapUp[viewing]?.operationIds.length ?? 0) > 0 && !project.wrapUp[viewing]?.redo)
  const select = (id: WrapUpStepId) => (editable ? { selected: chosen(id), onChange: (ids: string[]) => setPicked((p) => ({ ...p, [id]: ids })) } : null)

  const body = settled ? (
    <StepRecord project={project} step={viewing} summary={viewed?.summary ?? null} />
  ) : viewing === "cleanup" ? (
    <CleanupTable rows={cleanup} select={select("cleanup")} />
  ) : viewing === "trash" ? (
    <TrashTable rows={trash} select={select("trash")} />
  ) : (
    <ArchiveTable project={project} rows={archive.rows} blocked={archive.blocked} select={select("archive")} editable={editable} />
  )

  return (
    <StepPage
      path={chrome.path}
      title={project.name}
      status={chrome.status}
      menu={chrome.menu}
      notice={chrome.notice}
      views={chrome.views}
      flow={flow}
      viewing={viewing}
      stepsLabel={m.wrapup_steps()}
      step={body}
    />
  )
}

interface Select {
  selected: string[]
  onChange: (ids: string[]) => void
}

function CleanupTable({ rows, select }: { rows: CleanupRow[]; select: Select | null }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const view = (r: CleanupRow) => (r.view === "symlink" ? m.domain_mode_symlink() : m.domain_mode_copy())
  const columns: Column<CleanupRow>[] = [
    { id: "run", header: m.project_run_noun_capital(), cell: (r) => r.run.name, sortValue: (r) => r.run.name, rowHeader: true, truncate: true },
    { id: "view", header: m.wrapup_col_view(), cell: view, sortValue: view },
    { id: "items", header: m.wrapup_col_items(), cell: (r) => formatCount(r.items.length), sortValue: (r) => r.items.length, align: "right" },
    { id: "size", header: m.dialog_col_size(), cell: (r) => formatBytes(r.bytes), sortValue: (r) => r.bytes, align: "right" },
    { id: "status", header: m.dialog_col_status(), cell: (r) => <StatusCell status={r.status} />, sortValue: (r) => r.status?.label ?? null, truncate: true },
  ]
  return (
    <DataTable
      label={m.wrapup_cleanup_title()}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      scroll="none"
      rowLabel={(r) => r.run.name}
      expand={{ render: (r) => <FileTable label={r.run.name} rows={cleanupFiles(state, r)} /> }}
      selection={select ? { ...select, rowLabel: (r) => r.run.name, isSelectable: (r) => !r.status, countLabel: (count) => m.project_runs_count({ count }) } : undefined}
      empty={<EmptyState icon={CheckCheck} title={m.flow_nothing_to_clean_up()} action={null} />}
    />
  )
}

function TrashTable({ rows, select }: { rows: TrashRow[]; select: Select | null }) {
  const m = useMessages()
  const columns: Column<TrashRow>[] = [
    { id: "item", header: m.dialog_col_file(), cell: (r) => r.label, sortValue: (r) => r.label, rowHeader: true, truncate: true },
    { id: "detail", header: m.wrapup_col_detail(), cell: (r) => r.detail ?? "–", sortValue: (r) => r.detail, truncate: true },
    { id: "from", header: m.dialog_col_from(), cell: (r) => (r.path ? folderOf(r.path) : "–"), sortValue: (r) => r.path, truncate: true },
    { id: "size", header: m.dialog_col_size(), cell: (r) => (r.status ? "–" : formatBytes(r.size)), sortValue: (r) => r.size, align: "right" },
    { id: "status", header: m.dialog_col_status(), cell: (r) => <StatusCell status={r.status} />, sortValue: (r) => r.status?.label ?? null, truncate: true },
  ]
  return (
    <DataTable
      label={m.trash_title()}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      scroll="none"
      groups={{ key: (r) => r.kind, label: (kind, group) => m.wrapup_group_line({ name: say(m, OFFER_NAME[kind as OfferKind]), count: group.length }), compare: (a, b) => OFFER_KINDS.indexOf(a as OfferKind) - OFFER_KINDS.indexOf(b as OfferKind) }}
      selection={select ? { ...select, rowLabel: (r) => r.label, isSelectable: (r) => !r.status, countLabel: (count) => m.wrapup_items({ count }) } : undefined}
      empty={<EmptyState icon={Trash2} title={m.wrapup_nothing_to_trash()} action={null} />}
    />
  )
}

function ArchiveTable({ project, rows, blocked, select, editable }: { project: Project; rows: ArchiveTableRow[]; blocked: string | null; select: Select | null; editable: boolean }) {
  const m = useMessages()
  const navigate = useNavigate()
  const locations = useStore((s) => archiveLocations(s))
  const fallback = useStore((s) => defaultArchiveLocation(s))
  const destination = project.archiveLocationId ?? fallback?.id ?? ""
  const toolbar: DataTableToolbar = {
    select:
      locations.length > 0
        ? {
            label: m.wrapup_destination(),
            value: destination,
            options: locations.map((l) => ({ value: l.id, label: l.id === fallback?.id ? m.wrapup_location_default({ name: l.displayName }) : l.displayName })),
            onChange: (value) => void setProjectArchiveLocation(project.id, value === fallback?.id ? null : value),
            disabled: !editable,
          }
        : undefined,
  }
  const columns: Column<ArchiveTableRow>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => r.label, sortValue: (r) => r.label, rowHeader: true, truncate: true },
    { id: "from", header: m.dialog_col_from(), cell: (r) => r.from, sortValue: (r) => r.from, truncate: true },
    { id: "to", header: m.dialog_col_to(), cell: (r) => r.to, sortValue: (r) => r.to, truncate: true },
    { id: "size", header: m.dialog_col_size(), cell: (r) => (r.row ? formatBytes(r.size) : "–"), sortValue: (r) => r.size, align: "right" },
    { id: "status", header: m.dialog_col_status(), cell: (r) => <StatusCell status={r.status} />, sortValue: (r) => r.status?.label ?? null, truncate: true },
  ]
  return (
    <DataTable
      label={m.wrapup_archive_title()}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      scroll="none"
      toolbar={toolbar}
      rowLabel={(r) => r.label}
      expand={{ isExpandable: (r) => r.row !== null, render: (r) => (r.row ? <FileTable label={r.label} rows={moveFiles(r.row)} /> : null) }}
      selection={select ? { ...select, rowLabel: (r) => r.label, isSelectable: (r) => r.row !== null, countLabel: (count) => m.project_sessions_selected({ count }) } : undefined}
      empty={
        <EmptyState
          icon={Package}
          title={blocked ?? m.wrapup_nothing_to_archive()}
          action={blocked ? <ActionButton action={{ id: "locations", label: `${m.nav_settings()} › ${m.common_locations()}`, run: () => void navigate({ to: "/settings/locations" }) }} /> : null}
        />
      }
    />
  )
}

/** The files a row moves, one level under it: File · From · To · Size. */
function FileTable({ label, rows }: { label: string; rows: FileRow[] }) {
  const m = useMessages()
  const action = (r: FileRow) => (r.action === "unlink" ? m.dialog_to_unlink() : r.action === "move" ? (r.to ?? "–") : m.dialog_to_trash())
  const columns: Column<FileRow & { key: string }>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (r) => r.file, sortValue: (r) => r.file, rowHeader: true, truncate: true },
    { id: "from", header: m.dialog_col_from(), cell: (r) => r.from, sortValue: (r) => r.from, truncate: true },
    { id: "to", header: m.dialog_col_to(), cell: action, sortValue: action, truncate: true },
    { id: "size", header: m.dialog_col_size(), cell: (r) => (r.size > 0 ? formatBytes(r.size) : "–"), sortValue: (r) => r.size, align: "right" },
  ]
  return <DataTable label={m.wrapup_files_of({ name: label })} rows={rows.map((r, i) => ({ ...r, key: String(i) }))} columns={columns} getRowId={(r) => r.key} scroll="none" />
}

/** A settled step's record: how it ended and what its work moved (§5.6: Finished or Skipped, with date and moved bytes). */
function StepRecord({ project, step, summary }: { project: Project; step: WrapUpStepId; summary: string | null }) {
  const m = useMessages()
  const operations = useStore((s) => (project.wrapUp[step]?.operationIds ?? []).map((id) => s.operations[id]).filter((op) => op !== undefined))
  const record = project.wrapUp[step]
  return (
    <KeyValueList
      items={[
        { label: say(m, WRAP_UP_NAME[step]), value: summary ?? (record ? formatDateTime(record.at) : "–") },
        ...operations.map((op) => ({ label: say(m, op.title), value: op.summary ? say(m, op.summary) : <StatusBadge kind="operation" value={op.status} /> })),
      ]}
    />
  )
}
