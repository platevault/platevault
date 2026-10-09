/**
 * Wrap up (P-WRAP1, P-ARC1): the Project stage after every run is Complete,
 * at `/projects/$projectId?stage=wrap-up`. It replaces the Done / Archive
 * sheet. Steps run in order, each optional and skippable, each with its size:
 *
 * 1. Clean up runs: every Complete run's prepared entries (its footprint)
 *    through the run's own Clean up (slice C's `startCleanup`).
 * 2. Trash: rejects, intermediates and duplicates, each its own approval
 *    through the shared OS Trash engine; the shared `trash` step settles once
 *    each is moved or skipped.
 * 3. Archive: member sessions to the chosen archive location (the Default
 *    unless the Project picks another).
 * 4. Done: Mark Done.
 *
 * Nothing moves until an approval; every item is re-verified as it moves.
 */
import { Link } from "@tanstack/react-router"
import { Archive, CheckCheck, Eraser, SkipForward, Trash2, Undo2 } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { Box } from "@/components/app/box"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { NoteMarker } from "@/components/app/tips"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal } from "@/components/app/refusal"
import type { Tone } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useMessages } from "@/app/preferences"
import { GateLabel } from "@/app/run-ui"
import { archiveLocations, defaultArchiveLocation, projectRuns, projectWrapUp, runStepLink, type WrapUpStep } from "@/domain/derive"
import { runFootprint } from "@/domain/storage"
import type { Operation, Project, Run, WrapUpStepId } from "@/domain/types"
import { formatBytes } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { markProjectDone, setProjectArchiveLocation, setWrapUpStep } from "@/store/actions/projects"
import { moveToOsTrash } from "@/store/actions/trash"
import { type CommitResult, type PrototypeState, store, updateSlice, useStore } from "@/store/core"
import { startCleanup } from "@/features/v5/c-runs/actions"
import { cleanupReview } from "@/features/v5/c-runs/model"
import { startArchiveTransfer } from "./actions"
import { archivePlan, type OfferKind, sessionLabel, type TrashOffer, trashOffers } from "./model"
import { CommitOutcome, useCommitError } from "./parts"
import { rememberApproval } from "./trash"

const OFFER_ORDER: OfferKind[] = ["rejected-frames", "intermediates", "duplicate-copies"]
const OFFER_LABEL: Record<OfferKind, string> = { "rejected-frames": "Rejects", intermediates: "Intermediates", "duplicate-copies": "Duplicates" }

function offerLabel(m: Messages, kind: OfferKind): string {
  return kind === "rejected-frames" ? m.wrapup_offer_rejects() : kind === "intermediates" ? m.wrapup_offer_intermediates_label() : m.wrapup_offer_duplicates_label()
}

type StepPill = { label: string; tone: Tone }

function statePill(m: Messages, state: WrapUpStep["state"] | "next"): StepPill {
  const pills: Record<WrapUpStep["state"] | "next", StepPill> = {
    done: { label: m.status_done(), tone: "success" },
    skipped: { label: m.status_skipped(), tone: "muted" },
    todo: { label: m.wrapup_todo(), tone: "neutral" },
    next: { label: m.projects_col_next(), tone: "info" },
  }
  return pills[state]
}

