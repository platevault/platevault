/**
 * StepFlow (L2; design/R9-COMPOSITION-PLAN.md P11, §5): the one renderer for
 * staged work (setup, import, session intake, calibration processes, runs,
 * run groups and Wrap up). A `StepFlow` (contracts.ts) is plain data that the
 * flow builders make; these parts only render it.
 *
 * - `StepStrip`: under the page header, one glyph and word per step, never
 *   truncated. `aria-current="step"` marks the flow's current step. When the
 *   step on screen is a different one, its item carries `aria-current="page"`.
 *   Each step is a link (`flow.linkFor`) or, for local steps, a button
 *   (`onSelect`), so every step is a Tab stop.
 * - `StepFooter`: one fixed-height row at the bottom of the step pane. The
 *   viewed step's summary sits on the left. On the right go a ghost Skip and
 *   Proceed for the current step, Reopen step for an earlier one, or the
 *   read-only refusal for a later one. Proceed is the only primary (F1).
 * - `stepAccess`: the order rule (C3, F5, F7) in one place. Pages read it to
 *   make a step body read-only.
 * - `flowProceed` / `flowSkip`: the current step's two actions. An unmet gate
 *   makes Proceed focusable-disabled with its BlockersPreview.
 * - `useFlowActions`: the same two actions, opening `flow.next` once they
 *   succeed. The ⌘↩ shortcut uses it.
 * - `useStepActions`: the actions of the step on screen, by the order rule.
 *   StepFooter and FormDialog `steps` (form-dialog.tsx) both show these, so a
 *   page and a dialog act the same on every step (F9).
 */
import { Circle, CircleArrowRight, CircleCheck, CircleSlash, Lock, type LucideIcon, OctagonX, RotateCcw } from "lucide-react"
import { type FocusEvent, type ReactNode, useId, useLayoutEffect, useRef } from "react"
import { useMessages } from "@/app/preferences"
import { CurrentLink, useFollowLink } from "@/components/app/run-step"
import { Button } from "@/components/ui/button"
import type { StepLink } from "@/domain/derive"
import { m, type Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ActionButton, actionLabel, onSuccess, useAction } from "./actions"
import type { Action, FlowStep, StepFlow } from "./contracts"
import { BlockersPreview } from "./previews"
import { Refusal } from "./refusal"

// ---------------------------------------------------------------------------
// The order rule
// ---------------------------------------------------------------------------

/**
 * What a step allows while it is on screen (C3):
 * - `current`: the flow's step. Its body takes input and the footer offers Proceed.
 * - `open`: any other step of a flow without order. It takes input.
 * - `reopenable`: an earlier step of an unfinished flow. It stays read-only until Reopen step.
 * - `locked`: a later step of an ordered flow. It stays read-only until every step before it is finished or skipped.
 * - `read-only`: any step of a finished flow (F7; Reopen moves to the object menu), or an earlier step that cannot reopen.
 */
export type StepAccess = "current" | "open" | "reopenable" | "locked" | "read-only"

export function stepAccess(flow: StepFlow, stepId: string): StepAccess {
  if (flow.proceed === null) return "read-only"
  if (stepId === flow.current) return "current"
  if (!flow.ordered) return "open"
  if (indexOf(flow, stepId) > indexOf(flow, flow.current)) return "locked"
  return flow.reopen ? "reopenable" : "read-only"
}

/** Whether a step's body takes input: the current step, or any step of a flow without order. */
export function stepEditable(flow: StepFlow, stepId: string): boolean {
  const access = stepAccess(flow, stepId)
  return access === "current" || access === "open"
}

function indexOf(flow: StepFlow, stepId: string): number {
  return flow.steps.findIndex((step) => step.id === stepId)
}

function stepOf(flow: StepFlow, stepId: string): FlowStep | undefined {
  return flow.steps.find((step) => step.id === stepId)
}

