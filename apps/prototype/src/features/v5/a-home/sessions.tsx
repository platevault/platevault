/**
 * S12 Sessions (slice A) as a ListPage: library light sessions only (D-W24).
 * Raw calibration frames never show here: Import and indexing route them
 * into a calibration process (P-CAL3, the Calibration library).
 *
 * - The Status facet: All, Needs review (the intake queue, C14), Needs a
 *   Target, Not in any Project, Unusable and Trashed, with counts (D-W25,
 *   D-W43). Trashed sessions show only under Trashed.
 * - A row opens the session; its ⋯ and context menu offer Review frames
 *   (the intake at its first open step), Choose Target and Add to Project
 *   (D-W59).
 * - Selected sessions in no Project offer Archive… (the reviewed transfer
 *   Wrap up uses; round 6: refused for sessions in a Project). The Unusable
 *   facet offers Move to Trash… for its Unusable frames (library clean-up
 *   through the OS Trash engine).
 * - After an Import, `?import=<operation>` lists the sessions it filled
 *   first and marks them New.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Archive, Download, Eye, Layers, ListChecks, Target, Trash2 } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, FileRow, MenuItem } from "@/components/app/contracts"
import { EmptyState, type PageNotice } from "@/components/app/feedback"
import { Pill } from "@/components/app/pill"
import { StatusBadge } from "@/components/app/status"
import { ListPage } from "@/components/templates/list-page"
import { type ArchivePlan, sessionsArchivePlan, unusableFramesOffer } from "@/domain/archive"
import { formatHours, sessionIntakeEntry, sessionIntakeLink } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import { formatBytes, formatCount, formatNight } from "@/lib/format"
import { type Messages, msg, say } from "@/lib/i18n"
import type { SearchParams } from "@/routes"
import { offerFileRows, startArchiveTransfer } from "@/store/actions/archive"
import { moveToOsTrash } from "@/store/actions/trash"
import { type PrototypeState, useStore } from "@/store/core"
import type { ImportPayload } from "./import-run"
import { addToProjectItems } from "./parts"
import { ReadinessBadge } from "./session"
import { filterCounts, filterLabel, inProject, matchesFilter, parseFilter, SESSION_FILTERS, type SessionFilter, type SessionRow, sessionRows } from "./session-model"

function emptyTitle(m: Messages, filter: SessionFilter): string {
  const title: Record<SessionFilter, () => string> = {
    all: m.sessions_empty_all,
    "needs-review": m.sessions_empty_needs_review,
    "needs-target": m.sessions_empty_needs_target,
    "not-in-project": m.sessions_empty_not_in_project,
    unusable: m.sessions_empty_unusable,
    trashed: m.sessions_empty_trashed,
  }
  return title[filter]()
}

/** Why Archive… is unavailable for the selection (round 6); null when it can run. */
function archiveUnavailable(m: Messages, selected: SessionRow[], plan: ArchivePlan): Action["unavailable"] {
  const action = m.sessions_cant_archive()
  const held = selected.filter(inProject)
  if (held.length > 0) {
    const blockers = held.map((r) => {
      const projectId = r.candidateOf[0]?.project.id ?? r.runs[0]!.projectId
      return { label: sessionLabel(m, r.session), link: { to: "/projects/$projectId", params: { projectId } } }
    })
    return { action, reason: m.sessions_in_a_project({ count: held.length }), blockers }
  }
  if (plan.blocked) return { action, reason: say(m, plan.blocked), blockers: [{ label: m.common_locations(), link: { to: "/settings/locations" } }] }
  if (plan.refused.length > 0) return { action, reason: m.wrapup_refused(), blockers: plan.refused.map((r) => ({ label: `${sessionLabel(m, r.session)} · ${say(m, r.reason)}` })) }
  if (plan.rows.length === 0) return { action, reason: m.sessions_already_archived(), blockers: [] }
  return undefined
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"))
}

/** Archive…: the reviewed transfer of the selected sessions to the archive location (round 6). */
function archiveAction(m: Messages, state: PrototypeState, selected: SessionRow[], onDone: () => void): Action {
  const plan = sessionsArchivePlan(state, selected.map((r) => r.session))
  const unavailable = archiveUnavailable(m, selected, plan)
  const destination = plan.destination?.displayName ?? m.wrapup_archive_fallback()
  const groups = plan.rows.map((row) => ({
    label: sessionLabel(m, row.session),
    rows: row.moves.map((move): FileRow => ({ file: move.from.path.slice(move.from.path.lastIndexOf("/") + 1), from: folderOf(move.from.path), to: folderOf(move.to.path), action: "move", size: move.sizeBytes })),
  }))
  return {
    id: "archive-sessions",
    label: m.wrapup_archive_title(),
    icon: Archive,
    unavailable,
    confirm: {
      title: m.wrapup_archive_confirm_title({ name: m.session_count({ count: plan.rows.length }) }),
      summary: m.wrapup_archive_change({ count: plan.rows.length, dest: destination, size: formatBytes(plan.sizeBytes) }),
      groups,
      confirm: { label: m.wrapup_archive_title() },
    },
    run: () => {
      startArchiveTransfer(null, plan.rows, "archive")
      onDone()
    },
  }
}

