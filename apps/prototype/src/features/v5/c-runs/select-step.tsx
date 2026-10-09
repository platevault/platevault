/**
 * S5 Select: the subject's candidates on the run's rig, all preselected with
 * their reason (D-W49); Refresh offers new candidates and flags a member that
 * no longer matches its subject, with Remove (D-W45); accepted Results of
 * other runs as product inputs, shown with their rig (D-W4, D-W56); Save
 * makes the next membership revision.
 */
import { useMemo, useState } from "react"
import { Notice } from "@/components/app/feedback"
import { type Column, DataTable } from "@/components/app/data-table"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { latestRevision, liveAssetIds, rigName, runCandidates, runRefresh, subjectName, workingContent } from "@/domain/derive"
import { RESULT_KIND_LABEL } from "@/domain/labels"
import { describeDiff, diffContent, REASON_LABEL, sessionExposureS } from "@/domain/membership"
import type { ResultRecord, Run, SelectionReason, Session } from "@/domain/types"
import { fileName, formatDateTime, formatDuration, formatNight, plural } from "@/lib/format"
import { addRunSessions, discardRunDraft, removeRunSessions, saveRun, setProductInputs } from "@/store/actions/runs"
import { type PrototypeState, updateSlice, useStore } from "@/store/core"
import { type RunContext, runLock } from "./model"
import { OutcomeNotice, Sha, useOutcome } from "./parts"

interface SelectRow {
  session: Session
  member: boolean
  reason: SelectionReason | null
  candidateReason: string | null
  noLongerMatching: boolean
  included: number
  frames: number
}

