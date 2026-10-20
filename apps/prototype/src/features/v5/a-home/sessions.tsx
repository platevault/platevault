/**
 * S12 Sessions (slice A) as a ListPage: library light sessions only (D-W24).
 * Raw calibration frames never show here: Import and indexing route them
 * into a calibration process (P-CAL3, the Calibration library).
 *
 * - The Status facet: All, Needs review (the intake queue, C14), Needs a
 *   Target, Needs calibration (the Library's calibration queue, LIB-FR-23),
 *   Not in any Project, Duplicates (F5), Unusable and Trashed, with counts
 *   (D-W25, D-W43). Trashed sessions show only under Trashed.
 * - Each row reads its darks, flats and bias (what still needs a choice, or
 *   Pinned) and carries the duplicates badge when its frames have extra
 *   copies (F5). Label, Rig and Projects start hidden under Columns ▾
 *   (kept per table, `sessions`), so the table fits a 1280 px window.
 * - A row opens the session; its ⋯ and context menu offer Review frames
 *   (the intake at its first open step; review stays open once Ready),
 *   Choose Target and Choose rig while it lacks one, Edit… (the session's
 *   name and notes, D-W76), then Add to Project ▸ (D-W59), which is
 *   unavailable with its reason until the session is Ready and settled
 *   (PRJ-FR-08), and New Project…, as on Targets. A named session reads
 *   its name in the Session column. A session
 *   with an issue (drift, a changed pinned file) offers Dismiss issue there,
 *   and Restore issue once dismissed; the Issues facet (With issues ·
 *   Dismissed, `?issues=`) is Show dismissed. The Library counts that open
 *   this page ("2 need a Target") are dismissed and restored from the
 *   Sessions ▾ menu (F7, P-ISS1).
 * - The selection replaces the toolbar row at its height, so nothing moves,
 *   and offers every session action: Review frames, Archive… (the reviewed
 *   transfer Wrap up uses, STO-FR-13), Confirm calibration (suggestions
 *   become pins), Choose Target, Choose rig, No darks, No flats or No bias
 *   (for the kinds still waiting or suggested) and Add to Project ▸. A
 *   queue's own actions lead under its filter. Archive… is refused for a
 *   session an open Project holds, previewing those as a Session · Project
 *   table; a Closed Project's kept View is repointed. The Unusable facet
 *   offers Move to Trash… for its Unusable frames (library clean-up through
 *   the OS Trash engine); the Duplicates facet offers Review duplicates…
 *   (`?duplicates=review`, P-STO2), the dialog the route injects.
 * - After an Import, `?import=<operation>` lists the sessions it filled
 *   first and marks them New.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Archive, Check, CircleSlash, Copy, Download, Eye, Layers, ListChecks, Target, Telescope, Trash2 } from "lucide-react"
import { type ComponentType, useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/components/app/links"
import { ActionButton } from "@/components/app/actions"
import { issuesFacet, matchesIssueFilter, type OwnIssues, pageIssues, parseIssueFilter, rowIssues, withIssueItems } from "@/components/app/issue-actions"
import type { Action, Column, FileRow, MenuItem } from "@/components/app/contracts"
import { EmptyState, type PageNotice } from "@/components/app/feedback"
import { Pill } from "@/components/app/pill"
import { StatusBadge } from "@/components/app/status"
import { DuplicatesBadge } from "@/components/domain/duplicates-badge"
import { ReadinessBadge } from "@/components/domain/readiness-badge"
import { ListPage } from "@/components/templates/list-page"
import { type ArchivePlan, sessionsArchivePlan, unusableFramesOffer } from "@/domain/archive"
import { NO_KIND_NAME, PIN_KINDS } from "@/domain/calibration"
import { formatHours, sessionIntakeEntry, sessionIntakeLink, type StepLink } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import type { Catalog, PinKind } from "@/domain/types"
import { formatBytes, formatCount, formatNight } from "@/lib/format"
import { type Messages, msg, say } from "@/lib/i18n"
import type { SearchParams } from "@/routes"
import { offerFileRows, startArchiveTransfer } from "@/store/actions/archive"
import { confirmCalibration, type SessionKind, setNoCalibration } from "@/store/actions/calibration"
import { moveToOsTrash } from "@/store/actions/trash"
import { type PrototypeState, useStore } from "@/store/core"
import { useIssues } from "@/store/issues"
import type { ImportPayload } from "./import-run"
import { addToProjectItems, editSessionAction } from "./parts"
import { CalibrationSummary } from "./session"
import { SessionDetailsDialog } from "./session-details-dialog"
import { filterCounts, filterLabel, matchesFilter, openHolder, parseFilter, SESSION_FILTERS, type SessionFilter, type SessionRow, sessionRows } from "./session-model"

function emptyTitle(m: Messages, filter: SessionFilter): string {
  const title: Record<SessionFilter, () => string> = {
    all: m.sessions_empty_all,
    "needs-review": m.sessions_empty_needs_review,
    "needs-target": m.sessions_empty_needs_target,
    "needs-calibration": m.sessions_empty_needs_calibration,
    "not-in-project": m.sessions_empty_not_in_project,
    duplicates: m.sessions_empty_duplicates,
    unusable: m.sessions_empty_unusable,
    trashed: m.sessions_empty_trashed,
  }
  return title[filter]()
}

/** The kinds of the selected sessions a batch acts on, one pick per session and kind. */
function picksOf(rows: SessionRow[], kinds: readonly PinKind[], states: ReadonlyArray<"waiting" | "suggested">): SessionKind[] {
  return rows.flatMap((r) => kinds.flatMap((kind) => (r.session.calibration && (states as readonly string[]).includes(r.session.calibration[kind].state) ? [{ sessionId: r.session.id, kind }] : [])))
}

