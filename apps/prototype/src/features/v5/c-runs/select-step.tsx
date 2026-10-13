/**
 * S5 Select (§5.4): one DataTable of the run's Ready candidates and its
 * members, for its subject on its rig (a panel run's, by pointing; D-W49,
 * D-W38). The selection is the membership: ticking a row adds the session to
 * the run's draft, unticking removes it, and filters never change it
 * (VSEL-FR-06). Facets Night, Channel and In run. The toolbar adds new
 * candidates, discards the draft, and links the matching sessions that still
 * need review at intake (P-REV2, C14). Proceed saves the revision; after a
 * library mark changes the inputs, the footer reads "Inputs changed ·
 * Refresh" until it does (C10).
 */
import { useNavigate } from "@tanstack/react-router"
import { Eye, ListChecks, ListX, Plus, Undo2 } from "lucide-react"
import { useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, Facet, MenuItem } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { Refusal, refusalFrom } from "@/components/app/refusal"
import { StatusBadge } from "@/components/app/status"
import { liveAssetIds, rigName, runCandidates, runRefresh, runSessionGeometry, runSessionsNeedingReview, workingContent } from "@/domain/derive"
import { REASON_NAME, sessionExposureS } from "@/domain/membership"
import type { SelectionReason, Session } from "@/domain/types"
import { formatCount, formatDegrees, formatDuration, formatNight } from "@/lib/format"
import { type MessageRef, msg, say } from "@/lib/i18n"
import { addRunSessions, discardRunDraft, removeRunSessions } from "@/store/actions/runs"
import { type CommitResult, updateSlice, useStore } from "@/store/core"
import type { SelectFilter } from "@/store/slices/c"
import type { RunContext } from "./model"

interface SelectRow {
  session: Session
  member: boolean
  reason: SelectionReason | null
  candidateReason: MessageRef | null
  noLongerMatching: boolean
  included: number
  frames: number
  distanceDeg: number | null
  coverage: number | null
}

/** The channel facet's value for sessions without a filter: never a channel name. */
const NO_CHANNEL = "\u0000none"
const IN_RUN = "in-run"