/** The steps before `stepId` that are neither finished nor skipped: what keeps a locked step read-only. */
function openBefore(flow: StepFlow, stepId: string): FlowStep[] {
  return flow.steps.slice(0, indexOf(flow, stepId)).filter((step) => step.state !== "finished" && step.state !== "skipped")
}

// ---------------------------------------------------------------------------
// The footer's actions
// ---------------------------------------------------------------------------

/**
 * Proceed as the footer shows it. It is always primary (F1, F8). While the
 * current step's gate is unmet it stays focusable but unavailable, and its
 * preview lists that gate's blockers ("Proceed blocked · 2 unresolved"; F3).
 * Null once the flow is finished. Call it during render, so the words follow
 * the language.
 */
export function flowProceed(flow: StepFlow): Action | null {
  const proceed = flow.proceed
  if (!proceed) return null
  const gate = stepOf(flow, flow.current)?.gate
  return {
    ...proceed,
    kind: "primary",
    unavailable: gate ? { action: m.actions_blocked({ action: proceed.label }), reason: gate.reason, blockers: gate.blockers } : proceed.unavailable,
  }
}

/**
 * Skip, shown only on an optional current step of an unfinished flow (F4). A
 * selection step has no Skip: proceeding with nothing selected skips it. Skip
 * is never primary.
 */
export function flowSkip(flow: StepFlow): Action | undefined {
  if (!flow.skip || flow.proceed === null || !stepOf(flow, flow.current)?.optional) return undefined
  return { ...flow.skip, kind: "standard" }
}

/**
 * Proceed and Skip, each opening `flow.next` once it succeeds: the next step,
 * or for session review the next session that needs review (C14). A refusal
 * or a failure stays on the step. Without `next` (local steps, or a terminal
 * action that turns the page read-only) they are `flowProceed` and `flowSkip`.
 */
export function useFlowActions(flow: StepFlow): { proceed: Action | null; skip: Action | undefined } {
  const follow = useFollowLink()
  const proceed = flowProceed(flow)
  const skip = flowSkip(flow)
  const next = flow.next
  if (!next) return { proceed, skip }
  const opening = (action: Action): Action => ({ ...action, run: () => onSuccess(action.run(), () => follow(next)) })
  return { proceed: proceed && opening(proceed), skip: skip && opening(skip) }
}

/** The actions of the step on screen. */
export interface StepActions {
  access: StepAccess
  /** The current step's Proceed, opening `flow.next` on success; null on any other step and once the flow is finished. */
  proceed: Action | null
  /** The current step's Skip, on an optional step only. */
  skip?: Action
  /** Reopen step, on an earlier step of an unfinished ordered flow. */
  reopen?: Action
}

/**
 * What the step on screen offers (C3, F5): the current step its Proceed and
 * Skip; an earlier step of an ordered flow Reopen step; any other step
 * nothing, since it is read-only or belongs to a flow without order.
 */
export function useStepActions(flow: StepFlow, viewing: string): StepActions {
  const { proceed, skip } = useFlowActions(flow)
  const access = stepAccess(flow, viewing)
  if (access === "current") return { access, proceed, skip }
  if (access === "reopenable" && flow.reopen) return { access, proceed: null, reopen: { ...flow.reopen(viewing), kind: "standard" } }
  return { access, proceed: null }
}

// ---------------------------------------------------------------------------
// StepStrip
// ---------------------------------------------------------------------------

type StepState = FlowStep["state"]

/** Each state has its own glyph shape, so colour only reinforces it (the run gate glyphs in app/run-ui.tsx). */
const GLYPH: Record<StepState, { icon: LucideIcon; className: string }> = {
  todo: { icon: Circle, className: "text-muted-foreground" },
  current: { icon: CircleArrowRight, className: "text-link" },
  finished: { icon: CircleCheck, className: "text-success" },
  skipped: { icon: CircleSlash, className: "text-muted-foreground" },
  blocked: { icon: OctagonX, className: "text-destructive" },
  redo: { icon: RotateCcw, className: "text-warning" },
}