function sessionCount(picks: SessionKind[]): number {
  return new Set(picks.map((p) => p.sessionId)).size
}

/** Confirm suggestions: each suggestion of the selected sessions becomes the user's pin (LIB-FR-23), after its confirmation. */
function confirmCalibrationAction(m: Messages, selected: SessionRow[], onDone: () => void): Action {
  const picks = picksOf(selected, PIN_KINDS, ["suggested"])
  const count = sessionCount(picks)
  return {
    id: "confirm-calibration",
    label: m.sessions_confirm_suggestions(),
    icon: Check,
    unavailable: picks.length === 0 ? { action: m.sessions_confirm_suggestions(), reason: m.calibration_choices_none_suggested(), blockers: [] } : undefined,
    confirm: { title: m.sessions_confirm_calibration_title({ count }), summary: m.sessions_confirm_calibration_summary({ count: picks.length }), confirm: { label: m.verb_confirm() } },
    run: () => {
      const result = confirmCalibration(picks)
      if (result.ok) onDone()
      return result
    },
  }
}

/** No darks, No flats or No bias for the selected sessions whose kind still waits or is only suggested (CAL-FR-05: no reason asked; a pin is never overridden here). */
function noCalibrationAction(m: Messages, selected: SessionRow[], kind: PinKind, onDone: () => void): Action {
  const picks = picksOf(selected, [kind], ["waiting", "suggested"])
  const choice = say(m, NO_KIND_NAME[kind])
  return {
    id: `no-${kind}`,
    label: choice,
    icon: CircleSlash,
    unavailable: picks.length === 0 ? { action: choice, reason: m.sessions_no_choice_none(), blockers: [] } : undefined,
    confirm: { title: m.sessions_set_no_title({ choice, count: picks.length }), confirm: { label: choice } },
    run: () => {
      const result = setNoCalibration(picks)
      if (result.ok) onDone()
      return result
    },
  }
}

type Follow = (link: StepLink) => void

/** Review frames: the first of the sessions still in the review queue, else the first one; Finish review then follows the queue (C14). */
function reviewAction(m: Messages, catalog: Catalog, rows: SessionRow[], follow: Follow): Action {
  const first = rows.find((r) => r.queued) ?? rows[0]
  return {
    id: "review",
    label: m.session_review_frames(),
    icon: ListChecks,
    run: () => {
      if (first) follow(sessionIntakeEntry(catalog, first.session))
    },
  }
}

