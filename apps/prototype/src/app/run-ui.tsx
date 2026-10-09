/**
 * Run UI pieces shared by the shell, the outlines and the screens
 * (foundation-owned; v4's pipeline UI moved to the run).
 *
 * - StepGlyph: Direction C's gate vocabulary. Each state has its own glyph
 *   shape, so colour only reinforces; the word sits beside it or in
 *   screen-reader text (glyph plus word). The triangle is kept for warnings,
 *   so no gate uses it.
 * - StepRail: a run's six steps in one line, for lists (Project runs, Home).
 * - CurrentLink: a router link whose aria-current the caller sets.
 * - useFollowLink: opens a step link and focuses its target element (e.g.
 *   Save run) once the route has rendered.
 */
import { createLink, useNavigate } from "@tanstack/react-router"
import { Circle, CircleArrowRight, CircleCheck, CircleDashed, CircleEllipsis, Loader, OctagonX } from "lucide-react"
import type { AnchorHTMLAttributes, Ref } from "react"
import { GATE_WORD, type GateState, type RunStepState, type StepLink } from "@/domain/derive"
import { STEP_NAME } from "@/domain/labels"
import type { RunStep } from "@/domain/types"
import { type Messages, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useMessages } from "./preferences"

const GATE_GLYPH: Record<GateState, { icon: typeof Circle; className: string }> = {
  done: { icon: CircleCheck, className: "text-success" },
  ready: { icon: CircleArrowRight, className: "text-link" },
  review: { icon: CircleEllipsis, className: "text-warning" },
  blocked: { icon: OctagonX, className: "text-destructive" },
  running: { icon: Loader, className: "text-link motion-safe:animate-spin" },
  partial: { icon: CircleDashed, className: "text-warning" },
  idle: { icon: Circle, className: "text-muted-foreground" },
}

/** The gate word for a state: the step rail, the toolbar and every `GateLabel`. */
export function gateWord(m: Messages, state: GateState): string {
  return say(m, GATE_WORD[state])
}

/** A run step's name: Select, Review, Calibrate, Prepare, Results, Done. */
export function stepName(m: Messages, step: RunStep): string {
  return say(m, STEP_NAME[step])
}

/**
 * TanStack Link marks every active link `aria-current="page"`, so a section
 * row, a run row and its step row would all claim the page. This anchor sets
 * aria-current from `current` only: the deepest row is the page, a step bar
 * item is the step.
 */
function CurrentAnchor({ current = false, ref, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { current?: "page" | "step" | false; ref?: Ref<HTMLAnchorElement> }) {
  return <a ref={ref} {...props} aria-current={current || undefined} data-current={current ? "" : undefined} />
}

export const CurrentLink = createLink(CurrentAnchor)

export function StepGlyph({ state, className }: { state: GateState; className?: string }) {
  const meta = GATE_GLYPH[state]
  const Icon = meta.icon
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", meta.className, className)} />
}

/** Glyph plus word: the gate state as a native status label, in the chosen language. */
export function GateLabel({ state, label, className }: { state: GateState; label?: string; className?: string }) {
  const m = useMessages()
  return (
    <span className={cn("inline-flex items-center gap-1 text-[0.75rem] font-medium", className)} data-gate={state}>
      <StepGlyph state={state} />
      {label ?? gateWord(m, state)}
    </span>
  )
}

/** A run's six steps with their gate glyph; the current step is named and marked (D-W3, PRJ-FR-20). `compact` names only the current step. */
export function StepRail({ steps, current, label, compact = false }: { steps: RunStepState[]; current: string; label: string; compact?: boolean }) {
  const m = useMessages()
  return (
    <ol aria-label={label} className="flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-1">
      {steps.map((step, index) => {
        const here = step.id === current
        const status = say(m, step.status)
        return (
          <li
            key={step.id}
            aria-current={here ? "step" : undefined}
            title={`${step.n} ${stepName(m, step.id)}: ${gateWord(m, step.state)}${status && status !== "–" ? ` · ${status}` : ""}`}
            className={cn("inline-flex h-5 items-center gap-1 rounded-[0.3125rem] px-1 text-[0.6875rem]", here ? "bg-foreground/[0.08] font-medium text-foreground" : "text-muted-foreground")}
          >
            <StepGlyph state={step.state} />
            <span className={cn(compact && !here && "sr-only")}>{stepName(m, step.id)}</span>
            <span className="sr-only">: {gateWord(m, step.state)}</span>
            {index < steps.length - 1 ? <span aria-hidden="true" className="ml-0.5 h-px w-1.5 bg-border" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

export function useFollowLink() {
  const navigate = useNavigate()
  return (link: StepLink) => {
    void navigate({ to: link.to as never, params: link.params as never, search: link.search as never }).then(() => {
      if (link.focusId) requestAnimationFrame(() => document.getElementById(link.focusId!)?.focus())
    })
  }
}
