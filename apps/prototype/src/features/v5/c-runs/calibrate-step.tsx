/**
 * S5 Calibrate (masters only, P-CAL3): readiness per kind as pills, the
 * automatic policy (on by default, D-W55), masters found in Results (Add to
 * library confirms path and SHA-256 and re-verifies; a reversible Dismiss,
 * P-CAL2), and Matches: the requirement table with its criteria, the master
 * each requirement hands off with its SHA-256, ties and exceptions (D-W5,
 * CAL-FR-08). With the policy off, compatible masters are Suggested and wait
 * for Accept. A run keeps the masters it has: a better compatible master
 * shows "Better match available" with Use it, never a silent switch. A
 * requirement no master matches offers "Stack from <calibration session>",
 * which opens that session's calibration process in the Calibration library.
 */
import { useNavigate } from "@tanstack/react-router"
import { ChevronDown, CircleSlash, Layers, ListRestart, PauseCircle, RotateCcw, Sparkles, X } from "lucide-react"
import { useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Box } from "@/components/app/box"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { type Column, DataTable } from "@/components/app/data-table"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { RowContextMenu } from "@/components/app/row-menu"
import { Refusal } from "@/components/app/refusal"
import { StatusBadge } from "@/components/app/status"
import { NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { basisFiles, type CalSource, type Candidate, calibrationPlan, CRITERION_NAME, KIND_NAME, type RequirementRow, summaryRef } from "@/domain/calibration"
import { runSetup, workingContent } from "@/domain/derive"
import type { CalibrationKind, MatchCriterion, Run } from "@/domain/types"
import { fileName, formatNight } from "@/lib/format"
import { type Messages, m, type MessageRef, say } from "@/lib/i18n"
import { type CommitResult, useStore } from "@/store/core"
import { acceptCalibration, adoptionPreview, adoptMasterOffer, calibrationException, clearCalibration, deferCalibration, dismissMasterOffer, setCalibrationPolicy, simulateBetterMaster } from "./actions"
import { groupSetupParts, type RunContext, readinessByKind, runLock, type StackOffer, stackOffers, tieOf } from "./model"
import { OutcomeNotice, PrototypeMenu, RowActions, Sha, useOutcome } from "./parts"

type Act = ReturnType<typeof useOutcome>["act"]
type ExceptionRequest = { row: RequirementRow; source: CalSource | null; criteria: MatchCriterion[] }

/** The calibration process of a raw session in the Calibration library (E2's deep link). */
export function processLink(processId: string) {
  return { to: "/calibration", search: { process: processId } }
}

const DISMISSED_LINK = { to: "/calibration", search: { filter: "dismissed" } }

/** A calibration kind as a lower-case noun inside a phrase: "Process without dark…". */
function kindNoun(m: Messages, kind: CalibrationKind): string {
  if (kind === "dark") return m.run_cal_kind_dark()
  if (kind === "flat") return m.run_cal_kind_flat()
  if (kind === "bias") return m.run_cal_kind_bias()
  return m.calibration_kind_dark_flat()
}

export function CalibrateStep({ ctx }: { ctx: RunContext }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { run, group } = ctx
  const outcome = useOutcome()
  const setup = runSetup(state.catalog, run)
  const plan = calibrationPlan(state.catalog, state.disk, run, setup.calibrationPolicy, workingContent(run))
  const [open, setOpen] = useState<boolean | null>(null)
  const better = plan.rows.filter((r) => r.better !== null).length
  const expanded = open ?? (plan.needsReview.length > 0 || plan.counts.suggested > 0 || better > 0)
  const lock = runLock(run)
  const switchId = useId()
  const [exception, setException] = useState<ExceptionRequest | null>(null)
  const kinds = readinessByKind(plan).filter((k) => k.total > 0)
  const groupSetup = groupSetupParts(m, plan.groups)

  return (
    <div className="space-y-4">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      <Box
        id="cal-readiness"
        level={2}
        title={m.run_cal_readiness()}
        actions={
          <span className="flex items-center gap-2">
            <Switch id={switchId} disabled={lock !== null} checked={setup.calibrationPolicy === "automatic"} onCheckedChange={(checked) => outcome.act(setCalibrationPolicy(run.id, checked ? "automatic" : "off"), { blocked: m.run_cal_policy_blocked() })} />
            <Label htmlFor={switchId} className="text-xs">
              {m.run_cal_auto_assign()}
            </Label>
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5" data-readiness>
          {plan.policy === "off" ? (
            <Pill tone="muted" icon={CircleSlash}>
              {m.run_cal_off()}
            </Pill>
          ) : kinds.length === 0 ? (
            <Pill tone="muted">{m.run_cal_no_sessions()}</Pill>
          ) : (
            kinds.map((k) => (
              <Pill key={k.kind} tone={k.matched === k.total ? "success" : "warning"}>
                {say(m, KIND_NAME[k.kind])} {k.automatic ? "✓" : `${k.matched}/${k.total}`}
              </Pill>
            ))
          )}
          {plan.policy === "off" && plan.counts.suggested > 0 ? <Pill tone="info">{m.run_cal_suggested_count({ count: plan.counts.suggested })}</Pill> : null}
          {better > 0 ? <Pill tone="info">{m.run_cal_better_count({ count: better })}</Pill> : null}
          {plan.needsReview.length > 0 ? <Pill tone="warning">{run.completion === "complete" ? m.domain_status_unresolved({ count: plan.needsReview.length }) : m.run_cal_to_review({ count: plan.needsReview.length })}</Pill> : null}
          {group ? (
            <Pill tone="info" icon={Layers} link={{ to: "/projects/$projectId/groups/$groupId/$step", params: { projectId: group.projectId, groupId: group.id, step: "calibrate" } }} title={m.run_cal_policy_shared()}>
              {group.name}
            </Pill>
          ) : null}
          {lock ? <Pill tone="muted">{say(m, lock)}</Pill> : null}
        </div>
      </Box>

      <MasterOffers run={run} onOutcome={outcome.act} />

      <Box
          id="cal-matches"
          level={2}
          flush
          title={
            <span className="flex min-w-0 items-center gap-1.5">
              {m.run_cal_matches()} <CountBadge count={plan.rows.length} label={m.run_cal_requirements({ count: plan.rows.length })} />
              {groupSetup.shared.length > 0 ? (
                <span className="min-w-0 truncate font-normal" title={groupSetup.shared.join(" · ")}>
                  {groupSetup.shared.join(" · ")}
                </span>
              ) : null}
            </span>
          }
          actions={
            <>
              {lock ? null : (
                <PrototypeMenu
                  actions={[{ label: m.run_proto_better_master(), detail: m.run_proto_better_master_detail(), run: () => outcome.act(simulateBetterMaster(run.id), { blocked: m.run_proto_blocked() }) }]}
                />
              )}
              {plan.rows.length > 0 ? (
                <Button size="xs" variant="ghost" aria-expanded={expanded} aria-controls="cal-matches-table" onClick={() => setOpen(!expanded)}>
                  <ChevronDown aria-hidden="true" data-icon="inline-start" className={expanded ? "rotate-180" : undefined} />
                  {expanded ? m.run_hide() : m.run_show()}
                </Button>
              ) : null}
            </>
          }
        >
          {plan.rows.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{m.run_cal_no_sessions_saved()}</p>
          ) : expanded ? (
            <div id="cal-matches-table">
              <RequirementTable run={run} rows={plan.rows} groupHeading={(key) => groupSetup.own(key).join(" · ")} lock={lock} onOutcome={outcome.act} onException={setException} />
            </div>
          ) : null}
      </Box>

      <ExceptionDialog
        value={exception}
        onClose={() => setException(null)}
        onConfirm={(reason) => {
          if (!exception) return false
          return outcome.act(calibrationException(run.id, exception.row.member.session.id, exception.row.kind, exception.source, exception.criteria, reason), { blocked: m.run_cal_exception_blocked() })
        }}
      />
    </div>
  )
}

function stateBadge(row: RequirementRow) {
  if (row.drift) return <StatusBadge kind="content" value="drifted" label={m.status_drifted()} />
  if (row.state === "automatic") return <StatusBadge kind="assignment" value="accepted" label={m.run_cal_automatic()} />
  return <StatusBadge kind="assignment" value={row.state} />
}

/** No silent re-rank: a compatible master the matching rule ranks above the assigned one (closer night or more frames), with Use it. */
function BetterMatch({ row, better, locked, onUse }: { row: RequirementRow; better: Candidate; locked: boolean; onUse: (c: Candidate) => void }) {
  const m = useMessages()
  const facts = [better.source.name, better.source.night ? formatNight(better.source.night) : null, better.source.frameCount !== null ? m.run_frames_count({ count: better.source.frameCount }) : null].filter((x) => x !== null).join(" · ")
  return (
    <span className="flex flex-wrap items-center gap-1" data-better-match={row.key}>
      <Pill tone="info" icon={Sparkles} title={facts}>
        {m.run_cal_better_match()}
      </Pill>
      {locked ? null : (
        <Button size="xs" variant="outline" aria-label={m.run_use_named({ name: better.source.name })} title={facts} onClick={() => onUse(better)}>
          {m.run_cal_use_it()}
        </Button>
      )}
    </span>
  )
}

/** The note behind a row's state: drift, an exception's reason, or a tie. */
function stateNote(row: RequirementRow): string | null {
  if (row.drift) return row.drift
  if (row.assignment?.exception) return m.run_cal_exception_note({ reason: row.assignment.exception.reason })
  const tie = tieOf(row)
  if (tie.length > 1 && row.state === "automatic") return m.run_cal_tie({ count: tie.length })
  return null
}

function StackPill({ offer }: { offer: StackOffer }) {
  const m = useMessages()
  const name = say(m, offer.view.name)
  return (
    <Pill tone={offer.waiting ? "info" : "muted"} icon={Sparkles} link={processLink(offer.view.process.id)} title={`${name} · ${m.run_frames_count({ count: offer.view.frames })}`}>
      {offer.waiting ? m.run_cal_stack_from({ name }) : m.run_cal_stacking({ name })}
    </Pill>
  )
}

function RequirementTable({
  run,
  rows,
  groupHeading,
  lock,
  onOutcome,
  onException,
}: {
  run: Run
  rows: RequirementRow[]
  /** A group's own setup parts; the parts every group shares are in the box title. */
  groupHeading: (groupKey: string) => string
  lock: MessageRef | null
  onOutcome: Act
  onException: (v: ExceptionRequest) => void
}) {
  const m = useMessages()
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const shaOf = (row: RequirementRow): string | null => {
    if (row.assignment?.basis?.files[0]) return row.assignment.basis.files[0].sha256
    return row.input ? (basisFiles(state.catalog, state.disk, row.input)[0]?.sha256 ?? null) : null
  }
  const rowName = (r: RequirementRow) => `${say(m, KIND_NAME[r.kind])} · ${formatNight(r.member.session.night)} ${r.member.session.channel ?? m.palette_session_no_filter()}`
  const assignBlocked = { blocked: m.run_cal_assign_blocked() }
  const entries = (r: RequirementRow): MenuEntry[] => {
    const offers = stackOffers(state, r)
    const kind = kindNoun(m, r.kind)
    const seen = new Set<string>()
    const unique = (label: string, detail: string | null) => {
      let out = seen.has(label) && detail ? `${label} · ${detail}` : label
      for (let n = 2; seen.has(out); n += 1) out = `${label} (${n})`
      seen.add(out)
      return out
    }
    const masters: MenuEntry[] = r.candidates.slice(0, 6).map((c) => ({
      label: unique(c.summary.allCompatible ? m.run_use_named({ name: c.source.name }) : m.run_cal_use_as_exception({ name: c.source.name }), c.source.cameraName),
      icon: c.summary.allCompatible ? undefined : CircleSlash,
      onSelect: () => (c.summary.allCompatible ? onOutcome(acceptCalibration(run.id, r.member.session.id, r.kind, c.source, c.criteria), assignBlocked) : onException({ row: r, source: c.source, criteria: c.criteria })),
    }))
    const stack: MenuEntry[] = offers.map((o) => ({ label: o.waiting ? m.run_cal_stack_from({ name: say(m, o.view.name) }) : m.activity_open_destination({ name: say(m, o.view.name) }), icon: Sparkles, onSelect: () => void navigate(processLink(o.view.process.id) as never) }))
    const decisions: MenuEntry[] = lock
      ? []
      : [
          { separator: true },
          { label: m.run_cal_process_without({ kind }), icon: CircleSlash, onSelect: () => onException({ row: r, source: null, criteria: [] }) },
          { label: m.run_cal_defer(), icon: PauseCircle, onSelect: () => onOutcome(deferCalibration(run.id, r.member.session.id, r.kind), assignBlocked) },
          ...(r.assignment ? [{ label: m.run_cal_use_automatic(), icon: RotateCcw, onSelect: () => onOutcome(clearCalibration(run.id, r.member.session.id, r.kind), assignBlocked) }] : []),
        ]
    return [{ heading: rowName(r) }, ...(lock ? [] : masters), ...(lock || masters.length === 0 ? [] : stack.length > 0 ? [{ separator: true } as const] : []), ...stack, ...decisions, ...(r.candidates.length === 0 && stack.length === 0 ? [{ label: m.run_cal_no_master(), disabled: true, onSelect: () => {} }] : [])]
  }
  const columns: Column<RequirementRow>[] = [
    {
      id: "session",
      header: m.run_cal_col_light_session(),
      rowHeader: true,
      cell: (r) => (
        <span className="flex flex-col">
          <span>
            {formatNight(r.member.session.night)} · {r.member.session.channel ?? m.palette_session_no_filter()} · {say(m, KIND_NAME[r.kind])}
          </span>
          <span className="text-[0.6875rem] text-muted-foreground">{m.run_frames_count({ count: r.member.included.length })}</span>
        </span>
      ),
      sortValue: (r) => r.member.session.night,
    },
    {
      id: "state",
      header: m.run_col_state(),
      cell: (r) => {
        const note = stateNote(r)
        return (
          <span className="flex items-center gap-1">
            {stateBadge(r)}
            {note ? <NoteMarker label={m.run_note_for({ name: rowName(r) })}>{note}</NoteMarker> : null}
          </span>
        )
      },
    },
    {
      id: "input",
      header: m.run_cal_col_master(),
      cell: (r) => {
        const offers = r.source ? [] : stackOffers(state, r)
        const accept = r.state === "suggested" && !lock ? r.candidates.find((c) => c.source.input.masterId === r.input?.masterId) : undefined
        const use = (c: Candidate) => onOutcome(acceptCalibration(run.id, r.member.session.id, r.kind, c.source, c.criteria), assignBlocked)
        return (
          <span className="flex max-w-[18rem] flex-col items-start gap-0.5">
            {r.source ? (
              <span className="max-w-full truncate" title={r.source.path}>
                {r.source.name}
              </span>
            ) : r.state === "exception" ? (
              <span className="text-muted-foreground">{m.run_cal_without({ kind: kindNoun(m, r.kind) })}</span>
            ) : offers[0] ? (
              <StackPill offer={offers[0]} />
            ) : r.closest ? (
              <span className="max-w-full truncate text-muted-foreground" title={say(m, summaryRef(r.closest.criteria))}>
                {m.run_cal_closest({ name: r.closest.source.name })}
              </span>
            ) : (
              <span className="text-muted-foreground">{m.run_cal_no_master()}</span>
            )}
            {r.input ? <Sha value={shaOf(r)} /> : null}
            {accept ? (
              <Button size="xs" variant="outline" aria-label={m.run_results_accept_named({ name: accept.source.name })} onClick={() => use(accept)}>
                {m.run_accept()}
              </Button>
            ) : null}
            {r.better ? <BetterMatch row={r} better={r.better} locked={lock !== null} onUse={use} /> : null}
          </span>
        )
      },
    },
    {
      id: "criteria",
      header: m.run_cal_col_criteria(),
      cell: (r) =>
        r.criteria.length === 0 ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          <details className="group">
            <summary className="cursor-default text-[0.75rem] marker:text-muted-foreground">{say(m, summaryRef(r.criteria))}</summary>
            <ul className="mt-1 space-y-0.5 text-[0.75rem]">
              {r.criteria.map((c) => (
                <li key={c.name} className="flex flex-wrap gap-x-2">
                  <span className="w-24 text-muted-foreground">{say(m, CRITERION_NAME[c.name])}</span>
                  <span>{say(m, c.lightValue)}</span>
                  <span className="text-muted-foreground">{m.run_cal_vs({ value: say(m, c.calibrationValue) })}</span>
                  <StatusBadge kind="match" value={c.result} />
                </li>
              ))}
            </ul>
          </details>
        ),
    },
    { id: "actions", header: "", cell: (r) => <RowActions entries={entries(r)} label={m.run_cal_choose_for({ name: rowName(r) })} /> },
  ]
  return (
    <DataTable
      label={m.run_cal_requirements_label()}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.key}
      scroll="none"
      groups={{ key: (r) => r.groupKey, label: (key, groupRows) => `${groupHeading(key)} · ${m.run_cal_requirements({ count: groupRows.length })}` }}
      rowClassName={(r) => (r.drift || r.state === "unresolved" || r.state === "deferred" ? "bg-warning/[0.05]" : undefined)}
      contextMenu={entries}
    />
  )
}

