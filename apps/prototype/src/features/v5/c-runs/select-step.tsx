/**
 * S5 Select: the subject's candidates on the run's rig, all preselected with
 * their reason (D-W49); Refresh offers new candidates and flags a member that
 * no longer matches its subject, with Remove (D-W45); the spec 066 tools:
 * sky coverage and distance from the Target, geometry ordering, filters
 * (channel, night, exposure, rig, quality) and the count of selected
 * sessions the filters hide, with Show (round 6); Save makes the next
 * membership revision. Rows have a right-click menu.
 */
import { useNavigate } from "@tanstack/react-router"
import { Eye, ListChecks, ListX, Plus } from "lucide-react"
import { useMemo } from "react"
import { useMessages } from "@/app/preferences"
import { Box } from "@/components/app/box"
import { type Column, DataTable } from "@/components/app/data-table"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { latestRevision, liveAssetIds, rigName, runCandidates, runRefresh, runSessionGeometry, sessionRigId, workingContent } from "@/domain/derive"
import { describeDiff, diffContent, REASON_NAME, sessionExposureS } from "@/domain/membership"
import type { SelectionReason, Session } from "@/domain/types"
import { formatCount, formatDateTime, formatDegrees, formatDuration, formatExposure, formatNight } from "@/lib/format"
import { joinRefs, type MessageRef, msg, say } from "@/lib/i18n"
import { addRunSessions, discardRunDraft, removeRunSessions, saveRun } from "@/store/actions/runs"
import { updateSlice, useStore } from "@/store/core"
import type { SelectFilter } from "@/store/slices/c"
import { SelectField } from "@/features/t3/fields"
import { type RunContext, runLock } from "./model"
import { OutcomeNotice, RowActions, useOutcome } from "./parts"

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
  /** Library quality decisions its live frames carry, for the quality filter. */
  qualities: Set<string>
}

const ANY = "any"
const ORDER_SORT: Record<NonNullable<SelectFilter["order"]>, { columnId: string; direction: "asc" | "desc" }> = {
  night: { columnId: "night", direction: "asc" },
  distance: { columnId: "distance", direction: "asc" },
  coverage: { columnId: "coverage", direction: "desc" },
}

/** The channel filter's key for sessions without a filter: never a channel name. */
const NO_CHANNEL = "\u0000none"