export function SelectStep({ ctx }: { ctx: RunContext }) {
  const state = useStore((s) => s)
  const { catalog } = state
  const { run, subject } = ctx
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
    for (const m of content?.sessions ?? []) {
      const session = catalog.sessions[m.sessionId]
      if (!session) continue
      const existing = byId.get(session.id)
      byId.set(session.id, {
        session,
        member: true,
        reason: m.reason,
        candidateReason: existing?.candidateReason ?? null,
        noLongerMatching: flagged.has(session.id),
        included: includedBySession.get(session.id) ?? 0,
        frames: liveAssetIds(catalog, session).length,
      })
    }
    return [...byId.values()].sort((a, b) => a.session.night.localeCompare(b.session.night) || (a.session.channel ?? "").localeCompare(b.session.channel ?? ""))
  }, [catalog, run, content, refresh.noLongerMatching])
  const channels = [...new Set(rows.map((r) => r.session.channel ?? "No filter"))]
  const shown = rows.filter((r) => (!filter.channel || (r.session.channel ?? "No filter") === filter.channel) && (!filter.selectedOnly || r.member))
  const selected = rows.filter((r) => r.member).map((r) => r.session.id)
  const setFilter = (patch: Partial<typeof filter>) => updateSlice("c", (c) => ({ ...c, selectFilter: { ...c.selectFilter, [run.id]: { ...filter, ...patch } } }))
  const reasonFor = (row: SelectRow): SelectionReason =>
    run.panelId ? { kind: "panel-pointing", detail: row.candidateReason ?? "Pointing inside the panel" } : { kind: "candidate", detail: row.candidateReason ?? "Candidate" }

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
      for (const [reason, ids2] of byReason) if (!outcome.act(addRunSessions(run.id, ids2, JSON.parse(reason) as SelectionReason))) return
    }
    if (removed.length > 0) outcome.act(removeRunSessions(run.id, removed))
  }

  const columns: Column<SelectRow>[] = [
    { id: "night", header: "Night", rowHeader: true, cell: (r) => formatNight(r.session.night, true), sortValue: (r) => r.session.night },
    { id: "channel", header: "Channel", cell: (r) => r.session.channel ?? "No filter", sortValue: (r) => r.session.channel ?? "" },
    { id: "frames", header: "Frames", align: "right", cell: (r) => (r.member ? `${r.included} of ${r.frames}` : `${r.frames}`), sortValue: (r) => r.frames },
    { id: "integration", header: "Integration", align: "right", cell: (r) => formatDuration((r.member ? r.included : r.frames) * sessionExposureS(r.session)), sortValue: (r) => r.frames * sessionExposureS(r.session) },
    {
      id: "reason",
      header: "Reason",
      cell: (r) =>
        r.reason ? (
          <span>
            <span className="text-foreground">{REASON_LABEL[r.reason.kind]}</span> <span className="text-muted-foreground">· {r.reason.detail}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Not selected · {r.candidateReason}</span>
        ),
    },
    {
      id: "state",
      header: "State",
      cell: (r) =>
        r.noLongerMatching ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[0.75rem] font-medium text-warning">No longer matches subject</span>
            {!lock ? (
              <Button size="xs" variant="outline" onClick={() => outcome.act(removeRunSessions(run.id, [r.session.id]))} aria-label={`Remove ${formatNight(r.session.night)} ${r.session.channel ?? ""} from the run`}>
                Remove
              </Button>
            ) : null}
          </span>
        ) : r.member ? (
          <span className="text-[0.75rem]">In the run</span>
        ) : (
          <span className="text-[0.75rem] text-muted-foreground">Candidate</span>
        ),
    },
  ]

  const latest = latestRevision(run)
  const diff = run.draft ? describeDiff(catalog, diffContent(latest, run.draft)) : []
  return (
    <div className="space-y-5">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      {refresh.newCandidates.length > 0 ? (
        <Notice
          tone="info"
          title={`${plural(refresh.newCandidates.length, "new candidate")} for ${subject ? subjectName(catalog, subject) : "this subject"} on ${rigName(catalog, run.rigId)}`}
          actions={
            lock ? null : (
              <Button size="sm" onClick={() => outcome.act(addRunSessions(run.id, refresh.newCandidates.map((c) => c.session.id), { kind: "refresh-added", detail: refresh.newCandidates[0]!.reason }))}>
                Add {plural(refresh.newCandidates.length, "new session")}
              </Button>
            )
          }
        >
          {refresh.newCandidates.map((c) => `${formatNight(c.session.night)} ${c.session.channel ?? "No filter"}`).join(", ")}
          {lock ? ` · ${lock}` : ""}
        </Notice>
      ) : null}
      {refresh.noLongerMatching.length > 0 ? (
        <Notice tone="warning" title={`${plural(refresh.noLongerMatching.length, "member")} no longer match${refresh.noLongerMatching.length === 1 ? "es" : ""} the subject`}>
          Its Target or rig changed since it was selected. It stays in the run and still counts in project until you remove it.
        </Notice>
      ) : null}

      <Section
        title="Sessions"
        id="select-sessions"
        description={`Candidates are this subject's sessions on ${rigName(catalog, run.rigId)}${run.panelId ? ", placed on this panel by pointing" : ""}. Every candidate starts selected.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              aria-label="Channel"
              size="sm"
              variant="outline"
              spacing={0}
              value={[filter.channel ?? "all"]}
              onValueChange={(value) => {
                const v = (value as string[])[0]
                setFilter({ channel: !v || v === "all" ? null : v })
              }}
            >
              <ToggleGroupItem value="all">
                All
              </ToggleGroupItem>
              {channels.map((c) => (
                <ToggleGroupItem key={c} value={c}>
                  {c}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <label className="flex items-center gap-1.5 text-[0.75rem]" data-chrome>
              <Checkbox checked={filter.selectedOnly} onCheckedChange={(checked) => setFilter({ selectedOnly: checked === true })} />
              Selected only
            </label>
          </div>
        }
      >
        <DataTable
          label={`Sessions for ${run.name}`}
          rows={shown}
          columns={columns}
          getRowId={(r) => r.session.id}
          scroll="none"
          selection={{ selected, onChange: onSelection, rowLabel: (r) => `${formatNight(r.session.night)} ${r.session.channel ?? "No filter"}`, isSelectable: () => !lock }}
          empty={<p className="px-3 py-6 text-sm text-muted-foreground">No candidate sessions on this rig yet. Import or confirm sessions with this Target and rig.</p>}
        />
      </Section>

      <ProductInputs run={run} lock={lock} onOutcome={outcome.act} />

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-between gap-3 border-t border-separator bg-background px-5 py-2" data-chrome>
        <p className="min-w-0 text-[0.75rem] text-muted-foreground">
          {run.draft ? (
            <>
              <span className="font-medium text-warning">Unsaved changes</span> · {diff.join("; ")}
            </>
          ) : latest ? (
            <>
              Revision {latest.revision} saved {formatDateTime(latest.savedAt)} · {latest.accepted.join("; ")}
            </>
          ) : (
            "Not saved yet"
          )}
        </p>
        <div className="flex gap-1.5">
          {run.draft ? (
            <Button size="sm" variant="outline" onClick={() => outcome.act(discardRunDraft(run.id))}>
              Discard changes
            </Button>
          ) : null}
          <Button id="save-run" size="sm" disabled={!run.draft} onClick={() => outcome.act(saveRun(run.id), { title: `Saved revision ${(latest?.revision ?? 0) + 1}`, reasons: ["Calibrate and Prepare use this revision."], tone: "info" })}>
            Save revision {(latest?.revision ?? 0) + 1}
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
  return { record, origin: `${owner?.name ?? group?.name ?? "Unknown run"} · ${project?.name ?? "Unknown Project"}`, rigId: owner?.rigId ?? group?.rigId ?? null }
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
  const state = useStore((s) => s)
  const content = workingContent(run)
  const ids = content?.productInputs ?? []
  const rows = ids.map((id) => state.catalog.results[id]).filter((r): r is ResultRecord => r !== undefined).map((r) => productRow(state, r))
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const pickable = pickableProducts(state, run)
  const columns: Column<ProductRow>[] = [
    { id: "file", header: "Product", rowHeader: true, truncate: true, cell: (r) => <span title={r.record.path}>{fileName(r.record.path)}</span> },
    { id: "kind", header: "Kind", cell: (r) => (r.record.kind ? RESULT_KIND_LABEL[r.record.kind] : "Unknown kind") },
    { id: "from", header: "From", cell: (r) => r.origin },
    {
      id: "rig",
      header: "Rig",
      cell: (r) => (
        <span>
          {rigName(state.catalog, r.rigId)}
          {r.rigId && r.rigId !== run.rigId ? <span className="text-muted-foreground"> · another rig</span> : null}
        </span>
      ),
    },
    { id: "sha", header: "Accepted bytes", cell: (r) => <Sha value={r.record.sha256} /> },
    {
      id: "remove",
      header: "",
      cell: (r) =>
        lock ? null : (
          <Button size="xs" variant="ghost" onClick={() => onOutcome(setProductInputs(run.id, ids.filter((x) => x !== r.record.id)))} aria-label={`Remove ${fileName(r.record.path)}`}>
            Remove
          </Button>
        ),
    },
  ]
  return (
    <Section
      title="Product inputs"
      id="select-products"
      description="Accepted Results of other runs, any Project and any rig. The one-rig rule applies to raw frames only."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (lock) {
              onOutcome({ ok: false, reason: "refused", message: `Add accepted results refused: ${lock}.`, reasons: [lock] })
              return
            }
            setPicked(ids)
            setOpen(true)
          }}
        >
          Add accepted results…
        </Button>
      }
    >
      <DataTable label="Product inputs" rows={rows} columns={columns} getRowId={(r) => r.record.id} scroll="none" empty={<p className="px-3 py-4 text-sm text-muted-foreground">No product inputs. Add an accepted Result to stack or combine it in this run.</p>} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add accepted results</DialogTitle>
            <DialogDescription>Accepted products from runs outside the Trash, in any Project. A product from another rig shows its rig.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {pickable.length === 0 ? <li className="text-sm text-muted-foreground">No accepted product is available yet.</li> : null}
            {pickable.map((p) => (
              <li key={p.record.id}>
                <label className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                  <Checkbox className="mt-0.5" checked={picked.includes(p.record.id)} onCheckedChange={(checked) => setPicked((cur) => (checked ? [...cur, p.record.id] : cur.filter((x) => x !== p.record.id)))} />
                  <span className="min-w-0">
                    <span className="block font-medium">{fileName(p.record.path)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.record.kind ? RESULT_KIND_LABEL[p.record.kind] : "Unknown kind"} · {p.origin} · {rigName(state.catalog, p.rigId)}
                      {p.rigId !== run.rigId ? " (another rig)" : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={() => {
                if (onOutcome(setProductInputs(run.id, picked))) setOpen(false)
              }}
            >
              Use {plural(picked.length, "product")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