function ExceptionDialog({ value, onClose, onConfirm }: { value: ExceptionRequest | null; onClose: () => void; onConfirm: (reason: string) => boolean }) {
  const m = useMessages()
  const [reason, setReason] = useState("")
  const id = useId()
  if (!value) return null
  const kind = kindNoun(m, value.row.kind)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (onConfirm(reason)) {
              setReason("")
              onClose()
            }
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{value.source ? m.run_cal_exception_title({ name: value.source.name }) : m.run_cal_without({ kind })}</DialogTitle>
            <DialogDescription>{value.source ? say(m, summaryRef(value.criteria)) : `${formatNight(value.row.member.session.night)} ${value.row.member.session.channel ?? ""} · ${m.run_cal_this_run_only()}`}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={id}>{m.run_col_reason()}</Label>
            <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={m.run_cal_reason_placeholder()} autoFocus />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{m.verb_cancel()}</DialogClose>
            <Button type="submit" disabled={reason.trim() === ""}>
              {m.run_cal_record_exception()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Masters found in this run's Results: Add to library confirms the
 * destination path and SHA-256 first, then files a copy into structured
 * calibration storage after re-verifying the bytes (round 6); a master that
 * changed meanwhile is refused "Can't add · master changed". Dismiss is
 * reversible from the Calibration library's Dismissed filter (P-CAL2).
 * Candidates never match until they are added.
 */
export function MasterOffers({ run, onOutcome }: { run: Run; onOutcome: Act }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const [adopting, setAdopting] = useState<{ masterId: string; name: string; destinationPath: string; sha256: string } | null>(null)
  const [refusal, setRefusal] = useState<string[] | null>(null)
  const pending = run.masterOffers.filter((o) => o.state === "pending").map((o) => state.catalog.masters[o.masterId]).filter((x) => x !== undefined)
  const dismissed = run.masterOffers.filter((o) => o.state === "dismissed").length
  if (pending.length === 0 && dismissed === 0) return null
  const refused = (result: CommitResult) => {
    if (result.ok) return setRefusal(null)
    setRefusal(result.reason === "refused" ? result.reasons : [result.message])
  }
  const add = (masterId: string, name: string) => {
    const preview = adoptionPreview(state, masterId)
    if (!preview.ok) return setRefusal(preview.reasons.map((r) => say(m, r)))
    setRefusal(null)
    setAdopting({ masterId, name, destinationPath: preview.destinationPath, sha256: preview.sha256 })
  }
  const dismiss = (masterId: string, name: string) => onOutcome(dismissMasterOffer(run.id, masterId), { blocked: m.run_cal_dismiss_blocked(), success: { title: m.run_cal_master_dismissed({ name }), tone: "info" } })
  return (
    <Box
      id={`offers-${run.id}`}
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          {m.run_cal_masters_found()} <CountBadge count={pending.length} label={m.run_cal_masters_count({ count: pending.length })} />
        </span>
      }
      actions={
        dismissed > 0 ? (
          <Pill tone="muted" icon={ListRestart} link={DISMISSED_LINK} title={m.run_cal_restore_in_library()}>
            {m.run_cal_dismissed_count({ count: dismissed })}
          </Pill>
        ) : null
      }
    >
      {refusal ? (
        <div className="flex items-start gap-1.5 border-b border-separator px-3 py-2" data-adopt-refusal>
          <Refusal className="min-w-0 flex-1" action={m.session_cant_add()} reason={refusal[0] ?? m.run_try_again()} blockers={refusal.slice(1).map((label) => ({ label }))} />
          <Button size="icon-xs" variant="ghost" onClick={() => setRefusal(null)} aria-label={m.run_dismiss()} title={m.run_dismiss()}>
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {pending.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{m.run_cal_none_pending()}</p>
      ) : (
        <ul className="divide-y divide-separator" data-master-offers>
          {pending.map((master) => {
            const name = fileName(master.origin.sourcePath)
            return (
              <RowContextMenu
                key={master.id}
                entries={[
                  { heading: name },
                  { label: m.run_cal_add_to_library_ellipsis(), onSelect: () => add(master.id, name) },
                  { label: m.run_dismiss(), onSelect: () => dismiss(master.id, name) },
                ]}
              >
                <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium" title={master.origin.sourcePath}>
                    {name}
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <Pill tone="info">{say(m, KIND_NAME[master.kind])}</Pill>
                    {master.channel ? <Pill tone="neutral">{master.channel}</Pill> : null}
                    {master.widthPx > 0 ? (
                      <Pill tone="muted">
                        {master.widthPx} × {master.heightPx}
                      </Pill>
                    ) : null}
                    <Pill tone="muted">{m.run_cal_bin({ binning: master.binning })}</Pill>
                  </span>
                  <span className="flex gap-1.5">
                    <Button size="xs" onClick={() => add(master.id, name)}>
                      {m.run_cal_add_to_library_ellipsis()}
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => dismiss(master.id, name)}>
                      {m.run_dismiss()}
                    </Button>
                  </span>
                </li>
              </RowContextMenu>
            )
          })}
        </ul>
      )}
      <ConfirmDialog
        open={adopting !== null}
        onOpenChange={(open) => !open && setAdopting(null)}
        title={m.run_cal_add_title({ name: adopting?.name ?? "" })}
        description={
          <span className="grid gap-1 text-foreground" data-adopt-confirm>
            <span className="text-xs text-muted-foreground">{m.run_cal_add_destination()}</span>
            <span className="font-mono text-xs [overflow-wrap:anywhere]" data-adopt-path>
              {adopting?.destinationPath}
            </span>
            <span className="text-xs text-muted-foreground">{m.run_sha256()}</span>
            <span className="font-mono text-xs [overflow-wrap:anywhere]" data-adopt-sha>
              {adopting?.sha256}
            </span>
          </span>
        }
        changes={[m.run_cal_add_copies({ name: adopting?.name ?? "" }), m.run_cal_add_reverifies()]}
        unchanged={[m.run_cal_add_source_stays()]}
        confirmLabel={m.run_cal_add_to_library()}
        onConfirm={() => {
          if (!adopting) return
          const result = adoptMasterOffer(run.id, adopting.masterId, adopting.sha256)
          refused(result)
          if (result.ok) onOutcome(result, { success: { title: m.run_cal_master_added({ name: adopting.name }), tone: "info" } })
        }}
      />
    </Box>
  )
}