/** Choose Target or Choose rig: that intake step of the first session still without one; unavailable when none of them lacks it. */
function intakeStepAction(m: Messages, rows: SessionRow[], step: "target" | "rig", follow: Follow): Action {
  const label = step === "target" ? m.session_choose_target() : m.session_choose_rig()
  const first = rows.find((r) => (step === "target" ? r.needsTarget : r.rig === null))
  return {
    id: `choose-${step}`,
    label,
    icon: step === "target" ? Target : Telescope,
    unavailable: first ? undefined : { action: label, reason: step === "target" ? m.sessions_none_need_target() : m.sessions_none_need_rig(), blockers: [] },
    run: () => {
      if (first) follow(sessionIntakeLink(first.session.id, step))
    },
  }
}

/** Why Archive… is unavailable for the selection (round 6); null when it can run. Sessions an open Project holds preview as a table, Session · Project ▸. */
function archiveUnavailable(m: Messages, selected: SessionRow[], plan: ArchivePlan): Action["unavailable"] {
  const action = m.sessions_cant_archive()
  const held = selected.flatMap((r) => {
    const project = openHolder(r)
    return project ? [{ row: r, project }] : []
  })
  if (held.length > 0) {
    const blockers = held.map(({ row, project }) => ({ label: sessionLabel(m, row.session), where: project.name, link: { to: "/projects/$projectId", params: { projectId: project.id } } }))
    return { action, reason: m.sessions_in_a_project({ count: held.length }), blockers, columns: { item: m.session_label(), where: m.project_noun() } }
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
      startArchiveTransfer(null, plan.rows)
      onDone()
    },
  }
}

/** Move to Trash… for the Unusable frames of the sessions shown (or selected): the library clean-up (round 6). Its review lists every copy it trashes and every frame that stays, with why (astro-plan-6bh3p). */
function trashUnusableAction(m: Messages, state: PrototypeState, scope: SessionRow[], onDone: () => void): Action | null {
  const offer = unusableFramesOffer(state, scope.flatMap((r) => r.unusable))
  if (offer.count === 0 && offer.refusals.length === 0) return null
  const { moved, kept } = offerFileRows(m, state, offer)
  return {
    id: "trash-unusable",
    label: m.common_move_to_trash(),
    icon: Trash2,
    kind: "destructive",
    unavailable: offer.count === 0 ? { action: m.trash_cant(), reason: m.sessions_all_kept({ count: offer.refusals.length }), blockers: offer.refusals.map((r) => ({ label: `${r.label} · ${say(m, r.reason)}`, link: r.link })) } : undefined,
    confirm: {
      title: m.sessions_trash_unusable_title({ count: offer.count, n: formatCount(offer.count) }),
      summary: formatBytes(offer.sizeBytes),
      groups: [{ label: m.status_unusable(), rows: moved }, ...(kept.length > 0 ? [{ label: m.sessions_kept(), rows: kept }] : [])],
      confirm: { label: m.common_move_to_trash(), kind: "destructive" },
    },
    run: () => {
      moveToOsTrash({
        kind: "rejected-frames",
        title: msg("wrapup_offer_rejected", { count: offer.count, n: { count: offer.count }, size: { bytes: offer.sizeBytes } }),
        projectId: null,
        items: offer.items,
        href: "/sessions?filter=unusable",
      })
      onDone()
    },
  }
}

/** The Duplicates review dialog (P-STO2), injected by the route so features stay apart; it opens on `?duplicates=review`. */
export type DuplicatesReviewDialog = ComponentType<{ open: boolean; onClose: () => void }>