/** A step's accessible name: its label, then its state ("Calibrate, blocked · 2 unresolved"). */
function stepName(m: Messages, step: FlowStep): string {
  const label = { step: step.label }
  switch (step.state) {
    case "todo":
      return m.stepflow_step_todo(label)
    case "current":
      return m.stepflow_step_current(label)
    case "finished":
      return m.stepflow_step_finished(label)
    case "skipped":
      return m.stepflow_step_skipped(label)
    case "blocked":
      return step.gate ? m.stepflow_step_blocked_by({ ...label, reason: step.gate.reason }) : m.stepflow_step_blocked(label)
    case "redo":
      return m.stepflow_step_redo(label)
  }
}

export interface StepStripProps {
  flow: StepFlow
  /** The step on screen (the route's `$step`). Default: the flow's current step. */
  viewing?: string
  /**
   * For local steps (FormDialog steps): each step becomes a button that calls
   * this. Without it each step links to `flow.linkFor`; with neither, the
   * steps are plain text.
   */
  onSelect?: (stepId: string) => void
  /** The name of the step list ("Run steps"). Default "Steps". */
  label?: string
}

/** One step: the same box as a link, a button or text, so the strip never moves when a step changes state. */
const ITEM =
  "flex h-8 items-center gap-1.5 border-b-2 px-2 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"

