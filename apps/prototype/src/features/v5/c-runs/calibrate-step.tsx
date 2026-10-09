/**
 * S5 Calibrate (masters only, P-CAL3): readiness per kind as pills, the
 * automatic policy (on by default, D-W55), masters found in Results with a
 * reversible Dismiss (P-CAL2), and Matches: the requirement table with its
 * criteria, the master each requirement hands off with its SHA-256, ties and
 * exceptions (D-W5, CAL-FR-08). A requirement no master matches offers
 * "Stack from <calibration session>", which opens that session's
 * calibration process in the Calibration library.
 */
import { useNavigate } from "@tanstack/react-router"
import { ChevronDown, CircleSlash, Layers, ListRestart, PauseCircle, RotateCcw, Sparkles } from "lucide-react"
import { useId, useState } from "react"
import { Box } from "@/components/app/box"
import { type Column, DataTable } from "@/components/app/data-table"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { RowContextMenu } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { basisFiles, type CalSource, calibrationPlan, CRITERION_LABEL, KIND_LABEL, type RequirementRow, summaryText } from "@/domain/calibration"
import { runSetup, workingContent } from "@/domain/derive"
import type { MatchCriterion, Run } from "@/domain/types"
import { fileName, formatNight, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { acceptCalibration, answerMasterOffer, calibrationException, clearCalibration, deferCalibration, setCalibrationPolicy } from "./actions"
import { type RunContext, readinessByKind, runLock, type StackOffer, stackOffers, tieOf } from "./model"
import { OutcomeNotice, RowActions, Sha, useOutcome } from "./parts"

type Act = ReturnType<typeof useOutcome>["act"]
type ExceptionRequest = { row: RequirementRow; source: CalSource | null; criteria: MatchCriterion[] }

/** The calibration process of a raw session in the Calibration library (E2's deep link). */
export function processLink(processId: string) {
  return { to: "/calibration", search: { process: processId } }
}

const DISMISSED_LINK = { to: "/calibration", search: { filter: "dismissed" } }

export function CalibrateStep({ ctx }: { ctx: RunContext }) {
  const state = useStore((s) => s)
  const { run, group } = ctx
  const outcome = useOutcome()
  const setup = runSetup(state.catalog, run)
  const plan = calibrationPlan(state.catalog, state.disk, run, setup.calibrationPolicy, workingContent(run))
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? plan.needsReview.length > 0
  const lock = runLock(run)
  const switchId = useId()
  const [exception, setException] = useState<ExceptionRequest | null>(null)
  const kinds = readinessByKind(plan).filter((k) => k.total > 0)

  return (
    <div className="space-y-4">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      <Box
        id="cal-readiness"
        level={2}
        title="Readiness"
        actions={
          <span className="flex items-center gap-2">
            <Switch id={switchId} disabled={lock !== null} checked={setup.calibrationPolicy === "automatic"} onCheckedChange={(checked) => outcome.act(setCalibrationPolicy(run.id, checked ? "automatic" : "off"))} />
            <Label htmlFor={switchId} className="text-xs">
              Auto-assign
            </Label>
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5" data-readiness>
          {plan.policy === "off" ? (
            <Pill tone="muted" icon={CircleSlash}>
              Off
            </Pill>
          ) : kinds.length === 0 ? (
            <Pill tone="muted">No sessions</Pill>
          ) : (
            kinds.map((k) => (
              <Pill key={k.kind} tone={k.matched === k.total ? "success" : "warning"}>
                {KIND_LABEL[k.kind]} {k.automatic ? "✓" : `${k.matched}/${k.total}`}
              </Pill>
            ))
          )}
          {plan.needsReview.length > 0 ? <Pill tone="warning">{plural(plan.needsReview.length, "to review", "to review")}</Pill> : null}
          {group ? (
            <Pill tone="info" icon={Layers} link={{ to: "/projects/$projectId/groups/$groupId/$step", params: { projectId: group.projectId, groupId: group.id, step: "calibrate" } }} title="Policy shared by every panel">
              {group.name}
            </Pill>
          ) : null}
          {lock ? <Pill tone="muted">{lock}</Pill> : null}
        </div>
      </Box>

      <MasterOffers run={run} onOutcome={outcome.act} />

      {plan.policy === "automatic" ? (
        <Box
          id="cal-matches"
          level={2}
          flush
          title={
            <span className="flex items-center gap-1.5">
              Matches <CountBadge count={plan.rows.length} label={plural(plan.rows.length, "requirement")} />
            </span>
          }
          actions={
            plan.rows.length > 0 ? (
              <Button size="xs" variant="ghost" aria-expanded={expanded} aria-controls="cal-matches-table" onClick={() => setOpen(!expanded)}>
                <ChevronDown aria-hidden="true" data-icon="inline-start" className={expanded ? "rotate-180" : undefined} />
                {expanded ? "Hide" : "Show"}
              </Button>
            ) : null
          }
        >
          {plan.rows.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No sessions saved</p>
          ) : expanded ? (
            <div id="cal-matches-table">
              <RequirementTable run={run} rows={plan.rows} lock={lock} onOutcome={outcome.act} onException={setException} />
            </div>
          ) : null}
        </Box>
      ) : null}

      <ExceptionDialog
        value={exception}
        onClose={() => setException(null)}
        onConfirm={(reason) => {
          if (!exception) return false
          return outcome.act(calibrationException(run.id, exception.row.member.session.id, exception.row.kind, exception.source, exception.criteria, reason))
        }}
      />
    </div>
  )
}

function stateBadge(row: RequirementRow) {
  if (row.drift) return <StatusBadge kind="content" value="drifted" label="Drifted" />
  if (row.state === "automatic") return <StatusBadge kind="assignment" value="accepted" label="Automatic" />
  return <StatusBadge kind="assignment" value={row.state} />
}

/** The note behind a row's state: drift, an exception's reason, or a tie. */
function stateNote(row: RequirementRow): string | null {
  if (row.drift) return row.drift
  if (row.assignment?.exception) return `Exception · ${row.assignment.exception.reason}`
  const tie = tieOf(row)
  if (tie.length > 1 && row.state === "automatic") return `Tie · ${plural(tie.length, "equal master")} · nearest night wins`
  return null
}

function StackPill({ offer }: { offer: StackOffer }) {
  return (
    <Pill tone={offer.waiting ? "info" : "muted"} icon={Sparkles} link={processLink(offer.view.process.id)} title={`${offer.view.name} · ${plural(offer.view.frames, "frame")}`}>
      {offer.waiting ? `Stack from ${offer.view.name}` : `Stacking ${offer.view.name}`}
    </Pill>
  )
}

function RequirementTable({ run, rows, lock, onOutcome, onException }: { run: Run; rows: RequirementRow[]; lock: string | null; onOutcome: Act; onException: (v: ExceptionRequest) => void }) {
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const shaOf = (row: RequirementRow): string | null => {
    if (row.assignment?.basis?.files[0]) return row.assignment.basis.files[0].sha256
    return row.input ? (basisFiles(state.catalog, state.disk, row.input)[0]?.sha256 ?? null) : null
  }
  const rowName = (r: RequirementRow) => `${KIND_LABEL[r.kind]} · ${formatNight(r.member.session.night)} ${r.member.session.channel ?? "No filter"}`
  const entries = (r: RequirementRow): MenuEntry[] => {
    const offers = stackOffers(state, r)
    const kind = KIND_LABEL[r.kind].toLowerCase()
    const seen = new Set<string>()
    const unique = (label: string, detail: string | null) => {
      let out = seen.has(label) && detail ? `${label} · ${detail}` : label
      for (let n = 2; seen.has(out); n += 1) out = `${label} (${n})`
      seen.add(out)
      return out
    }
    const masters: MenuEntry[] = r.candidates.slice(0, 6).map((c) => ({
      label: unique(c.summary.allCompatible ? `Use ${c.source.name}` : `Use ${c.source.name} as exception…`, c.source.cameraName),
      icon: c.summary.allCompatible ? undefined : CircleSlash,
      onSelect: () => (c.summary.allCompatible ? onOutcome(acceptCalibration(run.id, r.member.session.id, r.kind, c.source, c.criteria)) : onException({ row: r, source: c.source, criteria: c.criteria })),
    }))
    const stack: MenuEntry[] = offers.map((o) => ({ label: o.waiting ? `Stack from ${o.view.name}` : `Open ${o.view.name}`, icon: Sparkles, onSelect: () => void navigate(processLink(o.view.process.id) as never) }))
    const decisions: MenuEntry[] = lock
      ? []
      : [
          { separator: true },
          { label: `Process without ${kind}…`, icon: CircleSlash, onSelect: () => onException({ row: r, source: null, criteria: [] }) },
          { label: "Defer", icon: PauseCircle, onSelect: () => onOutcome(deferCalibration(run.id, r.member.session.id, r.kind)) },
          ...(r.assignment ? [{ label: "Use automatic", icon: RotateCcw, onSelect: () => onOutcome(clearCalibration(run.id, r.member.session.id, r.kind)) }] : []),
        ]
    return [{ heading: rowName(r) }, ...(lock ? [] : masters), ...(lock || masters.length === 0 ? [] : stack.length > 0 ? [{ separator: true } as const] : []), ...stack, ...decisions, ...(r.candidates.length === 0 && stack.length === 0 ? [{ label: "No master", disabled: true, onSelect: () => {} }] : [])]
  }
  const columns: Column<RequirementRow>[] = [
    {
      id: "session",
      header: "Light session",
      rowHeader: true,
      cell: (r) => (
        <span className="flex flex-col">
          <span>
            {formatNight(r.member.session.night)} · {r.member.session.channel ?? "No filter"} · {KIND_LABEL[r.kind]}
          </span>
          <span className="text-[0.6875rem] text-muted-foreground">{plural(r.member.included.length, "frame")}</span>
        </span>
      ),
      sortValue: (r) => r.member.session.night,
    },
    {
      id: "state",
      header: "State",
      cell: (r) => {
        const note = stateNote(r)
        return (
          <span className="flex items-center gap-1">
            {stateBadge(r)}
            {note ? <NoteMarker label={`${rowName(r)} note`}>{note}</NoteMarker> : null}
          </span>
        )
      },
    },
    {
      id: "input",
      header: "Master",
      cell: (r) => {
        const offers = r.source ? [] : stackOffers(state, r)
        return (
          <span className="flex max-w-[18rem] flex-col items-start gap-0.5">
            {r.source ? (
              <span className="max-w-full truncate" title={r.source.path}>
                {r.source.name}
              </span>
            ) : r.state === "exception" ? (
              <span className="text-muted-foreground">Without {KIND_LABEL[r.kind].toLowerCase()}</span>
            ) : offers[0] ? (
              <StackPill offer={offers[0]} />
            ) : r.closest ? (
              <span className="max-w-full truncate text-muted-foreground" title={summaryText(r.closest.criteria)}>
                Closest · {r.closest.source.name}
              </span>
            ) : (
              <span className="text-muted-foreground">No master</span>
            )}
            {r.input ? <Sha value={shaOf(r)} /> : null}
          </span>
        )
      },
    },
    {
      id: "criteria",
      header: "Criteria",
      cell: (r) =>
        r.criteria.length === 0 ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          <details className="group">
            <summary className="cursor-default text-[0.75rem] marker:text-muted-foreground">{summaryText(r.criteria)}</summary>
            <ul className="mt-1 space-y-0.5 text-[0.75rem]">
              {r.criteria.map((c) => (
                <li key={c.name} className="flex flex-wrap gap-x-2">
                  <span className="w-24 text-muted-foreground">{CRITERION_LABEL[c.name]}</span>
                  <span>{c.lightValue}</span>
                  <span className="text-muted-foreground">vs {c.calibrationValue}</span>
                  <StatusBadge kind="match" value={c.result} />
                </li>
              ))}
            </ul>
          </details>
        ),
    },
    { id: "actions", header: "", cell: (r) => <RowActions entries={entries(r)} label={`Choose the ${rowName(r)}`} /> },
  ]
  return (
    <DataTable
      label="Calibration requirements"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.key}
      scroll="none"
      groups={{ key: (r) => r.groupLabel, label: (key, groupRows) => `${key} · ${plural(groupRows.length, "requirement")}` }}
      rowClassName={(r) => (r.drift || r.state === "unresolved" || r.state === "deferred" ? "bg-warning/[0.05]" : undefined)}
      contextMenu={entries}
    />
  )
}