/** Move to Trash… for the Unusable frames of the sessions shown (or selected): the library clean-up (round 6). */
function trashUnusableAction(m: Messages, state: PrototypeState, scope: SessionRow[], onDone: () => void): Action | null {
  const offer = unusableFramesOffer(state, scope.flatMap((r) => r.unusable))
  if (offer.count === 0 && offer.refusals.length === 0) return null
  const { moved, kept } = offerFileRows(m, offer)
  return {
    id: "trash-unusable",
    label: m.run_move_to_trash(),
    icon: Trash2,
    kind: "destructive",
    unavailable: offer.count === 0 ? { action: m.sessions_cant_trash(), reason: m.sessions_all_kept({ count: offer.refusals.length }), blockers: offer.refusals.map((r) => ({ label: `${r.label} · ${say(m, r.reason)}`, link: r.link })) } : undefined,
    confirm: {
      title: m.sessions_trash_unusable_title({ count: offer.count, n: formatCount(offer.count) }),
      summary: formatBytes(offer.sizeBytes),
      groups: [{ label: m.status_unusable(), rows: moved }, ...(kept.length > 0 ? [{ label: m.sessions_kept(), rows: kept }] : [])],
      confirm: { label: m.run_move_to_trash(), kind: "destructive" },
    },
    run: () => {
      moveToOsTrash({
        kind: "rejected-frames",
        title: msg("wrapup_offer_rejected", { count: offer.count, n: formatCount(offer.count), size: formatBytes(offer.sizeBytes) }),
        projectId: null,
        runIds: [],
        items: offer.items,
        href: "/sessions?filter=unusable",
      })
      onDone()
    },
  }
}

