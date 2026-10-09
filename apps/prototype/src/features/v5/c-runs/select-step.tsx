/**
 * S5 Select: the subject's candidates on the run's rig, all preselected with
 * their reason (D-W49); Refresh offers new candidates and flags a member that
 * no longer matches its subject, with Remove (D-W45); accepted Results of
 * other runs as product inputs, shown with their rig (D-W4, D-W56); Save
 * makes the next membership revision. Rows have a right-click menu.
 */
import { useNavigate } from "@tanstack/react-router"
import { Copy, Eye, ListChecks, ListX, Plus, X } from "lucide-react"
import { useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Box } from "@/components/app/box"
import { type Column, DataTable } from "@/components/app/data-table"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { HelpTip, NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { latestRevision, liveAssetIds, rigName, runCandidates, runRefresh, workingContent } from "@/domain/derive"
import { RESULT_KIND_LABEL } from "@/domain/labels"
import { describeDiff, diffContent, REASON_LABEL, sessionExposureS } from "@/domain/membership"
import type { ResultRecord, Run, SelectionReason, Session } from "@/domain/types"
import { fileName, formatDateTime, formatDuration, formatNight } from "@/lib/format"
import { m } from "@/lib/i18n"
import { addRunSessions, discardRunDraft, removeRunSessions, saveRun, setProductInputs } from "@/store/actions/runs"
import { type PrototypeState, updateSlice, useStore } from "@/store/core"
import { type RunContext, runLock } from "./model"
import { OutcomeNotice, RowActions, Sha, useOutcome } from "./parts"

interface SelectRow {
  session: Session
  member: boolean
  reason: SelectionReason | null
  candidateReason: string | null
  noLongerMatching: boolean
  included: number
  frames: number
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
  const filter = state.slices.c.selectFilter[run.id] ?? { channel: null, selectedOnly: false }
  const rows = useMemo(() => {
    const byId = new Map<string, SelectRow>()
    const includedBySession = new Map<string, number>()
    for (const id of content?.included ?? []) {
      const sid = catalog.assets[id]?.sessionId
      if (sid) includedBySession.set(sid, (includedBySession.get(sid) ?? 0) + 1)
    }
    const flagged = new Set(refresh.noLongerMatching)
    for (const c of runCandidates(catalog, run)) {
      byId.set(c.session.id, { session: c.session, member: false, reason: null, candidateReason: c.reason, noLongerMatching: false, included: 0, frames: liveAssetIds(catalog, c.session).length })
    }
    for (const member of content?.sessions ?? []) {
      const session = catalog.sessions[member.sessionId]
      if (!session) continue
      const existing = byId.get(session.id)
      byId.set(session.id, {
        session,
        member: true,
        reason: member.reason,
        candidateReason: existing?.candidateReason ?? null,
        noLongerMatching: flagged.has(session.id),
        included: includedBySession.get(session.id) ?? 0,
        frames: liveAssetIds(catalog, session).length,
      })
    }
    return [...byId.values()].sort((a, b) => a.session.night.localeCompare(b.session.night) || (a.session.channel ?? "").localeCompare(b.session.channel ?? ""))
  }, [catalog, run, content, refresh.noLongerMatching])
  // A session without a filter is listed under one "no filter" channel; the key is not a channel name.
  const channelKey = (s: Session) => s.channel ?? NO_CHANNEL
  const channelName = (s: Session) => s.channel ?? m.palette_session_no_filter()
  const channels = [...new Map(rows.map((r) => [channelKey(r.session), channelName(r.session)]))]
  const shown = rows.filter((r) => (!filter.channel || channelKey(r.session) === filter.channel) && (!filter.selectedOnly || r.member))
  const selected = rows.filter((r) => r.member).map((r) => r.session.id)
  const setFilter = (patch: Partial<typeof filter>) => updateSlice("c", (c) => ({ ...c, selectFilter: { ...c.selectFilter, [run.id]: { ...filter, ...patch } } }))
  const reasonFor = (row: SelectRow): SelectionReason =>
    run.panelId ? { kind: "panel-pointing", detail: row.candidateReason ?? m.run_select_pointing_inside_panel() } : { kind: "candidate", detail: row.candidateReason ?? m.status_candidate() }
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
  const sessionEntries = (r: SelectRow): MenuEntry[] => [
    { heading: rowLabel(r) },
    ...(lock
      ? []
      : r.member
        ? [{ label: m.run_select_remove_from_run(), icon: ListX, onSelect: () => outcome.act(removeRunSessions(run.id, [r.session.id]), selectionBlocked) }]
        : [{ label: m.run_select_add_to_run(), icon: ListChecks, onSelect: () => outcome.act(addRunSessions(run.id, [r.session.id], reasonFor(r)), selectionBlocked) }]),
    { separator: true },
    { label: m.project_open_session(), icon: Eye, onSelect: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id } }) },
  ]

  const columns: Column<SelectRow>[] = [
    { id: "night", header: m.run_col_night(), rowHeader: true, cell: (r) => formatNight(r.session.night, true), sortValue: (r) => r.session.night },
    { id: "channel", header: m.run_col_channel(), cell: (r) => channelName(r.session), sortValue: (r) => r.session.channel ?? "" },
    { id: "frames", header: m.run_col_frames(), align: "right", cell: (r) => (r.member ? m.run_select_frames_of({ included: r.included, total: r.frames }) : `${r.frames}`), sortValue: (r) => r.frames },
    { id: "integration", header: m.run_col_integration(), align: "right", cell: (r) => formatDuration((r.member ? r.included : r.frames) * sessionExposureS(r.session)), sortValue: (r) => r.frames * sessionExposureS(r.session) },
    {
      id: "reason",
      header: m.run_col_reason(),
      cell: (r) =>
        r.reason ? (
          <span>
            <span className="text-foreground">{REASON_LABEL[r.reason.kind]}</span> <span className="text-muted-foreground">· {r.reason.detail}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{m.run_select_not_selected({ reason: r.candidateReason ?? "" })}</span>
        ),
    },
    {
      id: "state",
      header: m.run_col_state(),
      cell: (r) =>
        r.noLongerMatching ? (
          <span className="flex flex-wrap items-center gap-1">
            <Pill tone="warning">{m.run_select_no_longer_matches()}</Pill>
            {!lock ? (
              <Button size="xs" variant="outline" onClick={() => outcome.act(removeRunSessions(run.id, [r.session.id]), selectionBlocked)} aria-label={m.run_select_remove_session({ session: rowLabel(r) })}>
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
        <DataTable
          label={m.run_select_sessions_label({ name: run.name })}
          rows={shown}
          columns={columns}
          getRowId={(r) => r.session.id}
          scroll="none"
          selection={{ selected, onChange: onSelection, rowLabel, isSelectable: () => !lock }}
          contextMenu={sessionEntries}
          empty={<p className="px-3 py-4 text-sm text-muted-foreground">{m.run_select_no_candidates({ rig: rigName(catalog, run.rigId) })}</p>}
        />
      </Box>

      <ProductInputs run={run} lock={lock} onOutcome={outcome.act} />

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-between gap-3 border-t border-separator bg-background px-5 py-2" data-chrome>
        <p className="min-w-0 text-[0.75rem] text-muted-foreground">
          {run.draft ? (
            <>
              <span className="font-medium text-warning">{m.status_unsaved_changes()}</span> · {diff.join("; ")}
            </>
          ) : latest ? (
            <>
              {m.run_select_revision({ revision: latest.revision })} · {formatDateTime(latest.savedAt)} · {latest.accepted.join("; ")}
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

interface ProductRow {
  record: ResultRecord
  origin: string
  rigId: string | null
}

function productRow(state: PrototypeState, record: ResultRecord): ProductRow {
  const owner = record.runId ? state.catalog.runs[record.runId] : undefined
  const group = record.groupId ? state.catalog.runGroups[record.groupId] : undefined
  const projectId = owner?.projectId ?? group?.projectId
  const project = projectId ? state.catalog.projects[projectId] : undefined
  return { record, origin: `${owner?.name ?? group?.name ?? m.run_unknown_run()} · ${project?.name ?? m.run_unknown_project()}`, rigId: owner?.rigId ?? group?.rigId ?? null }
}

/** Accepted products of runs outside the Trash, any Project and any rig (RES-FR-05). */
export function pickableProducts(state: PrototypeState, run: Run): ProductRow[] {
  return Object.values(state.catalog.results)
    .filter((r) => r.acceptance === "accepted" && !r.intermediate && !r.trashed && r.runId !== run.id)
    .filter((r) => {
      const owner = r.runId ? state.catalog.runs[r.runId] : undefined
      return r.runId ? owner !== undefined && !owner.trashedAt : r.groupId !== null
    })
    .map((r) => productRow(state, r))
}

function ProductInputs({ run, lock, onOutcome }: { run: Run; lock: string | null; onOutcome: ReturnType<typeof useOutcome>["act"] }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const content = workingContent(run)
  const ids = content?.productInputs ?? []
  const rows = ids.map((id) => state.catalog.results[id]).filter((r): r is ResultRecord => r !== undefined).map((r) => productRow(state, r))
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const pickable = pickableProducts(state, run)
  const productsBlocked = { blocked: m.run_products_blocked() }
  const remove = (r: ProductRow) => onOutcome(setProductInputs(run.id, ids.filter((x) => x !== r.record.id)), productsBlocked)
  const entries = (r: ProductRow): MenuEntry[] => [
    { heading: fileName(r.record.path) },
    ...(lock ? [] : [{ label: m.run_remove(), icon: X, onSelect: () => remove(r) }]),
    { label: m.session_copy_path(), icon: Copy, onSelect: () => void navigator.clipboard?.writeText(r.record.path).catch(() => {}) },
  ]
  const columns: Column<ProductRow>[] = [
    { id: "file", header: m.run_col_product(), rowHeader: true, truncate: true, cell: (r) => <span title={r.record.path}>{fileName(r.record.path)}</span> },
    { id: "kind", header: m.run_col_kind(), cell: (r) => (r.record.kind ? RESULT_KIND_LABEL[r.record.kind] : m.run_unknown_kind()) },
    { id: "from", header: m.run_col_from(), cell: (r) => r.origin },
    {
      id: "rig",
      header: m.run_col_rig(),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {rigName(state.catalog, r.rigId)}
          {r.rigId && r.rigId !== run.rigId ? <Pill tone="info">{m.run_another_rig()}</Pill> : null}
        </span>
      ),
    },
    { id: "sha", header: m.run_col_accepted_bytes(), cell: (r) => <Sha value={r.record.sha256} /> },
    { id: "actions", header: "", cell: (r) => <RowActions entries={entries(r)} label={m.run_actions_for({ name: fileName(r.record.path) })} /> },
  ]
  return (
    <Box
      id="select-products"
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          {m.apps_product_inputs()} <CountBadge count={rows.length} label={m.run_product_inputs_count({ count: rows.length })} />
          <HelpTip label={m.apps_product_inputs()}>{m.run_product_inputs_help()}</HelpTip>
        </span>
      }
      actions={
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            if (lock) {
              onOutcome({ ok: false, reason: "refused", message: `${m.run_products_blocked()}: ${lock}`, reasons: [lock] }, productsBlocked)
              return
            }
            setPicked(ids)
            setOpen(true)
          }}
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          {m.run_products_add()}
        </Button>
      }
    >
      <DataTable label={m.apps_product_inputs()} rows={rows} columns={columns} getRowId={(r) => r.record.id} scroll="none" contextMenu={entries} empty={<p className="px-3 py-3 text-sm text-muted-foreground">{m.run_none()}</p>} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{m.run_products_add_title()}</DialogTitle>
          </DialogHeader>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {pickable.length === 0 ? <li className="text-sm text-muted-foreground">{m.run_products_none()}</li> : null}
            {pickable.map((p) => (
              <li key={p.record.id}>
                <label className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                  <Checkbox className="mt-0.5" checked={picked.includes(p.record.id)} onCheckedChange={(checked) => setPicked((cur) => (checked ? [...cur, p.record.id] : cur.filter((x) => x !== p.record.id)))} />
                  <span className="min-w-0">
                    <span className="block font-medium">{fileName(p.record.path)}</span>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {p.record.kind ? RESULT_KIND_LABEL[p.record.kind] : m.run_unknown_kind()} · {p.origin} · {rigName(state.catalog, p.rigId)}
                      {p.rigId !== run.rigId ? <Pill tone="info">{m.run_another_rig()}</Pill> : null}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{m.verb_cancel()}</DialogClose>
            <Button
              onClick={() => {
                if (onOutcome(setProductInputs(run.id, picked), productsBlocked)) setOpen(false)
              }}
            >
              {m.run_products_use({ count: picked.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
