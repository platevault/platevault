/**
 * S12 Sessions (slice A): library light sessions only (D-W24). Raw
 * calibration frames never show here: Import and indexing route them into a
 * calibration process (P-CAL3, the Calibration library). Filters All, Needs
 * a Target, Not in any Project, Unusable and Trashed, with counts (D-W25,
 * D-W43; Trashed sessions show only under Trashed); the search is
 * clearable. A click on a row opens the session; row actions: Review (the
 * session detail's review region, `?view=review`) and Add to Project (also
 * adds the rig, D-W59); right click opens the row's menu (Choose Target
 * among them). Selected sessions in no Project offer Archive…, the reviewed
 * transfer Wrap up uses (round 6; refused for sessions in a Project). The
 * Unusable filter offers Move to Trash… for its Unusable frames: library
 * clean-up through the OS Trash engine. After an Import,
 * `?import=<operation>` highlights the sessions it filled.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Archive, Download, Eye, Layers, ListChecks, Target, Trash2 } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { openSheet } from "@/app/ui-state"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { type Column, DataTable, SelectionBar, TableToolbar } from "@/components/app/data-table"
import { EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal, type RefusalProps } from "@/components/app/refusal"
import type { MenuEntry } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatHours } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import { startArchiveTransfer } from "@/features/v5/b-projects/actions"
import { type ArchivePlan, sessionsArchivePlan, unusableFramesOffer } from "@/features/v5/b-projects/model"
import { formatBytes, formatCount, formatNight } from "@/lib/format"
import { type Messages, msg, say } from "@/lib/i18n"
import type { SearchParams } from "@/routes"
import { moveToOsTrash } from "@/store/actions/trash"
import { useStore } from "@/store/core"
import type { ImportPayload } from "./import-run"
import { AddToProjectDialog, AddToProjectMenu, type AddedNotice, addToProjectEntries, type PendingAdd } from "./parts"
import { filterCounts, filterLabel, inProject, matchesFilter, parseFilter, type SessionFilter, type SessionRow, sessionReviewSearch, sessionRows } from "./session-model"

const FILTERS: SessionFilter[] = ["all", "needs-target", "not-in-project", "unusable", "trashed"]

function emptyTitle(m: Messages, filter: SessionFilter): string {
  const title: Record<SessionFilter, () => string> = {
    all: m.sessions_empty_all,
    "needs-target": m.sessions_empty_needs_target,
    "not-in-project": m.sessions_empty_not_in_project,
    unusable: m.sessions_empty_unusable,
    trashed: m.sessions_empty_trashed,
  }
  return title[filter]()
}

/** Why Archive… is unavailable for the selection, as a standing refusal (round 6); null when it can run. */
function archiveRefusal(m: Messages, selected: SessionRow[], plan: ArchivePlan): RefusalProps | null {
  const action = m.sessions_cant_archive()
  const held = selected.filter(inProject)
  if (held.length > 0) {
    const blockers = held.map((r) => {
      const projectId = r.candidateOf[0]?.project.id ?? r.runs[0]!.projectId
      return { label: sessionLabel(m, r.session), link: { to: "/projects/$projectId", params: { projectId } } }
    })
    return { action, reason: m.sessions_in_a_project({ count: held.length }), blockers, standing: true }
  }
  if (plan.blocked) return { action, reason: say(m, plan.blocked), blockers: [{ label: `${m.nav_settings()} › ${m.common_locations()}`, link: { to: "/settings/locations" } }], standing: true }
  if (plan.refused.length > 0) return { action: m.wrapup_sessions_stay({ count: plan.refused.length }), reason: m.wrapup_refused(), blockers: plan.refused.map((r) => ({ label: `${sessionLabel(m, r.session)} · ${say(m, r.reason)}` })), standing: true }
  if (plan.rows.length === 0) return { action, reason: m.sessions_already_archived(), blockers: [], standing: true }
  return null
}