function ExceptionDialog({ value, onClose, onConfirm }: { value: ExceptionRequest | null; onClose: () => void; onConfirm: (reason: string) => boolean }) {
  const [reason, setReason] = useState("")
  const id = useId()
  if (!value) return null
  const kind = KIND_LABEL[value.row.kind].toLowerCase()
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
            <DialogTitle>{value.source ? `Exception: ${value.source.name}` : `Without ${kind}`}</DialogTitle>
            <DialogDescription>{value.source ? summaryText(value.criteria) : `${formatNight(value.row.member.session.night)} ${value.row.member.session.channel ?? ""} · this run only`}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={id}>Reason</Label>
            <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Dithered; no 300 s dark at gain 100" autoFocus />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={reason.trim() === ""}>
              Record exception
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Masters found in this run's Results: Add files a copy into structured
 * calibration storage; Dismiss is reversible from the Calibration library's
 * Dismissed filter (P-CAL2). Candidates never match until they are added.
 */
export function MasterOffers({ run, onOutcome }: { run: Run; onOutcome: Act }) {
  const state = useStore((s) => s)
  const pending = run.masterOffers.filter((o) => o.state === "pending").map((o) => state.catalog.masters[o.masterId]).filter((m) => m !== undefined)
  const dismissed = run.masterOffers.filter((o) => o.state === "dismissed").length
  if (pending.length === 0 && dismissed === 0) return null
  const add = (masterId: string, name: string) => onOutcome(answerMasterOffer(run.id, masterId, "adopt"), { title: `${name} added`, tone: "info" })
  const dismiss = (masterId: string, name: string) => onOutcome(answerMasterOffer(run.id, masterId, "dismiss"), { title: `${name} dismissed`, tone: "info" })
  return (
    <Box
      id={`offers-${run.id}`}
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          Masters found <CountBadge count={pending.length} label={plural(pending.length, "master")} />
        </span>
      }
      actions={
        dismissed > 0 ? (
          <Pill tone="muted" icon={ListRestart} link={DISMISSED_LINK} title="Restore in the Calibration library">
            {dismissed} dismissed
          </Pill>
        ) : null
      }
    >
      {pending.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">None pending</p>
      ) : (
        <ul className="divide-y divide-separator" data-master-offers>
          {pending.map((master) => {
            const name = fileName(master.origin.sourcePath)
            return (
              <RowContextMenu
                key={master.id}
                entries={[
                  { heading: name },
                  { label: "Add to library", onSelect: () => add(master.id, name) },
                  { label: "Dismiss", onSelect: () => dismiss(master.id, name) },
                ]}
              >
                <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium" title={master.origin.sourcePath}>
                    {name}
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <Pill tone="info">{KIND_LABEL[master.kind]}</Pill>
                    {master.channel ? <Pill tone="neutral">{master.channel}</Pill> : null}
                    {master.widthPx > 0 ? (
                      <Pill tone="muted">
                        {master.widthPx} × {master.heightPx}
                      </Pill>
                    ) : null}
                    <Pill tone="muted">bin {master.binning}</Pill>
                  </span>
                  <span className="flex gap-1.5">
                    <Button size="xs" onClick={() => add(master.id, name)}>
                      Add to library
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => dismiss(master.id, name)}>
                      Dismiss
                    </Button>
                  </span>
                </li>
              </RowContextMenu>
            )
          })}
        </ul>
      )}
    </Box>
  )
}