export function SelectStep({ ctx }: { ctx: RunContext }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { catalog } = state
  const { run } = ctx
  const navigate = useNavigate()
  const outcome = useOutcome()
  const content = workingContent(run)
  const lock = runLock(run)
  const refresh = runRefresh(catalog, run)
  const filter: SelectFilter = state.slices.c.selectFilter[run.id] ?? { channel: null, selectedOnly: false }
  const rows = useMemo(() => {
    const byId = new Map<string, SelectRow>()
    const includedBySession = new Map<string, number>()
    for (const id of content?.included ?? []) {
      const sid = catalog.assets[id]?.sessionId
      if (sid) includedBySession.set(sid, (includedBySession.get(sid) ?? 0) + 1)
    }
    const flagged = new Set(refresh.noLongerMatching)
    const row = (session: Session): Omit<SelectRow, "member" | "reason" | "candidateReason" | "noLongerMatching" | "included"> => {
      const live = liveAssetIds(catalog, session)
      return { session, frames: live.length, ...runSessionGeometry(catalog, run, session), qualities: new Set(live.map((id) => catalog.assets[id]?.quality.value ?? "unreviewed")) }
    }
    for (const c of runCandidates(catalog, run)) {
      byId.set(c.session.id, { ...row(c.session), member: false, reason: null, candidateReason: c.reason, noLongerMatching: false, included: 0 })
    }
    for (const member of content?.sessions ?? []) {
      const session = catalog.sessions[member.sessionId]
      if (!session) continue
      const existing = byId.get(session.id)
      byId.set(session.id, {
        ...row(session),
        member: true,
        reason: member.reason,
        candidateReason: existing?.candidateReason ?? null,
        noLongerMatching: flagged.has(session.id),
        included: includedBySession.get(session.id) ?? 0,
      })
    }
    return [...byId.values()].sort((a, b) => a.session.night.localeCompare(b.session.night) || (a.session.channel ?? "").localeCompare(b.session.channel ?? ""))
  }, [catalog, run, content, refresh.noLongerMatching])
  // A session without a filter is listed under one "no filter" channel; the key is not a channel name.
  const channelKey = (s: Session) => s.channel ?? NO_CHANNEL
  const channelName = (s: Session) => s.channel ?? m.palette_session_no_filter()
  const channels = [...new Map(rows.map((r) => [channelKey(r.session), channelName(r.session)]))]
  const matches = (r: SelectRow) =>
    (!filter.channel || channelKey(r.session) === filter.channel) &&
    (!filter.night || r.session.night === filter.night) &&
    (filter.exposureS == null || sessionExposureS(r.session) === filter.exposureS) &&
    (!filter.rigId || sessionRigId(r.session) === filter.rigId) &&
    (!filter.quality || r.qualities.has(filter.quality))
  const shown = rows.filter((r) => matches(r) && (!filter.selectedOnly || r.member))
  const selected = rows.filter((r) => r.member).map((r) => r.session.id)
  const hiddenSelected = rows.filter((r) => r.member && !matches(r)).length
  const setFilter = (patch: Partial<SelectFilter>) => updateSlice("c", (c) => ({ ...c, selectFilter: { ...c.selectFilter, [run.id]: { ...filter, ...patch } } }))
  const clearFilters = () => setFilter({ channel: null, night: null, exposureS: null, rigId: null, quality: null })
  const order = filter.order ?? "night"
  const options = <T,>(values: T[], label: (v: T) => string) => [{ value: ANY, label: m.goal_bar_any() }, ...[...new Set(values)].map((v) => ({ value: String(v), label: label(v) }))]
  const fieldClass = "w-32 gap-1 [&>label]:text-[0.6875rem] [&>label]:font-normal [&>label]:text-muted-foreground"
  const reasonFor = (row: SelectRow): SelectionReason =>
    run.panelId ? { kind: "panel-pointing", detail: row.candidateReason ?? msg("run_select_pointing_inside_panel") } : { kind: "candidate", detail: row.candidateReason ?? msg("status_candidate") }
  const selectionBlocked = { blocked: m.run_selection_blocked() }

  const onSelection = (ids: string[]) => {
    const next = new Set(ids)
    // Only the rows shown can change; hidden selections stay as they are (VSEL-FR-06).
    const visible = new Set(shown.map((r) => r.session.id))
    const added = [...next].filter((id) => !selected.includes(id) && visible.has(id))
    const removed = selected.filter((id) => !next.has(id) && visible.has(id))
    if (added.length > 0) {
      const byReason = new Map<string, string[]>()
      for (const id of added) {
        const row = rows.find((r) => r.session.id === id)!
        const reason = reasonFor(row)
        byReason.set(JSON.stringify(reason), [...(byReason.get(JSON.stringify(reason)) ?? []), id])
      }
      for (const [reason, ids2] of byReason) if (!outcome.act(addRunSessions(run.id, ids2, JSON.parse(reason) as SelectionReason), selectionBlocked)) return
    }
    if (removed.length > 0) outcome.act(removeRunSessions(run.id, removed), selectionBlocked)
  }

  const rowLabel = (r: SelectRow) => `${formatNight(r.session.night)} ${channelName(r.session)}`
  /** A row's primary action, done on click or Enter (round 5): add a candidate, remove a member. */
  const toggle = (r: SelectRow) =>
    r.member ? outcome.act(removeRunSessions(run.id, [r.session.id]), selectionBlocked) : outcome.act(addRunSessions(run.id, [r.session.id], reasonFor(r)), selectionBlocked)
  const sessionEntries = (r: SelectRow): MenuEntry[] => [
    { heading: rowLabel(r) },
    ...(lock ? [] : [{ label: r.member ? m.run_select_remove_from_run() : m.run_select_add_to_run(), icon: r.member ? ListX : ListChecks, onSelect: () => toggle(r) }]),
    { separator: true },
    { label: m.project_open_session(), icon: Eye, onSelect: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id } }) },
  ]

  // Reason is hidden when it is the same in every row: the subject and rig it names are in the header.
  const reasonText = (r: SelectRow) => (r.reason ? `${say(m, REASON_NAME[r.reason.kind])} · ${say(m, r.reason.detail)}` : m.run_select_not_selected({ reason: r.candidateReason ? say(m, r.candidateReason) : "" }))
  const reasonVaries = new Set(rows.map(reasonText)).size > 1
  const columns: Column<SelectRow>[] = [
    { id: "night", header: m.run_col_night(), rowHeader: true, cell: (r) => formatNight(r.session.night, true), sortValue: (r) => r.session.night },
    { id: "channel", header: m.run_col_channel(), cell: (r) => channelName(r.session), sortValue: (r) => r.session.channel ?? "" },
    { id: "frames", header: m.run_col_frames(), align: "right", cell: (r) => (r.member ? m.run_select_frames_of({ included: r.included, total: r.frames }) : `${r.frames}`), sortValue: (r) => r.frames },
    { id: "integration", header: m.run_col_integration(), align: "right", cell: (r) => formatDuration((r.member ? r.included : r.frames) * sessionExposureS(r.session)), sortValue: (r) => r.frames * sessionExposureS(r.session) },
    { id: "coverage", header: m.run_col_coverage(), align: "right", cell: (r) => (r.coverage === null ? "–" : `${formatCount(Math.round(r.coverage * 100))}%`), sortValue: (r) => r.coverage },
    { id: "distance", header: m.run_col_distance(), align: "right", cell: (r) => (r.distanceDeg === null ? "–" : formatDegrees(r.distanceDeg, 2)), sortValue: (r) => r.distanceDeg },
    ...(reasonVaries
      ? [
          {
            id: "reason",
            header: m.run_col_reason(),
            cell: (r: SelectRow) =>
              r.reason ? (
                <span>
                  <span className="text-foreground">{say(m, REASON_NAME[r.reason.kind])}</span> <span className="text-muted-foreground">· {say(m, r.reason.detail)}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{reasonText(r)}</span>
              ),
          },
        ]
      : []),
    {
      id: "state",
      header: m.run_col_state(),
      cell: (r) =>
        r.noLongerMatching ? (
          <span className="flex flex-wrap items-center gap-1">
            <Pill tone="warning">{m.run_select_no_longer_matches()}</Pill>
            {!lock ? (
              <Button size="xs" variant="outline" onClick={() => toggle(r)} aria-label={m.run_select_remove_session({ session: rowLabel(r) })}>
                {m.run_remove()}
              </Button>
            ) : null}
          </span>
        ) : r.member ? (
          <span className="text-[0.75rem]">{m.run_select_in_run()}</span>
        ) : (
          <span className="text-[0.75rem] text-muted-foreground">{m.status_candidate()}</span>
        ),
    },
    { id: "actions", header: "", cell: (r) => <RowActions entries={sessionEntries(r)} label={m.run_actions_for({ name: rowLabel(r) })} /> },
  ]

  const latest = latestRevision(run)
  const diff = run.draft ? describeDiff(catalog, diffContent(latest, run.draft)) : []
  return (
    <div className="space-y-4">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      {refresh.newCandidates.length > 0 || refresh.noLongerMatching.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" data-refresh>
          {refresh.newCandidates.length > 0 ? (
            <>
              <Pill tone="info" title={refresh.newCandidates.map((c) => `${formatNight(c.session.night)} ${channelName(c.session)}`).join(", ")}>
                {m.run_select_new_candidates({ count: refresh.newCandidates.length })}
              </Pill>
              {lock ? null : (
                <Button size="xs" onClick={() => outcome.act(addRunSessions(run.id, refresh.newCandidates.map((c) => c.session.id), { kind: "refresh-added", detail: refresh.newCandidates[0]!.reason }), selectionBlocked)}>
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  {m.run_select_add_count({ count: refresh.newCandidates.length })}
                </Button>
              )}
            </>
          ) : null}
          {refresh.noLongerMatching.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Pill tone="warning">{m.run_select_members_no_longer_match({ count: refresh.noLongerMatching.length })}</Pill>
              <NoteMarker label={m.run_select_why_no_longer_match()}>{m.run_select_no_longer_match_note()}</NoteMarker>
            </span>
          ) : null}
        </div>
      ) : null}

      <Box
        id="select-sessions"
        level={2}
        flush
        title={
          <span className="flex items-center gap-1.5">
            {m.nav_sessions()} <CountBadge count={selected.length} label={m.run_select_selected_sessions({ count: selected.length })} />
          </span>
        }
        actions={
          <>
            <ToggleGroup
              aria-label={m.run_col_channel()}
              size="sm"
              variant="outline"
              spacing={0}
              value={[filter.channel ?? "all"]}
              onValueChange={(value) => {
                const v = (value as string[])[0]
                setFilter({ channel: !v || v === "all" ? null : v })
              }}
            >
              <ToggleGroupItem value="all">{m.run_select_all_channels()}</ToggleGroupItem>
              {channels.map(([key, name]) => (
                <ToggleGroupItem key={key} value={key}>
                  {name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <label className="flex items-center gap-1.5 text-[0.75rem]" data-chrome>
              <Checkbox checked={filter.selectedOnly} onCheckedChange={(checked) => setFilter({ selectedOnly: checked === true })} />
              {m.run_select_selected_only()}
            </label>
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-2 border-b border-separator px-3 py-2" data-select-tools>
          <SelectField className={fieldClass} triggerClassName="min-h-7" label={m.run_col_night()} value={filter.night ?? ANY} onChange={(v) => setFilter({ night: v === ANY ? null : v })} options={options([...rows.map((r) => r.session.night)].sort(), (n) => formatNight(n, true))} />
          <SelectField className={fieldClass} triggerClassName="min-h-7" label={m.run_field_exposure()} value={filter.exposureS == null ? ANY : String(filter.exposureS)} onChange={(v) => setFilter({ exposureS: v === ANY ? null : Number(v) })} options={options([...rows.map((r) => sessionExposureS(r.session))].sort((a, b) => a - b), formatExposure)} />
          <SelectField className={fieldClass} triggerClassName="min-h-7" label={m.run_col_rig()} value={filter.rigId ?? ANY} onChange={(v) => setFilter({ rigId: v === ANY ? null : v })} options={options(rows.flatMap((r) => sessionRigId(r.session) ?? []), (id) => rigName(m, catalog, id))} />
          <SelectField className={fieldClass} triggerClassName="min-h-7" label={m.goal_quality()} value={filter.quality ?? ANY} onChange={(v) => setFilter({ quality: v === ANY ? null : (v as SelectFilter["quality"]) })} options={[{ value: ANY, label: m.goal_bar_any() }, { value: "unreviewed", label: m.status_unreviewed() }, { value: "usable", label: m.status_usable() }, { value: "unusable", label: m.status_unusable() }]} />
          <SelectField className={fieldClass} triggerClassName="min-h-7" label={m.run_select_order()} value={order} onChange={(v) => setFilter({ order: v as SelectFilter["order"] })} options={[{ value: "night", label: m.run_col_night() }, { value: "distance", label: m.run_col_distance() }, { value: "coverage", label: m.run_col_coverage() }]} />
          {hiddenSelected > 0 ? (
            <span className="flex items-center gap-1 pb-1 text-[0.75rem] text-muted-foreground" data-hidden-selected>
              {m.run_select_hidden_selected({ count: hiddenSelected })} ·
              <Button size="xs" variant="link" className="h-auto px-0" onClick={clearFilters}>
                {m.run_show()}
              </Button>
            </span>
          ) : null}
        </div>
        <DataTable
          key={order}
          label={m.run_select_sessions_label({ name: run.name })}
          rows={shown}
          columns={columns}
          getRowId={(r) => r.session.id}
          scroll="none"
          initialSort={ORDER_SORT[order]}
          selection={{ selected, onChange: onSelection, rowLabel, isSelectable: () => !lock }}
          contextMenu={sessionEntries}
          onRowClick={lock ? undefined : toggle}
          empty={<p className="px-3 py-4 text-sm text-muted-foreground">{m.run_select_no_candidates({ rig: rigName(m, catalog, run.rigId) })}</p>}
        />
      </Box>

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-between gap-3 border-t border-separator bg-background px-5 py-2" data-chrome>
        <p className="min-w-0 text-[0.75rem] text-muted-foreground">
          {run.draft ? (
            <>
              <span className="font-medium text-warning">{m.status_unsaved_changes()}</span> · {say(m, joinRefs(diff, "; "))}
            </>
          ) : latest ? (
            <>
              {m.run_select_revision({ revision: latest.revision })} · {formatDateTime(latest.savedAt)} · {say(m, joinRefs(latest.accepted, "; "))}
            </>
          ) : (
            m.status_not_saved()
          )}
        </p>
        <div className="flex gap-1.5">
          {run.draft ? (
            <Button size="sm" variant="outline" onClick={() => outcome.act(discardRunDraft(run.id), { blocked: m.run_discard_blocked() })}>
              {m.run_discard()}
            </Button>
          ) : null}
          <Button id="save-run" size="sm" disabled={!run.draft} onClick={() => outcome.act(saveRun(run.id), { blocked: m.run_save_blocked(), success: { title: m.run_saved_revision({ revision: (latest?.revision ?? 0) + 1 }), tone: "info" } })}>
            {m.run_save_revision({ revision: (latest?.revision ?? 0) + 1 })}
          </Button>
        </div>
      </div>
    </div>
  )
}
