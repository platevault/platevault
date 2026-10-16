/**
 * Flow builders (round 10, plan §5): each staged flow as the `StepFlow`
 * contract (components/app/contracts.ts) that StepStrip and StepFooter
 * render. The step states, gates and summaries are the domain's
 * (`sessionIntakeState` and `calibrationFlowState` in domain/derive.ts,
 * `wrapUpFlowState` in domain/project-view.ts); a builder words them with
 * the caller's `m` and attaches the current step's Proceed. Call them during
 * render, so the words follow the language.
 *
 * Contract as agreed with U7 (StepFlow rendering):
 * - Only the current step carries a gate; U7's `flowProceed` derives
 *   Proceed's unavailable state from it, so builders never set
 *   `proceed.unavailable`.
 * - `next` is where the host goes once Proceed succeeds: the next step for a
 *   write that settles at once, null for one that starts an operation (the
 *   step reads Running, then Finished when the operation succeeds, F2).
 * - `proceed` is null once the flow is finished (a closed Project, a
 *   finished calibration process): every step is read-only.
 *
 * Work a page owns comes in through `host`: Wrap up's selection, the Target
 * and rig the intake pickers hold.
 */
import type { Action, Blocker, ConfirmSpec, FlowStep, StepFlow } from "@/components/app/contracts"
import { CALIBRATION_STEP_NAME, rawItems } from "@/domain/calibration-process"
import {
  calibrationFlowState,
  calibrationStepLink,
  type DerivedStep,
  type FlowGate,
  nextInReviewQueue,
  SESSION_INTAKE_NAME,
  SESSION_INTAKE_STEPS,
  sessionIntakeEntry,
  sessionIntakeLink,
  sessionIntakeState,
  type SessionIntakeStepId,
  type StepLink,
  type World,
} from "@/domain/derive"
import { WRAP_UP_NAME, WRAP_UP_STEPS } from "@/domain/labels"
import { wrapUpFlowState, type WrapUpFlowState, wrapUpStepLink } from "@/domain/project-view"
import { trashBlock, viewLinks } from "@/domain/storage"
import type { CalibrationProcess, CalibrationStepId, OperationId, OpticalTrainId, ProfileId, Project, Session, TargetId, WrapUpStepId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { joinRefs, type MessageRef, type Messages, msg, say } from "@/lib/i18n"
import { type CommitResult, store } from "@/store/core"
import { detectMasters, discardRaws, importMaster, keepRaws, startStack } from "./calibration"
import { confirmRig, confirmTarget, filedUnclassified, fileIntoTarget } from "./library"
import { recordWrapUpStep, reopenWrapUpStep, wrapUpRefusal } from "./projects"
import { refuse } from "./shared"
import { trashFileRows } from "./trash"

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

function blockers(m: Messages, gate: FlowGate): Blocker[] {
  return gate.blockers.map((b) => (b.link ? { label: say(m, b.label), link: b.link } : { label: say(m, b.label) }))
}

function flowStep<Id extends string>(m: Messages, step: DerivedStep<Id>, label: MessageRef, optional = false): FlowStep {
  return {
    id: step.id,
    label: say(m, label),
    state: step.state,
    optional,
    gate: step.gate ? { reason: say(m, step.gate.reason), blockers: blockers(m, step.gate) } : null,
    summary: step.summary ? say(m, step.summary) : undefined,
  }
}

/** The step after `current` in `order`, or null on the last. */
function stepAfter<Id extends string>(order: Id[], current: Id): Id | null {
  return order[order.indexOf(current) + 1] ?? null
}

// ---------------------------------------------------------------------------
// Session intake (P-REV2, C10, C14, C15)
// ---------------------------------------------------------------------------

export interface SessionIntakeHost {
  /** Target step: the Target the picker holds, preselected from the pointing (P-IMP2); null while none is chosen. */
  targetId: TargetId | null
  /** Rig step: the rig the picker holds; null while none is chosen. */
  rigId: OpticalTrainId | null
}

/**
 * Session intake as a flow: Target → Rig → Review (§5.3), not ordered.
 * Target's Proceed confirms the chosen Target (File into Target for a
 * session imported as Unclassified), Rig's confirms the rig, and Review's
 * is Finish review: blocked while a frame is Unreviewed, then it opens the
 * next session the review queue holds (C14).
 */
export function sessionIntake(world: World, session: Session, m: Messages, host: SessionIntakeHost): StepFlow {
  const state = sessionIntakeState(world, session)
  const choiceGate = (reason: string) => ({ reason, blockers: [] })
  const steps = state.steps.map((step) => {
    const shown = flowStep(m, step, SESSION_INTAKE_NAME[step.id])
    if (step.id !== state.current || step.state === "finished") return shown
    if (step.id === "target" && !host.targetId) return { ...shown, state: "blocked" as const, gate: choiceGate(m.flow_confirm_target()) }
    if (step.id === "rig" && !host.rigId) return { ...shown, state: "blocked" as const, gate: choiceGate(m.flow_confirm_rig()) }
    return shown
  })
  const following = SESSION_INTAKE_STEPS.slice(SESSION_INTAKE_STEPS.indexOf(state.current) + 1).find((id) => state.steps.find((s) => s.id === id)?.state !== "finished") ?? "review"
  const queued = nextInReviewQueue(world.catalog, session)
  const next: StepLink | null = state.current === "review" ? (queued ? sessionIntakeEntry(world.catalog, queued) : null) : sessionIntakeLink(session.id, following)
  const label = state.current === "review" ? m.stepflow_finish_review() : m.stepflow_proceed()
  return {
    steps,
    current: state.current,
    ordered: false,
    proceed: { id: "intake-proceed", label, run: () => intakeProceed(session, state.current, host) },
    next,
    linkFor: (stepId: string) => sessionIntakeLink(session.id, stepId as SessionIntakeStepId),
  }
}

function intakeProceed(session: Session, step: SessionIntakeStepId, host: SessionIntakeHost): CommitResult {
  const href = `/sessions/${session.id}?step=${step}`
  if (step === "target") {
    if (!host.targetId) return refuse(msg("store_refused", { label: msg("stepflow_proceed") }), [msg("flow_confirm_target")], href)
    return filedUnclassified(store.getState(), session) ? fileIntoTarget(session.id, host.targetId, session.revision) : confirmTarget(session.id, host.targetId, session.revision)
  }
  if (step === "rig") {
    if (!host.rigId) return refuse(msg("store_refused", { label: msg("stepflow_proceed") }), [msg("flow_confirm_rig")], href)
    return confirmRig(session.id, host.rigId, session.revision)
  }
  // Finish review writes nothing: a session is Ready once every frame is Usable or Unusable, and the gate holds Proceed until then.
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Wrap up (C3, D4, F2, F4, F5)
// ---------------------------------------------------------------------------

/** The current Wrap up step's DataTable selection, as the page holds it (§5.5). */
export interface WrapUpSelection {
  /** Rows the step offers; with none, Proceed records the step Finished ("Nothing to clean up"). */
  offered: number
  /** Rows selected (recommended rows are preselected); with none, Proceed records the step Skipped (F4). */
  selected: number
  /** The confirm for the selection: title and file groups. Close project's title, summary and confirm label are the flow's own. */
  confirm?: ConfirmSpec
  /** Start the selection's operations and return their ids; the step reads Finished once every one succeeded (F2). */
  start: () => OperationId[]
}

/**
 * Wrap up as a flow: Clean up → Trash → Archive, ordered (C3). Later
 * steps stay read-only until the earlier ones are finished or skipped; an
 * earlier one reopens until Close (F5). Each step is a selection step, so it
 * has no Skip: Proceed with nothing selected records it Skipped (F4).
 * Archive's Proceed is Close project: the Project closes when its transfer
 * succeeds, or at once with nothing to move (§5.5).
 */
export function wrapUpFlow(world: World, project: Project, m: Messages, selection: WrapUpSelection): StepFlow {
  const state = wrapUpFlowState(world, project)
  const steps = state.steps.map((step) => flowStep(m, step, WRAP_UP_NAME[step.id]))
  const base = { steps, current: state.current, ordered: true, linkFor: (stepId: string) => wrapUpStepLink(project.id, stepId as WrapUpStepId) }
  if (state.closed) return { ...base, proceed: null, next: null }
  const step = state.current
  const settlesNow = selection.offered === 0 || selection.selected === 0
  const following = stepAfter(WRAP_UP_STEPS, step)
  const label = step === "archive" ? m.stepflow_close_project() : m.stepflow_proceed()
  const proceed: Action = { id: "wrap-up-proceed", label, run: () => wrapUpProceed(project.id, step, selection) }
  const confirm = step === "archive" ? closeConfirm(m, project, state, selection) : settlesNow ? undefined : selection.confirm
  return {
    ...base,
    proceed: confirm ? { ...proceed, confirm } : proceed,
    next: settlesNow && following ? wrapUpStepLink(project.id, following) : null,
    reopen: (stepId: string) => wrapUpReopen(m, project, stepId as WrapUpStepId, state),
  }
}

/** Refusals come first, so no operation starts for a step that cannot record it (C3). */
function wrapUpProceed(projectId: string, step: WrapUpStepId, selection: WrapUpSelection): CommitResult {
  const refused = wrapUpRefusal(projectId, step)
  if (refused) return refused
  if (selection.offered === 0) return recordWrapUpStep(projectId, step, { kind: "nothing-left" })
  if (selection.selected === 0) return recordWrapUpStep(projectId, step, { kind: "skipped" })
  return recordWrapUpStep(projectId, step, { kind: "started", operationIds: selection.start() })
}

/** Close project's confirm: the archive moves, with how steps 1 and 2 ended ("Clean up: Finished 10 Sep · Trash: Skipped"). */
function closeConfirm(m: Messages, project: Project, state: WrapUpFlowState, selection: WrapUpSelection): ConfirmSpec {
  const earlier = state.steps.filter((s) => s.id !== "archive").map((s) => (s.summary ? joinRefs([WRAP_UP_NAME[s.id], s.summary], ": ") : WRAP_UP_NAME[s.id]))
  return {
    title: m.stepflow_close_project_title({ name: project.name }),
    summary: say(m, joinRefs(earlier, " · ")),
    groups: selection.selected > 0 ? selection.confirm?.groups : undefined,
    confirm: { label: m.stepflow_close_project() },
  }
}

/**
 * Reopen step (F5): an earlier finished or skipped step, until Close. As
 * `reopenWrapUpStep` refuses, it is unavailable while any step carries a
 * gate: a step's work still runs, a change is pending, or another
 * operation works on the Project.
 */
function wrapUpReopen(m: Messages, project: Project, stepId: WrapUpStepId, state: WrapUpFlowState): Action {
  const label = m.stepflow_reopen_step()
  const action: Action = { id: `wrap-up-reopen-${stepId}`, label, run: () => reopenWrapUpStep(project.id, stepId) }
  const own = state.steps.find((s) => s.id === stepId)
  const busy = state.steps.find((s) => s.gate)?.gate ?? null
  const unavailable = (reason: MessageRef, gate: FlowGate | null) => ({ ...action, unavailable: { action: m.actions_blocked({ action: label }), reason: say(m, reason), blockers: gate ? blockers(m, gate) : [] } })
  if (!own || (own.state !== "finished" && own.state !== "skipped")) return unavailable(msg("flow_reason_step_open", { step: WRAP_UP_NAME[stepId] }), null)
  return busy ? unavailable(busy.reason, busy) : action
}

// ---------------------------------------------------------------------------
// Calibration process (P-CAL3)
// ---------------------------------------------------------------------------

/**
 * A calibration process as a flow: Stack → Detect → Import → Register →
 * Raws, ordered, with no reopen. Each step runs as part of one operation or
 * chains on by itself, so `next` is null and the page follows `current`.
 * Raws is optional: Finish calibration moves the raws to the OS Trash after
 * a review that folds out every raw file (astro-plan-6bh3p), Skip keeps
 * them. `profileId` is the tool profile Stack hands the raws to.
 */
export function calibrationFlow(world: World, process: CalibrationProcess, profileId: ProfileId | null, m: Messages): StepFlow {
  const state = calibrationFlowState(world, process, profileId)
  const steps = state.steps.map((step) => flowStep(m, step, CALIBRATION_STEP_NAME[step.id], step.id === "raws"))
  const base = { steps, current: state.current, ordered: true, next: null, linkFor: (stepId: string) => calibrationStepLink(process.id, stepId as CalibrationStepId) }
  if (state.finished) return { ...base, proceed: null }
  const last = state.current === "raws"
  const proceed: Action = { id: "calibration-proceed", label: last ? m.stepflow_finish_calibration() : m.stepflow_proceed(), run: () => calibrationProceed(process, state.current, profileId) }
  const review = last ? rawsReview(m, world, process) : null
  return {
    ...base,
    proceed: review ? { ...proceed, confirm: review } : proceed,
    skip: last ? { id: "calibration-skip", label: m.stepflow_skip(), run: () => keepRaws(process.id) } : undefined,
  }
}

/** Finish calibration's review: every raw file it moves to the OS Trash, and each that stays with its terse reason, as the move asks again. Null with nothing to move. */
function rawsReview(m: Messages, world: World, process: CalibrationProcess): ConfirmSpec | null {
  const items = rawItems(world.catalog, process)
  if (items.length === 0) return null
  const links = viewLinks(world.catalog, world.disk)
  const frames = new Set(items.map((item) => item.assetId)).size
  return {
    title: m.calibration_raws_trash_title({ count: frames, n: formatCount(frames) }),
    groups: [{ label: m.settings_raw_frames(), rows: trashFileRows(m, world, items.map((item) => ({ ...item, refused: trashBlock(world.disk, links, item.path) }))) }],
    confirm: { label: m.common_move_to_trash(), kind: "destructive" },
  }
}

function calibrationProceed(process: CalibrationProcess, step: CalibrationStepId, profileId: ProfileId | null): CommitResult {
  switch (step) {
    case "stack":
      return process.sessionId ? startStack(process.sessionId, profileId).result : { ok: true }
    case "detect":
      return detectMasters(process.id)
    case "import":
    case "register":
      return importMaster(process.id)
    case "raws":
      return discardRaws(process.id)
  }
}