export function StepStrip({ flow, viewing = flow.current, onSelect, label }: StepStripProps) {
  const m = useMessages()
  const lockedId = useId()
  const current = stepOf(flow, flow.current)
  const locked = flow.steps.some((step) => stepAccess(flow, step.id) === "locked")
  const { linkFor } = flow
  return (
    <nav aria-label={label ?? m.stepflow_steps()} data-chrome data-step-strip="" className="shrink-0 border-b border-separator bg-background px-3">
      <ol className="flex flex-wrap items-stretch">
        {flow.steps.map((step) => {
          const isCurrent = step.id === flow.current
          const isViewed = step.id === viewing
          const glyph = GLYPH[step.state]
          const Icon = glyph.icon
          const item = {
            "aria-describedby": stepAccess(flow, step.id) === "locked" ? lockedId : undefined,
            "data-step": step.id,
            "data-state": step.state,
            className: cn(ITEM, isViewed ? "border-primary text-foreground" : "border-transparent text-muted-foreground", (onSelect || linkFor) && !isViewed && "hover:text-foreground"),
          }
          // The name is the label, then the state, as text: it reads the same on a link, a button and plain text.
          const content: ReactNode = (
            <>
              <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", glyph.className)} />
              <span aria-hidden="true">{step.label}</span>
              <span className="sr-only">{stepName(m, step)}</span>
            </>
          )
          return (
            <li key={step.id} className="flex">
              {onSelect ? (
                <button type="button" {...item} aria-current={isCurrent ? "step" : isViewed ? "true" : undefined} onClick={() => onSelect(step.id)}>
                  {content}
                </button>
              ) : linkFor ? (
                <StepItemLink link={linkFor(step.id)} current={isCurrent ? "step" : isViewed ? "page" : false} {...item}>
                  {content}
                </StepItemLink>
              ) : (
                <span {...item} aria-current={isCurrent ? "step" : undefined}>
                  {content}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {locked && current ? (
        <span id={lockedId} hidden>
          {`${m.stepflow_read_only()} · ${m.stepflow_finish_first({ step: current.label })}`}
        </span>
      ) : null}
    </nav>
  )
}

interface StepItemLinkProps {
  link: StepLink
  current: "step" | "page" | false
  className: string
  children: ReactNode
  "aria-describedby"?: string
  "data-step": string
  "data-state": StepState
}

/** A router link that sets `aria-current` itself: TanStack's Link would mark every active link "page". */
function StepItemLink({ link, children, ...props }: StepItemLinkProps) {
  return (
    <CurrentLink to={link.to as never} params={link.params as never} search={link.search as never} {...props}>
      {children}
    </CurrentLink>
  )
}

// ---------------------------------------------------------------------------
// StepFooter
// ---------------------------------------------------------------------------

export interface StepFooterProps {
  flow: StepFlow
  /** The step on screen (the route's `$step`). Default: the flow's current step. */
  viewing?: string
}

/**
 * The step pane's footer. It is one row at the same height on every step, so
 * nothing moves when you change steps or a gate clears. The summary truncates
 * before the actions give way.
 */
export function StepFooter({ flow, viewing = flow.current }: StepFooterProps) {
  const m = useMessages()
  const root = useRef<HTMLElement>(null)
  const summary = useRef<HTMLParagraphElement>(null)
  const hadFocus = useRef(false)
  // The footer's last action (Proceed, or Reopen step), else the summary, which then reads the outcome.
  const focusTarget = () => [...(root.current?.querySelectorAll<HTMLElement>("[data-action]") ?? [])].at(-1) ?? summary.current
  const runner = useAction({ focusAfterConfirm: focusTarget })
  const { access, proceed, skip, reopen } = useStepActions(flow, viewing)
  const step = stepOf(flow, viewing)
  const current = stepOf(flow, flow.current)

  // The actions swap when a step advances, a gate clears or the flow finishes; the focused one can go with them.
  // Focus then stays in the footer, as in DataTable's toolbar slot.
  const swap = `${viewing}:${access}:${proceed?.unavailable ? "unavailable" : "available"}:${skip ? "skip" : ""}`
  useLayoutEffect(() => {
    const active = document.activeElement
    if (!hadFocus.current || (active !== null && active !== document.body)) return
    focusTarget()?.focus()
  }, [swap])

  let actions: ReactNode = null
  if (access === "current") {
    const gate = current?.gate
    actions = (
      <>
        {runner.feedback ?? (gate && proceed ? <Refusal standing action={m.actions_blocked({ action: proceed.label })} reason={gate.reason} blockers={gate.blockers} /> : null)}
        {/* Skip is quiet: a ghost button in the footer's skip slot, never primary (F4). */}
        {skip ? (
          <Button variant="ghost" size="sm" data-action={skip.id} disabled={runner.pending !== null} onClick={() => runner.run(skip)}>
            {actionLabel(skip)}
          </Button>
        ) : null}
        {proceed ? <ActionButton action={proceed} runner={runner} /> : null}
      </>
    )
  } else if (reopen) {
    actions = (
      <>
        {runner.feedback}
        <ActionButton action={reopen} runner={runner} />
      </>
    )
  } else if (access === "locked" && current) {
    // A state, not a refused action: the lock and "Read-only", then what to finish first, linked to every open step before this one.
    const blockers = openBefore(flow, viewing).map((open) => ({ label: open.label, link: flow.linkFor?.(open.id) }))
    actions = (
      <span className="flex min-w-0 items-center gap-x-1.5 text-sm" data-step-locked="">
        <Lock aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">{m.stepflow_read_only()}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <BlockersPreview action={m.stepflow_read_only()} reason={m.stepflow_finish_first({ step: current.label })} blockers={blockers} />
      </span>
    )
  }

  return (
    <footer
      ref={root}
      data-chrome
      data-step-footer={access}
      className="flex h-11 shrink-0 items-center gap-3 border-t border-separator bg-chrome px-3"
      onFocus={() => {
        hadFocus.current = true
      }}
      onBlur={(event: FocusEvent<HTMLElement>) => {
        // Focus that moved somewhere else; a control removed by the swap blurs to nothing.
        if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) hadFocus.current = false
      }}
    >
      <p ref={summary} tabIndex={-1} className="min-w-0 flex-1 truncate text-xs text-muted-foreground outline-none" data-step-summary="">
        {step?.summary}
      </p>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
      {runner.dialog}
    </footer>
  )
}