export function SelectStep({ ctx, editable }: { ctx: RunContext; editable: boolean }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { catalog } = state
  const { run } = ctx
  const navigate = useNavigate()
  const [failure, setFailure] = useState<CommitResult | null>(null)
  const content = workingContent(run)
  const refresh = runRefresh(catalog, run)
  const needReview = runSessionsNeedingReview(catalog, run)
  const filter: SelectFilter = state.slices.c.selectFilter[run.id] ?? { channel: null, selectedOnly: false }
  const rows = useMemo(() => {
    const byId = new Map<string, SelectRow>()
    const includedBySession = new Map<string, number>()
    for (const id of content?.included ?? []) {
      const sid = catalog.assets[id]?.sessionId
      if (sid) includedBySession.set(sid, (includedBySession.get(sid) ?? 0) + 1)
    }
    const flagged = new Set(refresh.noLongerMatching)
    const facts = (session: Session) => ({ session, frames: liveAssetIds(catalog, session).length, ...runSessionGeometry(catalog, run, session) })
    for (const c of runCandidates(catalog, run)) byId.set(c.session.id, { ...facts(c.session), member: false, reason: null, candidateReason: c.reason, noLongerMatching: false, included: 0 })
    for (const member of content?.sessions ?? []) {
      const session = catalog.sessions[member.sessionId]
      if (!session) continue
      byId.set(session.id, {
        ...facts(session),
        member: true,
        reason: member.reason,
        candidateReason: byId.get(session.id)?.candidateReason ?? null,
        noLongerMatching: flagged.has(session.id),
        included: includedBySession.get(session.id) ?? 0,
      })
    }
    return [...byId.values()]
  }, [catalog, run, content, refresh.noLongerMatching])

  const channelKey = (s: Session) => s.channel ?? NO_CHANNEL
  const channelName = (s: Session) => s.channel ?? m.palette_session_no_filter()
  const facetMatch = (r: SelectRow) => (!filter.channel || channelKey(r.session) === filter.channel) && (!filter.night || r.session.night === filter.night)
  const shown = rows.filter((r) => facetMatch(r) && (!filter.selectedOnly || r.member))
  const selected = rows.filter((r) => r.member).map((r) => r.session.id)
  const setFilter = (patch: Partial<SelectFilter>) => updateSlice("c", (c) => ({ ...c, selectFilter: { ...c.selectFilter, [run.id]: { ...filter, ...patch } } }))
  const count = (pick: (r: SelectRow) => boolean) => rows.filter(pick).length
  const facets: Facet[] = [
    {
      id: "night",
      label: m.run_col_night(),
      kind: "single",
      options: [...new Set(rows.map((r) => r.session.night))].sort().map((night) => ({ value: night, label: formatNight(night, true), count: count((r) => r.session.night === night) })),
      value: filter.night ?? "",
    },
    {
      id: "channel",
      label: m.run_col_channel(),
      kind: "single",
      options: [...new Map(rows.map((r) => [channelKey(r.session), channelName(r.session)]))].map(([value, label]) => ({ value, label, count: count((r) => channelKey(r.session) === value) })),
      value: filter.channel ?? "",
    },
    { id: "in-run", label: m.run_select_in_run(), kind: "single", options: [{ value: IN_RUN, label: m.run_select_members_only(), count: selected.length }], value: filter.selectedOnly ? IN_RUN : "" },
  ]
  const onFacets = (patch: Record<string, string | string[]>) => {
    const value = (id: string) => (typeof patch[id] === "string" ? (patch[id] as string) : "")
    setFilter({
      ...("night" in patch ? { night: value("night") || null } : {}),
      ...("channel" in patch ? { channel: value("channel") || null } : {}),
      ...("in-run" in patch ? { selectedOnly: value("in-run") === IN_RUN } : {}),
    })
  }

  const act = (result: CommitResult) => {
    setFailure(result.ok ? null : result)
    return result
  }
  const reasonFor = (row: SelectRow): SelectionReason =>
    run.panelId ? { kind: "panel-pointing", detail: row.candidateReason ?? msg("run_select_pointing_inside_panel") } : { kind: "candidate", detail: row.candidateReason ?? msg("status_candidate") }
  const add = (ids: string[]) => {
    const byReason = new Map<string, string[]>()
    for (const id of ids) {
      const row = rows.find((r) => r.session.id === id)
      if (!row) continue
      const key = JSON.stringify(reasonFor(row))
      byReason.set(key, [...(byReason.get(key) ?? []), id])
    }
    for (const [reason, group] of byReason) if (!act(addRunSessions(run.id, group, JSON.parse(reason) as SelectionReason)).ok) return
  }
  const onSelection = (ids: string[]) => {
    const next = new Set(ids)
    // Only the rows shown change; members the filters hide stay (VSEL-FR-06).
    const visible = new Set(shown.map((r) => r.session.id))
    const added = [...next].filter((id) => !selected.includes(id) && visible.has(id))
    const removed = selected.filter((id) => !next.has(id) && visible.has(id))
    if (added.length > 0) add(added)
    if (removed.length > 0) act(removeRunSessions(run.id, removed))
  }
  const rowLabel = (r: SelectRow) => `${formatNight(r.session.night)} ${channelName(r.session)}`

  const toolbarActions: Action[] = []
  if (editable && refresh.newCandidates.length > 0) {
    toolbarActions.push({
      id: "add-new",
      label: m.run_select_add_new({ count: refresh.newCandidates.length }),
      icon: Plus,
      run: () => addRunSessions(run.id, refresh.newCandidates.map((c) => c.session.id), { kind: "refresh-added", detail: refresh.newCandidates[0]!.reason }),
    })
  }
  if (editable && run.draft) toolbarActions.push({ id: "discard", label: m.store_label_discard(), icon: Undo2, run: () => discardRunDraft(run.id) })
  if (needReview.length > 0) {
    toolbarActions.push({ id: "needs-review", label: m.flow_sessions_need_review({ count: needReview.length }), icon: Eye, run: () => void navigate({ to: "/sessions", search: { filter: "needs-review" } as never }) })
  }

  const rowActions = (r: SelectRow): MenuItem[] => [
    ...(editable
      ? [
          r.member
            ? { id: "remove", label: m.run_select_remove_from_run(), icon: ListX, run: () => removeRunSessions(run.id, [r.session.id]) }
            : { id: "add", label: m.run_select_add_to_run(), icon: ListChecks, run: () => addRunSessions(run.id, [r.session.id], reasonFor(r)) },
        ]
      : []),
    { id: "open-session", label: m.project_open_session(), icon: Eye, run: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id } }) },
  ]

  // The reason column shows only when the reasons differ: every row's subject and rig are the header's.
  const reasonText = (r: SelectRow) => (r.reason ? say(m, REASON_NAME[r.reason.kind]) : r.candidateReason ? say(m, r.candidateReason) : "")
  const reasonVaries = new Set(rows.map(reasonText)).size > 1
  const columns: Column<SelectRow>[] = [
    { id: "night", header: m.run_col_night(), rowHeader: true, cell: (r) => formatNight(r.session.night, true), sortValue: (r) => r.session.night },
    { id: "channel", header: m.run_col_channel(), cell: (r) => channelName(r.session), sortValue: (r) => r.session.channel ?? "" },
    {
      id: "frames",
      header: m.run_col_frames(),
      align: "right",
      cell: (r) => (r.member ? m.run_select_frames_of({ included: formatCount(r.included), total: formatCount(r.frames) }) : formatCount(r.frames)),
      sortValue: (r) => r.frames,
    },
    { id: "integration", header: m.run_col_integration(), align: "right", cell: (r) => formatDuration((r.member ? r.included : r.frames) * sessionExposureS(r.session)), sortValue: (r) => r.frames * sessionExposureS(r.session) },
    { id: "coverage", header: m.run_col_coverage(), align: "right", cell: (r) => (r.coverage === null ? "–" : m.common_percent({ value: formatCount(Math.round(r.coverage * 100)) })), sortValue: (r) => r.coverage },
    { id: "distance", header: m.run_col_distance(), align: "right", cell: (r) => (r.distanceDeg === null ? "–" : formatDegrees(r.distanceDeg, 2)), sortValue: (r) => r.distanceDeg },
    ...(reasonVaries ? [{ id: "reason", header: m.run_col_reason(), truncate: true, cell: reasonText, sortValue: reasonText } satisfies Column<SelectRow>] : []),
    {
      id: "state",
      header: m.run_col_state(),
      cell: (r) =>
        r.noLongerMatching ? (
          <StatusBadge kind="association" value="needs-review" label={m.run_select_no_longer_matches()} />
        ) : r.member ? (
          <StatusBadge kind="acceptance" value="accepted" label={m.run_select_in_run()} />
        ) : (
          <StatusBadge kind="acceptance" value="candidate" />
        ),
      sortValue: (r) => (r.noLongerMatching ? 0 : r.member ? 1 : 2),
    },
  ]

  const refusal = refusalFrom(failure, m.run_selection_blocked())
  return (
    <>
      {refusal ? <Refusal {...refusal} /> : null}
      <DataTable
        label={m.run_select_sessions_label({ name: run.name })}
        rows={shown}
        columns={columns}
        getRowId={(r) => r.session.id}
        initialSort={{ columnId: "night", direction: "asc" }}
        scroll="none"
        selection={{
          selected,
          onChange: onSelection,
          rowLabel,
          membership: true,
          isSelectable: () => editable,
          countLabel: (n) => m.run_select_members_count({ count: n }),
          onShowHidden: () => setFilter({ channel: null, night: null, selectedOnly: false }),
        }}
        toolbar={{ facets: { items: facets, onChange: onFacets }, matchCount: shown.length, actions: toolbarActions }}
        rowLabel={rowLabel}
        rowActions={rowActions}
        empty={
          <EmptyState
            icon={ListChecks}
            title={m.run_select_no_candidates({ rig: rigName(m, catalog, run.rigId) })}
            action={<ActionButton action={{ id: "sessions", label: m.nav_sessions(), run: () => void navigate({ to: "/sessions" }) }} />}
          />
        }
      />
    </>
  )
}