export function SessionsPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const m = useMessages()
  const filter = parseFilter(search.filter)
  const query = search.q ?? ""
  const importId = search.import
  const rows = useStore(sessionRows)
  const state = useStore((s) => s)
  const catalog = state.catalog
  const importOp = useStore((s) => (importId ? s.operations[importId] : undefined))
  const [notice, setNotice] = useState<AddedNotice | null>(null)
  const [adding, setAdding] = useState<PendingAdd | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [archiving, setArchiving] = useState(false)
  const [trashing, setTrashing] = useState(false)
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
  const selectedRows = rows.filter((r) => selected.includes(r.session.id) && !r.trashed)
  const hiddenSelected = selectedRows.filter((r) => !shown.includes(r)).length
  const archivePlan = sessionsArchivePlan(
    state,
    selectedRows.filter((r) => !inProject(r)).map((r) => r.session),
  )
  const archiveBlocked = selectedRows.length > 0 ? archiveRefusal(m, selectedRows, archivePlan) : null
  // Move to Trash… takes the selection's Unusable frames when it has any shown here, else every listed session's.
  const trashScope = shown.some((r) => selected.includes(r.session.id)) ? shown.filter((r) => selected.includes(r.session.id)) : shown
  const unusableOffer = filter === "unusable" ? unusableFramesOffer(state, trashScope.flatMap((r) => r.unusable)) : null

  const open = (r: SessionRow, extra?: { hash?: string; search?: Record<string, string> }) => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id }, hash: extra?.hash, search: extra?.search ?? {} })
  const review = (r: SessionRow) => open(r, { search: sessionReviewSearch(r.unreviewed) })

  const columns: Column<SessionRow>[] = [
    {
      id: "session",
      header: m.session_label(),
      rowHeader: true,
      sortValue: (r) => `${r.session.night}|${r.session.channel ?? ""}`,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-x-2 whitespace-nowrap">
          <Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} className="font-medium underline-offset-2 hover:underline" title={r.session.objectLabel ? m.session_object({ name: r.session.objectLabel }) : m.session_no_object()}>
            {formatNight(r.session.night, true)} · {r.session.channel ?? m.palette_session_no_filter()}
          </Link>
          {imported.has(r.session.id) ? <Pill tone="info">{m.sessions_new()}</Pill> : null}
        </span>
      ),
    },
    {
      id: "target",
      header: m.sessions_column_target(),
      sortValue: (r) => r.targetName ?? "",
      cell: (r) =>
        r.targetName ? (
          <span className="truncate">{r.targetName}</span>
        ) : (
          <span className="-my-1 flex items-center gap-2 whitespace-nowrap" title={r.session.objectLabel ? m.session_object({ name: r.session.objectLabel }) : m.session_no_object()}>
            <StatusBadge kind="association" value={r.session.target.status === "needs-review" ? "needs-review" : "unresolved"} label={m.sessions_filter_needs_target()} />
          </span>
        ),
    },
    {
      id: "rig",
      header: m.sessions_column_rig(),
      sortValue: (r) => (r.rig ? say(m, r.rig) : ""),
      truncate: true,
      className: "max-w-44",
      cell: (r) => (r.rig ? say(m, r.rig) : <StatusBadge kind="association" value={r.session.equipment.status === "needs-review" ? "needs-review" : "unresolved"} label={m.sessions_rig_needs_review()} />),
    },
    {
      id: "frames",
      header: m.sessions_column_frames(),
      align: "right",
      sortValue: (r) => r.seconds,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {formatCount(r.frames)} <span className="text-muted-foreground">· {formatHours(r.seconds)}</span>
          {filter === "unusable" ? <Pill tone="danger">{m.sessions_unusable_count({ count: r.unusable.length, n: formatCount(r.unusable.length) })}</Pill> : null}
        </span>
      ),
    },
    {
      id: "review",
      header: m.step_review(),
      sortValue: (r) => r.unreviewed,
      cell: (r) =>
        r.trashed ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          <Button size="xs" variant="outline" className="-my-1" onClick={() => review(r)} data-review-session={r.session.id}>
            {m.verb_review()}
            {r.unreviewed > 0 ? <CountBadge count={r.unreviewed} tone="warning" label={m.session_frames_unreviewed({ count: r.unreviewed, frames: formatCount(r.unreviewed) })} /> : null}
            <span className="sr-only"> {sessionLabel(m, r.session)}</span>
          </Button>
        ),
    },
    {
      id: "projects",
      header: m.sessions_column_projects_runs(),
      sortValue: (r) => r.candidateOf.map((c) => c.project.name).join(","),
      cell: (r) =>
        r.trashed ? (
          <Pill tone="muted">{m.status_trashed()}</Pill>
        ) : r.candidateOf.length > 0 ? (
          <span className="truncate" title={[...r.candidateOf.map((c) => c.project.name), ...r.runs.map((run) => m.sessions_run_named({ name: run.name }))].join(", ")}>
            {r.candidateOf.map((c) => c.project.name).join(", ")}
            <span className="text-muted-foreground"> · {r.runs.length === 0 ? m.sessions_no_run() : m.sessions_run_count({ count: r.runs.length })}</span>
          </span>
        ) : r.notInProject ? (
          <span className="-my-1 flex items-center gap-2 whitespace-nowrap">
            <Pill tone="warning">{m.sessions_no_project()}</Pill>
            <AddToProjectMenu sessionId={r.session.id} size="xs" onAdded={setNotice} />
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        ),
    },
  ]

  const menu = (r: SessionRow): MenuEntry[] => [
    { heading: sessionLabel(m, r.session) },
    { label: m.verb_open(), icon: Eye, onSelect: () => open(r) },
    ...(r.trashed
      ? []
      : [
          { label: m.session_review_frames(), icon: ListChecks, onSelect: () => review(r) },
          { separator: true } as const,
          ...(r.needsTarget ? [{ label: m.session_choose_target(), icon: Target, onSelect: () => open(r, { hash: "target" }) }] : addToProjectEntries(m, catalog, r.session.id, setAdding)),
        ]),
  ]

  const importSummary = importOp && importOp.status !== "running" && importOp.summary ? say(m, importOp.summary) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={m.nav_sessions()}
        meta={<CountBadge count={counts.all} label={m.sessions_light_count({ count: counts.all })} />}
        actions={
          <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "import" })}>
            <Download data-icon="inline-start" aria-hidden="true" />
            {m.import_open()}
          </Button>
        }
      />
      <PageBody className="space-y-3">
        {importOp ? (
          <Notice
            tone="info"
            title={importOp.status === "running" ? m.sessions_import_running({ title: say(m, importOp.title) }) : `${say(m, importOp.title)} · ${m.session_count({ count: imported.size })}`}
            actions={
              <Button size="xs" variant="ghost" onClick={() => setParams({ import: undefined })}>
                {m.verb_clear()}
              </Button>
            }
          >
            {importSummary ?? m.sessions_import_progress({ done: formatCount(importOp.progress.done), total: formatCount(importOp.progress.total) })}
          </Notice>
        ) : null}
        {notice ? (
          <Notice tone="info" title={notice.title} actions={<Button size="xs" variant="ghost" onClick={() => setNotice(null)}>{m.session_dismiss()}</Button>}>
            {notice.note}
          </Notice>
        ) : null}
        <TableToolbar
          search={{ label: m.sessions_search(), placeholder: m.sessions_search_placeholder(), value: query, onChange: (value) => setParams({ q: value }) }}
          filters={
            <>
              <ToggleGroup aria-label={m.sessions_filter()} size="sm" variant="outline" spacing={0} value={[filter]} onValueChange={(value) => value[0] && setParams({ filter: value[0] as string })}>
                {FILTERS.map((f) => (
                  <ToggleGroupItem key={f} value={f} data-filter={f} className="gap-1.5">
                    {filterLabel(m, f)}
                    <CountBadge count={counts[f]} tone={counts[f] > 0 && (f === "needs-target" || f === "not-in-project") ? "warning" : "neutral"} />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {filter === "trashed" ? <HelpTip label={m.sessions_trashed_help_label()}>{m.sessions_trashed_help()}</HelpTip> : null}
            </>
          }
          actions={
            unusableOffer ? (
              <Button size="sm" variant="outline" disabled={unusableOffer.count === 0} onClick={() => setTrashing(true)} data-trash-unusable>
                <Trash2 data-icon="inline-start" aria-hidden="true" />
                {m.trash_move_ellipsis()}
              </Button>
            ) : null
          }
        />
        {selectedRows.length > 0 ? (
          <div className="space-y-1.5">
            <SelectionBar
              count={selectedRows.length}
              hiddenByFilters={hiddenSelected}
              label={m.project_sessions_selected({ count: selectedRows.length })}
              onClear={() => setSelected([])}
              actions={
                <Button size="sm" variant="outline" disabled={archiveBlocked !== null} onClick={() => setArchiving(true)} data-archive-sessions>
                  <Archive data-icon="inline-start" aria-hidden="true" />
                  {m.wrapup_archive_ellipsis()}
                </Button>
              }
            />
            {archiveBlocked ? <Refusal {...archiveBlocked} /> : null}
          </div>
        ) : null}
        <DataTable
          label={m.sessions_table_label({ filter: filterLabel(m, filter) })}
          rows={shown}
          columns={columns}
          getRowId={(r) => r.session.id}
          selection={{ selected, onChange: setSelected, rowLabel: (r) => sessionLabel(m, r.session), isSelectable: (r) => !r.trashed }}
          stickyFirstColumn
          contextMenu={menu}
          onRowClick={(r) => open(r)}
          initialSort={imported.size > 0 ? undefined : { columnId: "session", direction: "desc" }}
          rowClassName={(r) => (imported.has(r.session.id) ? "bg-link/[0.07]" : undefined)}
          empty={
            <EmptyState
              icon={Layers}
              title={needle ? m.sessions_no_match() : emptyTitle(m, filter)}
              description={null}
              className="m-3"
              action={
                needle ? (
                  <Button size="sm" variant="outline" onClick={() => setParams({ q: undefined })}>
                    {m.sessions_clear_search()}
                  </Button>
                ) : filter === "all" ? (
                  <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "import" })}>
                    {m.import_open()}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setParams({ filter: undefined })}>
                    {m.sessions_show_all()}
                  </Button>
                )
              }
            />
          }
        />
      </PageBody>
      <AddToProjectDialog pending={adding} onClose={() => setAdding(null)} onAdded={setNotice} />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={m.wrapup_archive_confirm_title({ name: m.session_count({ count: archivePlan.rows.length }) })}
        description={m.wrapup_archive_description()}
        changes={[
          m.wrapup_archive_change({ count: archivePlan.rows.length, dest: archivePlan.destination?.displayName ?? m.wrapup_archive_fallback(), size: formatBytes(archivePlan.sizeBytes) }),
          m.wrapup_archive_links_follow(),
        ]}
        confirmLabel={m.wrapup_archive_title()}
        onConfirm={() => {
          startArchiveTransfer(null, archivePlan.rows, "archive")
          setSelected([])
        }}
      />
      {unusableOffer ? (
        <ConfirmDialog
          open={trashing}
          onOpenChange={setTrashing}
          title={m.sessions_trash_unusable_title({ count: unusableOffer.count, n: formatCount(unusableOffer.count) })}
          description={m.wrapup_trash_offer_description()}
          changes={[m.wrapup_items_to_trash({ count: unusableOffer.count, size: formatBytes(unusableOffer.sizeBytes) }), ...(unusableOffer.refusals.length > 0 ? [m.wrapup_items_kept_reason({ count: unusableOffer.refusals.length })] : [])]}
          confirmLabel={m.run_move_to_trash()}
          tone="destructive"
          onConfirm={() => {
            moveToOsTrash({
              kind: "rejected-frames",
              title: msg("wrapup_offer_rejected", { count: unusableOffer.count, n: formatCount(unusableOffer.count), size: formatBytes(unusableOffer.sizeBytes) }),
              projectId: null,
              runIds: [],
              items: unusableOffer.items,
              href: "/sessions?filter=unusable",
            })
            setSelected([])
          }}
        />
      ) : null}
    </div>
  )
}