export function SessionsPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const follow = useFollowLink()
  const m = useMessages()
  const state = useStore((s) => s)
  const rows = sessionRows(state)
  const { catalog } = state
  const filter = parseFilter(search.filter)
  const query = search.q ?? ""
  const importId = search.import
  const importOp = importId ? state.operations[importId] : undefined
  const [selected, setSelected] = useState<string[]>([])

  const imported = new Set(importOp ? (importOp.payload as unknown as ImportPayload).sessionIds : [])
  const counts = filterCounts(rows)
  const setParams = (patch: SearchParams) =>
    void navigate({
      to: "/sessions",
      search: (prev: SearchParams) => {
        const next: SearchParams = { ...prev, ...patch }
        for (const key of Object.keys(next)) if (!next[key] || next[key] === "all") delete next[key]
        return next
      },
      replace: true,
    })

  const needle = query.trim().toLowerCase()
  const shown = rows.filter((r) => {
    if (!matchesFilter(r, filter)) return false
    if (!needle) return true
    return [r.session.objectLabel, r.targetName, r.rig && say(m, r.rig), r.session.channel, formatNight(r.session.night, true), r.session.cameraName].some((v) => v?.toLowerCase().includes(needle))
  })
  // Imported sessions first while their highlight is on.
  if (imported.size > 0) shown.sort((a, b) => Number(imported.has(b.session.id)) - Number(imported.has(a.session.id)))
  const clearSelection = () => setSelected([])
  const unusableScope = shown.some((r) => selected.includes(r.session.id)) ? shown.filter((r) => selected.includes(r.session.id)) : shown
  const trashUnusable = filter === "unusable" ? trashUnusableAction(m, state, unusableScope, clearSelection) : null

  const open = (row: SessionRow) => void navigate({ to: "/sessions/$sessionId", params: { sessionId: row.session.id } })
  const rowActions = (r: SessionRow): MenuItem[] => [
    { id: "open", label: m.verb_open(), icon: Eye, run: () => open(r) },
    ...(r.trashed
      ? []
      : [
          { id: "review", label: m.session_review_frames(), icon: ListChecks, run: () => follow(sessionIntakeEntry(catalog, r.session)) },
          { separator: true } as const,
          ...(r.needsTarget ? [{ id: "choose-target", label: m.session_choose_target(), icon: Target, run: () => follow(sessionIntakeLink(r.session.id, "target")) }] : addToProjectItems(m, catalog, r.session.id)),
        ]),
  ]

  const columns: Column<SessionRow>[] = [
    {
      id: "session",
      header: m.session_label(),
      rowHeader: true,
      sortValue: (r) => `${r.session.night}|${r.session.channel ?? ""}`,
      cell: (r) => (
        <>
          {`${formatNight(r.session.night, true)} · ${r.session.channel ?? m.palette_session_no_filter()}`}
          {imported.has(r.session.id) ? <Pill tone="info">{m.sessions_new()}</Pill> : null}
        </>
      ),
    },
    { id: "label", header: m.session_header_label(), truncate: true, sortValue: (r) => r.session.objectLabel ?? "", cell: (r) => r.session.objectLabel ?? "–" },
    {
      id: "target",
      header: m.sessions_column_target(),
      truncate: true,
      sortValue: (r) => r.targetName ?? "",
      cell: (r) => r.targetName ?? <StatusBadge kind="association" value="unresolved" label={m.sessions_filter_needs_target()} />,
    },
    {
      id: "rig",
      header: m.sessions_column_rig(),
      truncate: true,
      sortValue: (r) => (r.rig ? say(m, r.rig) : ""),
      cell: (r) => (r.rig ? say(m, r.rig) : <StatusBadge kind="association" value="unresolved" label={m.sessions_rig_needs_review()} />),
    },
    {
      id: "frames",
      header: m.sessions_column_frames(),
      align: "right",
      sortValue: (r) => r.seconds,
      cell: (r) => (
        <>
          {`${formatCount(r.frames)} · ${formatHours(r.seconds)}`}
          {filter === "unusable" ? <Pill tone="danger">{m.sessions_unusable_count({ count: r.unusable.length, n: formatCount(r.unusable.length) })}</Pill> : null}
        </>
      ),
    },
    { id: "review", header: m.sessions_column_review(), sortValue: (r) => (r.trashed ? "" : r.readiness), cell: (r) => <ReadinessBadge readiness={r.readiness} unreviewed={r.unreviewed} trashed={r.trashed} /> },
    {
      id: "projects",
      header: m.sessions_column_projects_runs(),
      truncate: true,
      sortValue: (r) => r.candidateOf.map((c) => c.project.name).join(","),
      cell: (r) => {
        if (r.trashed) return "–"
        if (r.candidateOf.length === 0) return r.notInProject ? m.sessions_no_project() : "–"
        const runs = r.runs.length === 0 ? m.sessions_no_run() : m.sessions_run_count({ count: r.runs.length })
        return `${r.candidateOf.map((c) => c.project.name).join(", ")} · ${runs}`
      },
    },
  ]

  const importNotice: PageNotice | null = importOp
    ? {
        tone: "info",
        title:
          importOp.status === "running"
            ? m.sessions_import_running({ title: say(m, importOp.title) })
            : `${say(m, importOp.title)} · ${m.session_count({ count: imported.size })}`,
        detail: importOp.status === "running" ? m.sessions_import_progress({ done: formatCount(importOp.progress.done), total: formatCount(importOp.progress.total) }) : importOp.summary ? say(m, importOp.summary) : undefined,
        actions: <ActionButton action={{ id: "clear-import", label: m.verb_clear(), run: () => setParams({ import: undefined }) }} />,
      }
    : null

  const clearAction: Action = needle
    ? { id: "clear-search", label: m.sessions_clear_search(), run: () => setParams({ q: undefined }) }
    : filter === "all"
      ? { id: "import", label: m.import_open(), run: () => void navigate({ to: "/import" }) }
      : { id: "show-all", label: m.sessions_show_all(), run: () => setParams({ filter: undefined }) }

  return (
    <ListPage
      title={m.nav_sessions()}
      summary={m.sessions_light_count({ count: counts.all })}
      actions={[{ id: "import", label: m.import_open(), icon: Download, run: () => void navigate({ to: "/import" }) }]}
      notice={importNotice}
      table={{
        label: m.sessions_table_label({ filter: filterLabel(m, filter) }),
        rows: shown,
        columns,
        getRowId: (r) => r.session.id,
        rowLabel: (r) => sessionLabel(m, r.session),
        rowActions,
        onRowClick: open,
        initialSort: imported.size > 0 ? undefined : { columnId: "session", direction: "desc" },
        selection: {
          selected,
          onChange: setSelected,
          rowLabel: (r) => sessionLabel(m, r.session),
          isSelectable: (r) => !r.trashed,
          countLabel: (count) => m.project_sessions_selected({ count }),
          onShowHidden: () => setParams({ q: undefined, filter: undefined }),
        },
        batchActions: (ids) => {
          const picked = rows.filter((r) => ids.includes(r.session.id) && !r.trashed)
          return [archiveAction(m, state, picked, clearSelection), ...(trashUnusable ? [trashUnusable] : [])]
        },
        toolbar: {
          search: { label: m.sessions_search(), placeholder: m.sessions_search_placeholder(), value: query, onChange: (value) => setParams({ q: value }) },
          facets: {
            items: [
              {
                id: "filter",
                label: m.sessions_facet_status(),
                kind: "single",
                options: SESSION_FILTERS.map((f) => ({ value: f, label: filterLabel(m, f), count: counts[f] })),
                value: filter === "all" ? "" : filter,
              },
            ],
            onChange: (patch) => setParams({ filter: typeof patch.filter === "string" && patch.filter ? patch.filter : undefined }),
          },
          actions: trashUnusable ? [trashUnusable] : [],
          matchCount: shown.length,
        },
        empty: <EmptyState icon={Layers} title={needle ? m.sessions_no_match() : emptyTitle(m, filter)} action={<ActionButton action={clearAction} />} />,
      }}
    />
  )
}