/** The latest operation of a kind that touches a run. */
function latestRunOperation(state: PrototypeState, run: Run, kind: Operation["kind"]): Operation | null {
  return (
    Object.values(state.operations)
      .filter((op) => op.kind === kind && op.scope.runIds?.includes(run.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

interface CleanupRow {
  run: Run
  paths: string[]
  bytes: number
  operation: Operation | null
}

function cleanupRows(state: PrototypeState, project: Project): CleanupRow[] {
  return projectRuns(state.catalog, project.id).map((run) => ({
    run,
    paths: cleanupReview(state, run).entries.map((e) => e.path),
    bytes: runFootprint(state.disk, state.catalog, run.id).preparedBytes,
    operation: latestRunOperation(state, run, "cleanup"),
  }))
}

/** Each trash offer is settled once moved, skipped or empty; returns the shared step's state when all three are. */
function trashSettlement(state: PrototypeState, project: Project): "done" | "skipped" | null {
  const offers = trashOffers(state, project)
  const approvals = state.slices.b.approvals[project.id] ?? {}
  const skipped = state.slices.b.skippedOffers[project.id] ?? []
  const settled = OFFER_ORDER.every((k) => approvals[k] || skipped.includes(k) || (offers[k].count === 0 && offers[k].refusals.length === 0))
  if (!settled) return null
  return OFFER_ORDER.some((k) => approvals[k]) ? "done" : "skipped"
}

export function WrapUpStage({ project }: { project: Project }) {
  const m = useMessages()
  const wrap = useStore((s) => projectWrapUp(s.catalog, project))
  const done = project.state === "done"
  const waiting = wrap.waitingOn
  const record = useCommitError()
  const step = (id: WrapUpStepId) => wrap.steps.find((s) => s.id === id)!
  const pillFor = (s: WrapUpStep): StepPill => statePill(m, s.state === "todo" && wrap.current === s.id && !done ? "next" : s.state)
  const settle = (id: WrapUpStepId, state: "done" | "skipped" | null) => record.run(() => setWrapUpStep(project.id, id, state))
  const editable = !done && wrap.available

  return (
    <div className="space-y-4">
      {!done && waiting.length > 0 ? (
        <Refusal
          action={m.wrapup_blocked()}
          reason={m.wrapup_runs_not_complete({ count: waiting.length })}
          blockers={waiting.map((run) => ({ label: run.name, link: runStepLink(run, "done") }))}
        />
      ) : null}
      <CommitOutcome result={record.result} action={m.wrapup_refusal_record_step()} />
      <CleanupStep project={project} step={step("cleanup")} pill={pillFor(step("cleanup"))} editable={editable} current={wrap.current === "cleanup"} settle={(s) => settle("cleanup", s)} />
      <TrashStep project={project} step={step("trash")} pill={pillFor(step("trash"))} editable={editable} current={wrap.current === "trash"} settle={(s) => settle("trash", s)} />
      <ArchiveStep project={project} step={step("archive")} pill={pillFor(step("archive"))} editable={editable} current={wrap.current === "archive"} settle={(s) => settle("archive", s)} />
      <DoneStep project={project} ready={wrap.available && wrap.current === null} available={wrap.available} />
    </div>
  )
}

function StepBox({ n, title, size, pill, actions, children, id, flush = false }: { n: number; title: string; size: string | null; pill: StepPill; actions?: ReactNode; children?: ReactNode; id: string; flush?: boolean }) {
  return (
    <Box
      id={id}
      level={2}
      title={
        <span className="flex items-center gap-2">
          <span className="tabular-nums">{n}</span>
          <span className="text-foreground">{title}</span>
          {size ? <Pill tone="muted">{size}</Pill> : null}
          <Pill tone={pill.tone}>{pill.label}</Pill>
        </span>
      }
      actions={actions}
      flush={flush || children === undefined}
    >
      {children ?? null}
    </Box>
  )
}

/** An approval's operation: its progress while it runs, then the outcome pill with the summary in a note. */
function ApprovalOutcome({ operationId, label }: { operationId: string; label: string }) {
  const m = useMessages()
  const op = useStore((s) => s.operations[operationId])
  if (!op) return null
  if (op.status === "running" || op.status === "paused") return <GateLabel state="running" label={`${op.progress.done}/${op.progress.total} ${op.progress.unit}`} />
  return (
    <span className="inline-flex items-center gap-1">
      <Pill tone={op.status === "succeeded" ? "success" : "warning"}>{op.status === "succeeded" ? label : op.status === "partial" ? m.status_partial() : m.status_failed()}</Pill>
      {op.summary ? <NoteMarker label={m.wrapup_summary({ label })}>{op.summary}</NoteMarker> : null}
    </span>
  )
}

/** Skip on a step to do; Undo on a skipped one (a done step's files have moved). */
function SettleButtons({ step, editable, settle }: { step: WrapUpStep; editable: boolean; settle: (state: "skipped" | null) => void }) {
  const m = useMessages()
  if (!editable || step.state === "done") return null
  return step.state === "todo" ? (
    <Button size="sm" variant="ghost" onClick={() => settle("skipped")}>
      <SkipForward aria-hidden="true" data-icon="inline-start" />
      {m.wrapup_skip()}
    </Button>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => settle(null)}>
      <Undo2 aria-hidden="true" data-icon="inline-start" />
      {m.wrapup_undo()}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// 1. Clean up runs
// ---------------------------------------------------------------------------

function CleanupStep({ project, step, pill, editable, current, settle }: StepProps) {
  const m = useMessages()
  const rows = useStore((s) => cleanupRows(s, project))
  const [refused, setRefused] = useState<CommitResult | null>(null)
  const pending = rows.filter((r) => r.paths.length > 0 && r.operation?.status !== "running")
  const bytes = rows.reduce((n, r) => n + (r.paths.length > 0 ? r.bytes : 0), 0)

  function cleanUp(list: CleanupRow[]): CommitResult {
    const reasons: string[] = []
    for (const row of list) {
      const started = startCleanup(row.run.id, row.paths)
      if (!started.result.ok) reasons.push(`${row.run.name}: ${started.result.reason === "refused" ? started.result.reasons.join(", ") : started.result.message}`)
    }
    const result: CommitResult = reasons.length > 0 ? { ok: false, reason: "refused", message: reasons.join("; "), reasons } : { ok: true }
    setRefused(result.ok ? null : result)
    if (store.getState().catalog.projects[project.id]?.wrapUp.cleanup === undefined && reasons.length < list.length) settle("done")
    return { ok: true }
  }

  return (
    <StepBox
      id="wrap-cleanup"
      n={1}
      title={m.wrapup_cleanup_title()}
      size={bytes > 0 ? formatBytes(bytes) : null}
      flush
      pill={pill}
      actions={
        <>
          {editable && pending.length > 0 ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant={current ? "default" : "outline"}>
                  <Eraser aria-hidden="true" data-icon="inline-start" />
                  {m.wrapup_cleanup_all()}
                </Button>
              }
              title={m.wrapup_cleanup_confirm_title({ count: pending.length })}
              description={m.wrapup_cleanup_description()}
              changes={pending.map((r) => m.wrapup_cleanup_change({ name: r.run.name, count: r.paths.length, size: formatBytes(r.bytes) }))}
              confirmLabel={m.wrapup_cleanup()}
              tone="destructive"
              onConfirm={() => cleanUp(pending)}
            />
          ) : null}
          {editable && step.state === "todo" && pending.length === 0 ? (
            <Button size="sm" variant={current ? "default" : "outline"} onClick={() => settle("done")}>
              {m.wrapup_mark_done()}
            </Button>
          ) : null}
          <SettleButtons step={step} editable={editable} settle={settle} />
        </>
      }
    >
      <CommitOutcome result={refused} action={m.wrapup_cleanup_blocked()} reason={(count) => m.project_runs_count({ count })} className="border-b border-border px-3 py-2" />
      <ul className="divide-y divide-separator text-sm">
        {rows.map((row) => (
          <li key={row.run.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
            <Link to={runStepLink(row.run, "done").to as never} params={runStepLink(row.run, "done").params as never} className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline">
              {row.run.name}
            </Link>
            {row.operation?.status === "running" ? (
              <GateLabel state="running" label={m.wrapup_cleaning_up()} />
            ) : row.paths.length === 0 ? (
              <GateLabel state="done" label={m.wrapup_clean()} />
            ) : (
              <>
                <Pill tone="muted">{m.trash_entries({ count: row.paths.length })}</Pill>
                <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(row.bytes)}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </StepBox>
  )
}

interface StepProps {
  project: Project
  step: WrapUpStep
  pill: StepPill
  editable: boolean
  current: boolean
  settle: (state: "done" | "skipped" | null) => void
}

// ---------------------------------------------------------------------------
// 2. Trash: rejects, intermediates, duplicates
// ---------------------------------------------------------------------------

function TrashStep({ project, step, pill, editable, current, settle }: StepProps) {
  const m = useMessages()
  const offers = useStore((s) => trashOffers(s, project))
  const approvals = useStore((s) => s.slices.b.approvals[project.id] ?? {})
  const skipped = useStore((s) => s.slices.b.skippedOffers[project.id] ?? [])
  const bytes = OFFER_ORDER.reduce((n, k) => n + (approvals[k] || skipped.includes(k) ? 0 : offers[k].sizeBytes), 0)
  const firstOpen = OFFER_ORDER.find((k) => !approvals[k] && !skipped.includes(k) && offers[k].count > 0)

  const afterChange = () => {
    const state = store.getState()
    const project_ = state.catalog.projects[project.id]
    if (!project_ || project_.wrapUp.trash) return
    const result = trashSettlement(state, project_)
    if (result) settle(result)
  }
  const skip = (kind: OfferKind) => {
    updateSlice("b", (b) => ({ ...b, skippedOffers: { ...b.skippedOffers, [project.id]: [...new Set([...(b.skippedOffers[project.id] ?? []), kind])] } }))
    afterChange()
  }
  const resetAll = () => {
    updateSlice("b", (b) => ({ ...b, skippedOffers: { ...b.skippedOffers, [project.id]: [] } }))
    settle(null)
  }
  const skipAll = () => {
    updateSlice("b", (b) => ({ ...b, skippedOffers: { ...b.skippedOffers, [project.id]: OFFER_ORDER.filter((k) => !approvals[k]) } }))
    settle(OFFER_ORDER.some((k) => approvals[k]) ? "done" : "skipped")
  }
  const move = (offer: TrashOffer) => {
    const operationId = moveToOsTrash({ kind: offer.kind, title: `${OFFER_LABEL[offer.kind]} of ${project.name} to Trash`, projectId: project.id, runIds: [], items: offer.items, href: `/projects/${project.id}?stage=wrap-up` })
    rememberApproval(project.id, offer.kind, operationId)
    afterChange()
  }

  return (
    <StepBox
      id="wrap-trash"
      n={2}
      title={m.trash_title()}
      size={bytes > 0 ? formatBytes(bytes) : null}
      pill={pill}
      flush
      actions={
        editable && step.state === "todo" ? (
          <Button size="sm" variant="ghost" onClick={skipAll}>
            <SkipForward aria-hidden="true" data-icon="inline-start" />
            {m.wrapup_skip()}
          </Button>
        ) : editable && skipped.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={resetAll}>
            <Undo2 aria-hidden="true" data-icon="inline-start" />
            {m.wrapup_undo()}
          </Button>
        ) : null
      }
    >
      <ul className="divide-y divide-separator text-sm">
        {OFFER_ORDER.map((kind) => {
          const offer = offers[kind]
          const operationId = approvals[kind] ?? null
          const isSkipped = skipped.includes(kind)
          const empty = offer.count === 0 && offer.refusals.length === 0
          return (
            <li key={kind} className="space-y-1.5 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 font-medium">{offerLabel(m, kind)}</span>
                {offer.count > 0 && !operationId ? (
                  <>
                    <CountBadge count={offer.count} tone="neutral" label={m.wrapup_items({ count: offer.count })} />
                    <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(offer.sizeBytes)}</span>
                  </>
                ) : null}
                <span className="flex-1" />
                {operationId ? <ApprovalOutcome operationId={operationId} label={m.wrapup_moved()} /> : isSkipped ? <Pill tone="muted">{m.status_skipped()}</Pill> : empty ? <Pill tone="muted">{m.wrapup_none()}</Pill> : null}
                {editable && !operationId && !isSkipped && offer.count > 0 ? (
                  <>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant={current && firstOpen === kind ? "default" : "outline"}>
                          <Trash2 aria-hidden="true" data-icon="inline-start" />
                          {m.wrapup_trash_ellipsis()}
                        </Button>
                      }
                      title={m.wrapup_trash_offer_title({ offer: offerLabel(m, kind).toLowerCase(), name: project.name })}
                      description={m.wrapup_trash_offer_description()}
                      changes={[m.wrapup_items_to_trash({ count: offer.count, size: formatBytes(offer.sizeBytes) }), ...(offer.refusals.length > 0 ? [m.wrapup_items_kept_reason({ count: offer.refusals.length })] : [])]}
                      confirmLabel={m.trash_move()}
                      tone="destructive"
                      onConfirm={() => move(offer)}
                    />
                    <Button size="sm" variant="ghost" onClick={() => skip(kind)}>
                      {m.wrapup_skip()}
                      <span className="sr-only"> {offerLabel(m, kind)}</span>
                    </Button>
                  </>
                ) : null}
              </div>
              {offer.refusals.length > 0 && !operationId && !isSkipped ? (
                <Refusal action={m.wrapup_items_kept({ count: offer.refusals.length })} reason={m.wrapup_refused()} blockers={offer.refusals.map((r) => ({ label: `${r.label} · ${r.reason}` }))} />
              ) : null}
            </li>
          )
        })}
      </ul>
    </StepBox>
  )
}

// ---------------------------------------------------------------------------
// 3. Archive (P-ARC1)
// ---------------------------------------------------------------------------

function ArchiveStep({ project, step, pill, editable, current, settle }: StepProps) {
  const m = useMessages()
  const plan = useStore((s) => archivePlan(s, project))
  const locations = useStore((s) => archiveLocations(s))
  const fallback = useStore((s) => defaultArchiveLocation(s))
  const catalog = useStore((s) => s.catalog)
  const volumes = useStore((s) => s.disk.volumes)
  const operationId = useStore((s) => s.slices.b.approvals[project.id]?.archive ?? null)
  const choose = useCommitError()
  const groupId = useId()
  const dest = plan.destination

  return (
    <StepBox
      id="wrap-archive"
      n={3}
      title={m.wrapup_archive_title()}
      size={plan.sizeBytes > 0 ? formatBytes(plan.sizeBytes) : null}
      pill={pill}
      actions={
        <>
          {editable && step.state === "todo" && plan.rows.length > 0 && !plan.blocked ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant={current ? "default" : "outline"}>
                  <Archive aria-hidden="true" data-icon="inline-start" />
                  {m.wrapup_archive_ellipsis()}
                </Button>
              }
              title={m.wrapup_archive_confirm_title({ name: project.name })}
              description={m.wrapup_archive_description()}
              changes={[m.wrapup_archive_change({ count: plan.rows.length, dest: dest?.displayName ?? m.wrapup_archive_fallback(), size: formatBytes(plan.sizeBytes) }), m.wrapup_archive_links_follow()]}
              unchanged={plan.kept.length > 0 ? [m.wrapup_used_by_other({ count: plan.kept.length })] : undefined}
              confirmLabel={m.wrapup_archive_title()}
              onConfirm={() => {
                rememberApproval(project.id, "archive", startArchiveTransfer(project.id, plan.rows, "archive"))
                settle("done")
              }}
            />
          ) : null}
          <SettleButtons step={step} editable={editable} settle={settle} />
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <fieldset className="space-y-1.5">
          <legend id={groupId} className="text-xs font-medium text-muted-foreground">
            {m.wrapup_destination()}
          </legend>
          {locations.length === 0 ? (
            <Refusal action={m.wrapup_archive_blocked()} reason={m.wrapup_no_archive_location()} blockers={[{ label: `${m.nav_settings()} › ${m.common_locations()}`, link: { to: "/settings/locations" } }]} />
          ) : (
            <RadioGroup
              aria-labelledby={groupId}
              value={dest?.id ?? ""}
              disabled={!editable || step.state !== "todo"}
              onValueChange={(value) => choose.run(() => setProjectArchiveLocation(project.id, value === fallback?.id ? null : String(value)))}
            >
              {locations.map((l) => {
                const volume = volumes[l.volumeId]
                return (
                  <div key={l.id} className="flex items-center gap-2">
                    <RadioGroupItem id={`${groupId}-${l.id}`} value={l.id} />
                    <Label htmlFor={`${groupId}-${l.id}`} className="font-normal">
                      <span className="font-medium">{l.displayName}</span>
                    </Label>
                    {l.id === fallback?.id ? <Pill tone="info">{m.wrapup_default()}</Pill> : null}
                    {volume && !volume.mounted ? <Pill tone="warning">{m.status_offline()}</Pill> : null}
                    <span className="truncate font-mono text-xs text-muted-foreground">{l.path}</span>
                  </div>
                )
              })}
            </RadioGroup>
          )}
          <CommitOutcome result={choose.result} action={m.wrapup_refusal_destination()} />
        </fieldset>
        {plan.blocked && locations.length > 0 ? <Refusal action={m.wrapup_archive_blocked()} reason={plan.blocked} blockers={[]} /> : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.rows.length > 0 ? <Pill tone="neutral">{m.wrapup_sessions_to_move({ count: plan.rows.length })}</Pill> : null}
          {operationId ? <ApprovalOutcome operationId={operationId} label={m.status_archived()} /> : project.archive ? <Pill tone="success">{m.wrapup_sessions_archived({ count: project.archive.sessionIds.length })}</Pill> : null}
        </div>
        {plan.refused.length > 0 ? (
          <Refusal action={m.wrapup_sessions_stay({ count: plan.refused.length })} reason={m.wrapup_refused()} blockers={plan.refused.map((r) => ({ label: `${sessionLabel(catalog, r.session)} · ${r.reason}` }))} />
        ) : null}
        {plan.kept.length > 0 ? (
          <Refusal action={m.wrapup_sessions_kept({ count: plan.kept.length })} reason={m.wrapup_used_by_other_reason()} blockers={plan.kept.map((k) => ({ label: `${sessionLabel(catalog, k.session)} · ${k.projects.join(", ")}` }))} />
        ) : null}
      </div>
    </StepBox>
  )
}

// ---------------------------------------------------------------------------
// 4. Done
// ---------------------------------------------------------------------------

function DoneStep({ project, ready, available }: { project: Project; ready: boolean; available: boolean }) {
  const m = useMessages()
  const done = useCommitError()
  const isDone = project.state === "done"
  return (
    <StepBox
      id="wrap-done"
      n={4}
      title={m.status_done()}
      size={null}
      pill={statePill(m, isDone ? "done" : ready ? "next" : "todo")}
      actions={
        !isDone && available ? (
          <Button size="sm" variant={ready ? "default" : "outline"} onClick={() => done.run(() => markProjectDone(project.id))}>
            <CheckCheck aria-hidden="true" data-icon="inline-start" />
            {m.wrapup_mark_done()}
          </Button>
        ) : null
      }
    >
      {done.result ? (
        <div className="p-3">
          <CommitOutcome result={done.result} action={m.wrapup_refusal_mark_done()} reason={(count) => m.wrapup_runs_not_complete({ count })} />
        </div>
      ) : undefined}
    </StepBox>
  )
}