export function SessionsPage({ duplicatesReview: DuplicatesReview }: { duplicatesReview?: DuplicatesReviewDialog }) {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const follow = useFollowLink()
  const m = useMessages()
  const state = useStore((s) => s)
  const rows = sessionRows(state)
  const { catalog } = state
  const filter = parseFilter(search.filter)
  const issueFilter = parseIssueFilter(search.issues)
  const issueView = useIssues()
  const issuesOf = (r: SessionRow): OwnIssues => rowIssues(issueView, { kind: "session", id: r.session.id })
  const query = search.q ?? ""
  const importId = search.import
  const importOp = importId ? state.operations[importId] : undefined
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const editingSession = editing ? catalog.sessions[editing] : undefined

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
    if (!matchesFilter(r, filter) || !matchesIssueFilter(issuesOf(r), issueFilter)) return false
    if (!needle) return true
    return [r.session.name, r.session.objectLabel, r.targetName, r.rig && say(m, r.rig), r.session.channel, formatNight(r.session.night, true), r.session.cameraName].some((v) => v?.toLowerCase().includes(needle))
  })
  // Imported sessions first while their highlight is on.
  if (imported.size > 0) shown.sort((a, b) => Number(imported.has(b.session.id)) - Number(imported.has(a.session.id)))
  const clearSelection = () => setSelected([])
  const unusableScope = shown.some((r) => selected.includes(r.session.id)) ? shown.filter((r) => selected.includes(r.session.id)) : shown
  const trashUnusable = filter === "unusable" ? trashUnusableAction(m, state, unusableScope, clearSelection) : null
  const reviewDuplicates: Action | null =
    filter === "duplicates" && DuplicatesReview ? { id: "review-duplicates", label: m.sessions_review_duplicates(), icon: Copy, opensDialog: true, run: () => setParams({ duplicates: "review" }) } : null

  const open = (row: SessionRow) => void navigate({ to: "/sessions/$sessionId", params: { sessionId: row.session.id } })
  // The row offers the session actions that apply to it; the selection offers every one (below).
  const rowActions = (r: SessionRow): MenuItem[] =>
    withIssueItems(m, [
      { id: "open", label: m.verb_open(), icon: Eye, run: () => open(r) },
      ...(r.trashed
        ? []
        : [
            reviewAction(m, catalog, [r], follow),
            ...(r.needsTarget ? [intakeStepAction(m, [r], "target", follow)] : []),
            ...(r.rig === null ? [intakeStepAction(m, [r], "rig", follow)] : []),
            editSessionAction(m, () => setEditing(r.session.id)),
            { separator: true } as const,
            ...addToProjectItems(m, catalog, [r.session.id]),
          ]),
    ], issuesOf(r))
  /** Every session action for the selection: the queue's own lead there; elsewhere Review frames, Archive… and Confirm suggestions…; the rest and Add to Project ▸ under More. */
  const selectionActions = (ids: string[]): MenuItem[] => {
    const picked = rows.filter((r) => ids.includes(r.session.id) && !r.trashed)
    const review = reviewAction(m, catalog, picked, follow)
    const target = intakeStepAction(m, picked, "target", follow)
    const calibration = [confirmCalibrationAction(m, picked, clearSelection), ...PIN_KINDS.map((kind) => noCalibrationAction(m, picked, kind, clearSelection))]
    const lead = filter === "needs-calibration" ? calibration : filter === "needs-target" ? [target] : [review]
    const all = [review, archiveAction(m, state, picked, clearSelection), ...calibration.slice(0, 1), target, intakeStepAction(m, picked, "rig", follow), ...calibration.slice(1), ...(trashUnusable ? [trashUnusable] : [])]
    return [...lead, ...all.filter((action) => !lead.includes(action)), ...addToProjectItems(m, catalog, picked.map((r) => r.session.id))]
  }
  const pageMenu = withIssueItems(m, [], pageIssues(issueView, "/sessions"))

  // Label, rig and Projects are in the Columns menu (and on the session's details; Review names a rig that needs review),
  // so the table fits its frame in a 1280 px window in both languages.
  const columns: Column<SessionRow>[] = [
    {
      id: "session",
      header: m.session_label(),
      rowHeader: true,
      sortValue: (r) => `${r.session.night}|${r.session.channel ?? ""}`,
      cell: (r) => (
        <>
          {r.session.name ?? `${formatNight(r.session.night, true)} · ${r.session.channel ?? m.palette_session_no_filter()}`}
          {imported.has(r.session.id) ? <Pill tone="info">{m.sessions_new()}</Pill> : null}
          {r.duplicates > 0 ? <DuplicatesBadge count={r.duplicates} /> : null}
        </>
      ),
    },
    { id: "label", header: m.session_header_label(), truncate: true, hideable: true, defaultHidden: true, sortValue: (r) => r.session.objectLabel ?? "", cell: (r) => r.session.objectLabel ?? "–" },
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
      hideable: true,
      defaultHidden: true,
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
          {filter === "unusable" ? <StatusBadge kind="quality" value="unusable" label={m.sessions_unusable_count({ count: r.unusable.length, n: formatCount(r.unusable.length) })} /> : null}
        </>
      ),
    },
    { id: "review", header: m.sessions_column_review(), sortValue: (r) => (r.trashed ? "" : r.readiness), cell: (r) => <ReadinessBadge readiness={r.readiness} unreviewed={r.unreviewed} trashed={r.trashed} /> },
    {
      id: "calibration",
      header: m.nav_calibration(),
      sortValue: (r) => (r.trashed ? 2 : r.needsCalibration ? 0 : 1),
      cell: (r) => (r.trashed || !r.session.calibration ? "–" : <CalibrationSummary calibration={r.session.calibration} disk={state.disk} />),
    },
    {
      id: "projects",
      header: m.nav_projects(),
      truncate: true,
      hideable: true,
      defaultHidden: true,
      sortValue: (r) => r.projects.map((p) => p.name).join(","),
      cell: (r) => {
        if (r.trashed) return "–"
        if (r.projects.length === 0) return r.notInProject ? m.sessions_no_project() : "–"
        return r.projects.map((p) => p.name).join(", ")
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
    : filter === "all" && !issueFilter
      ? { id: "import", label: m.import_open(), run: () => void navigate({ to: "/import" }) }
      : { id: "show-all", label: m.sessions_show_all(), run: () => setParams({ filter: undefined, issues: undefined }) }
  const emptyText = needle ? m.sessions_no_match() : issueFilter === "dismissed" ? m.issues_filter_none_dismissed() : issueFilter === "with-issues" ? m.issues_none() : emptyTitle(m, filter)
  const facetValue = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined)

  return (
    <>
      <ListPage
        title={m.nav_sessions()}
        summary={m.sessions_light_count({ count: counts.all })}
        actions={[{ id: "import", label: m.import_open(), icon: Download, run: () => void navigate({ to: "/import" }) }]}
        menu={pageMenu.length > 0 ? { label: m.nav_sessions(), items: pageMenu } : undefined}
        notice={importNotice}
        table={{
          label: m.sessions_table_label({ filter: filterLabel(m, filter) }),
          rows: shown,
          columns,
          columnsId: "sessions",
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
            onShowHidden: () => setParams({ q: undefined, filter: undefined, issues: undefined }),
          },
          batchActions: selectionActions,
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
                issuesFacet(m, rows.map(issuesOf), issueFilter),
              ],
              onChange: (patch) => setParams({ ...("filter" in patch ? { filter: facetValue(patch.filter) } : {}), ...("issues" in patch ? { issues: facetValue(patch.issues) } : {}) }),
            },
            actions: [...(trashUnusable ? [trashUnusable] : []), ...(reviewDuplicates ? [reviewDuplicates] : [])],
            matchCount: shown.length,
          },
          empty: <EmptyState icon={Layers} title={emptyText} action={<ActionButton action={clearAction} />} />,
        }}
      />
      {DuplicatesReview ? <DuplicatesReview open={search.duplicates === "review"} onClose={() => setParams({ duplicates: undefined })} /> : null}
      {editingSession ? <SessionDetailsDialog session={editingSession} open onOpenChange={(next) => !next && setEditing(null)} /> : null}
    </>
  )
}
