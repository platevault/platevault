/**
 * S5 Calibrate: the readiness line ("dark 3/3 · flat 2/3 · bias ✓"), the
 * calibration policy (automatic on by default, D-W55), a master found in
 * Results offered once with Dismiss, and Review matches: the requirement
 * table with its criteria, the automatic assignments with the SHA-256 they
 * hand off, ties and exceptions (D-W5, CAL-FR-08).
 */
import { Link } from "@tanstack/react-router"
import { ChevronDown, MoreHorizontal } from "lucide-react"
import { useId, useState } from "react"
import { Notice } from "@/components/app/feedback"
import { type Column, DataTable } from "@/components/app/data-table"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { basisFiles, type CalSource, calibrationPlan, CRITERION_LABEL, KIND_LABEL, readinessLine, type RequirementRow, summaryText } from "@/domain/calibration"
import { runSetup, workingContent } from "@/domain/derive"
import type { MatchCriterion, Run } from "@/domain/types"
import { fileName, formatNight, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { acceptCalibration, answerMasterOffer, calibrationException, clearCalibration, deferCalibration, setCalibrationPolicy } from "./actions"
import { type RunContext, readinessText, runLock, tieOf } from "./model"
import { OutcomeNotice, Sha, useOutcome } from "./parts"

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
  const [exception, setException] = useState<{ row: RequirementRow; source: CalSource | null; criteria: MatchCriterion[] } | null>(null)

  return (
    <div className="space-y-5">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      <section aria-labelledby="cal-readiness" className="flex flex-wrap items-start justify-between gap-4 border-b border-separator pb-4">
        <div className="min-w-0 space-y-1">
          <h2 id="cal-readiness" className="text-[0.75rem] font-medium text-muted-foreground">
            Calibration readiness
          </h2>
          <p className="font-mono text-base tabular-nums" data-readiness>
            {readinessText(plan)}
          </p>
          <p className="text-[0.75rem] text-muted-foreground">{readinessLine(plan)}</p>
        </div>
        <div className="flex max-w-sm items-start gap-2.5">
          <Switch id={switchId} className="mt-0.5" disabled={lock !== null} checked={setup.calibrationPolicy === "automatic"} onCheckedChange={(checked) => outcome.act(setCalibrationPolicy(run.id, checked ? "automatic" : "off"))} />
          <div className="space-y-0.5">
            <Label htmlFor={switchId}>Assign compatible calibration automatically</Label>
            <p className="text-[0.75rem] text-muted-foreground">
              {setup.calibrationPolicy === "automatic" ? "On: every requirement with a compatible input is assigned without a click; only the rest need you." : "Off: no calibration is handed off and nothing needs review."}
              {group ? (
                <>
                  {" "}
                  Shared by every panel of{" "}
                  <Link className="text-link underline-offset-4 hover:underline" to="/projects/$projectId/groups/$groupId/$step" params={{ projectId: group.projectId, groupId: group.id, step: "calibrate" }}>
                    {group.name}
                  </Link>
                  .
                </>
              ) : null}
            </p>
          </div>
        </div>
      </section>

      <MasterOffers run={run} onOutcome={outcome.act} />

      {plan.policy === "automatic" && plan.rows.length > 0 ? (
        <Section
          title="Review matches"
          id="cal-matches"
          description={`${plural(plan.rows.length, "requirement")}: ${plan.counts.automatic} automatic, ${plan.counts.accepted} accepted, ${plan.counts.exception} exceptions, ${plan.needsReview.length} need review.`}
          actions={
            <Button size="sm" variant="outline" aria-expanded={expanded} aria-controls="cal-matches-table" onClick={() => setOpen(!expanded)}>
              <ChevronDown aria-hidden="true" data-icon="inline-start" className={expanded ? "rotate-180" : undefined} />
              {expanded ? "Hide matches" : "Review matches"}
            </Button>
          }
        >
          {expanded ? (
            <div id="cal-matches-table">
              <RequirementTable run={run} rows={plan.rows} lock={lock} onOutcome={outcome.act} onException={setException} />
            </div>
          ) : null}
        </Section>
      ) : plan.policy === "automatic" ? (
        <Notice tone="info" title="No requirements yet">
          Save a selection with included frames in Select; each session then needs a dark, a flat and a bias.
        </Notice>
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
  if (row.drift) return <StatusBadge kind="content" value="drifted" label="Drifted: review" />
  if (row.state === "automatic") return <StatusBadge kind="assignment" value="accepted" label="Automatic" />
  return <StatusBadge kind="assignment" value={row.state} />
}

function RequirementTable({
  run,
  rows,
  lock,
  onOutcome,
  onException,
}: {
  run: Run
  rows: RequirementRow[]
  lock: string | null
  onOutcome: ReturnType<typeof useOutcome>["act"]
  onException: (v: { row: RequirementRow; source: CalSource | null; criteria: MatchCriterion[] }) => void
}) {
  const state = useStore((s) => s)
  const shaOf = (row: RequirementRow): string | null => {
    if (row.assignment?.basis?.files[0]) return row.assignment.basis.files[0].sha256
    return row.input ? (basisFiles(state.catalog, state.disk, row.input)[0]?.sha256 ?? null) : null
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
        const tie = tieOf(r)
        const note = r.drift
          ? <span className="text-warning">{r.drift}</span>
          : r.assignment?.exception
            ? <span>Exception: {r.assignment.exception.reason}</span>
            : tie.length > 1 && r.state === "automatic"
              ? <span className="text-warning">Tie: {plural(tie.length, "equal candidate")}; masters first, then the nearest night</span>
              : r.state === "unresolved"
                ? <span className="text-warning">No compatible input</span>
                : null
        return (
          <span className="flex max-w-[16rem] flex-col gap-0.5">
            {stateBadge(r)}
            {note ? <span className="text-[0.6875rem] text-pretty">{note}</span> : null}
          </span>
        )
      },
    },
    {
      id: "input",
      header: "Input · hands off",
      cell: (r) => (
        <span className="flex max-w-[18rem] flex-col">
          {r.source ? (
            <span className="truncate" title={r.source.path}>
              {r.source.name}
            </span>
          ) : r.state === "exception" ? (
            <span className="text-muted-foreground">Without {KIND_LABEL[r.kind].toLowerCase()}</span>
          ) : r.closest ? (
            <span className="truncate text-muted-foreground">Closest: {r.closest.source.name}</span>
          ) : (
            <span className="text-muted-foreground">No candidate</span>
          )}
          {r.input ? <Sha value={shaOf(r)} /> : null}
        </span>
      ),
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
    {
      id: "actions",
      header: "",
      cell: (r) =>
        lock ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" className="-my-1" aria-label={`Choose the ${KIND_LABEL[r.kind].toLowerCase()} for ${formatNight(r.member.session.night)} ${r.member.session.channel ?? ""}`} />}>
              <MoreHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Use</DropdownMenuLabel>
                {r.candidates.slice(0, 6).map((c) => (
                  <DropdownMenuItem
                    key={c.source.id}
                    onClick={() => (c.summary.allCompatible ? onOutcome(acceptCalibration(run.id, r.member.session.id, r.kind, c.source, c.criteria)) : onException({ row: r, source: c.source, criteria: c.criteria }))}
                  >
                    <span className="flex flex-col">
                      <span>{c.source.name}</span>
                      <span className="text-xs text-muted-foreground">{c.summary.allCompatible ? `Compatible · master${c.source.night ? ` · ${formatNight(c.source.night)}` : ""}` : `${summaryText(c.criteria)} · needs an exception reason`}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
                {r.candidates.length === 0 ? <DropdownMenuItem disabled>No candidate in the calibration library</DropdownMenuItem> : null}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onException({ row: r, source: null, criteria: [] })}>Process without {KIND_LABEL[r.kind].toLowerCase()}…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOutcome(deferCalibration(run.id, r.member.session.id, r.kind))}>Defer</DropdownMenuItem>
              {r.assignment ? <DropdownMenuItem onClick={() => onOutcome(clearCalibration(run.id, r.member.session.id, r.kind))}>Back to the automatic choice</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
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
    />
  )
}

function ExceptionDialog({ value, onClose, onConfirm }: { value: { row: RequirementRow; source: CalSource | null; criteria: MatchCriterion[] } | null; onClose: () => void; onConfirm: (reason: string) => boolean }) {
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
            <DialogTitle>{value.source ? `Use ${value.source.name} as an exception` : `Process without a ${kind}`}</DialogTitle>
            <DialogDescription>
              {value.source ? `It is not fully compatible: ${summaryText(value.criteria)}.` : `No ${kind} is handed off for ${formatNight(value.row.member.session.night)} ${value.row.member.session.channel ?? ""}.`} The exception applies to this run only and never changes the master's evidence.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={id}>Reason</Label>
            <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Dark library lacks 300 s at gain 100; dithered data" autoFocus />
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

/** A master found in this run's Results, offered once: Add to the calibration library, or Dismiss (D-W55). */
export function MasterOffers({ run, onOutcome }: { run: Run; onOutcome: ReturnType<typeof useOutcome>["act"] }) {
  const state = useStore((s) => s)
  const pending = run.masterOffers.filter((o) => o.state === "pending").map((o) => state.catalog.masters[o.masterId]).filter((m) => m !== undefined)
  if (pending.length === 0) return null
  return (
    <div className="space-y-2">
      {pending.map((master) => (
        <Notice
          key={master.id}
          tone="info"
          title={`${KIND_LABEL[master.kind]} master found in Results: ${fileName(master.origin.sourcePath)}`}
          actions={
            <>
              <Button size="sm" onClick={() => onOutcome(answerMasterOffer(run.id, master.id, "adopt"), { title: `Added ${fileName(master.path)} to the calibration library`, reasons: ["It is reusable for matching now; the Results copy stays."], tone: "info" })}>
                Add to calibration library
              </Button>
              <Button size="sm" variant="outline" onClick={() => onOutcome(answerMasterOffer(run.id, master.id, "dismiss"))}>
                Dismiss
              </Button>
            </>
          }
        >
          {master.channel ? `${master.channel} · ` : ""}
          {master.widthPx > 0 ? `${master.widthPx} × ${master.heightPx} · ` : ""}bin {master.binning}. Offered once: Dismiss keeps the file and never asks again. Candidates are never matched until they are added.
        </Notice>
      ))}
    </div>
  )
}
