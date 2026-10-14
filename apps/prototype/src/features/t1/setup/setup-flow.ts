/**
 * The first-run setup flow (plan §5.2): Language → Welcome → Locations →
 * Index, one route per step in the setup shell. Every step page builds its
 * StepPage flow here, so the strip and the footer read the same on each step.
 *
 * - Each route is its own current step: the steps before it read Finished,
 *   the steps after it To do.
 * - The strip links every step, so the way back is the strip and going back
 *   never undoes anything (HLD §6). The order lives in Proceed and in the
 *   Locations gate (at least one capture location), so the flow is not
 *   `ordered`: a step opened from the strip is that route's current step,
 *   never a read-only view.
 */
import type { Action, FlowStep, StepFlow } from "@/components/app/contracts"
import type { StepLink } from "@/domain/derive"
import type { Messages } from "@/lib/i18n"

/** The first-run setup steps, in order. */
export const SETUP_STEP_IDS = ["language", "welcome", "locations", "indexing"] as const

export type SetupStepId = (typeof SETUP_STEP_IDS)[number]

const ROUTE: Record<SetupStepId, string> = {
  language: "/setup/language",
  welcome: "/welcome",
  locations: "/setup/locations",
  indexing: "/setup/indexing",
}

/** Each setup step's name in the step strip. */
export function setupSteps(m: Messages): { id: SetupStepId; label: string }[] {
  const label: Record<SetupStepId, string> = {
    language: m.shell_language(),
    welcome: m.setup_step_welcome(),
    locations: m.common_locations(),
    indexing: m.setup_step_index(),
  }
  return SETUP_STEP_IDS.map((id) => ({ id, label: label[id] }))
}

/** What the step on screen offers in the footer. */
export interface SetupStep {
  proceed: Action
  /** Where Proceed (and Skip) go once they succeed; null when the actions open their own route or the step stays. */
  next: StepLink | null
  /** Makes the step optional: the footer's quiet Skip beside Proceed. */
  skip?: Action
  /** An unmet gate keeps Proceed focusable but unavailable. */
  gate?: FlowStep["gate"]
  /** The footer's line on the left. */
  summary?: string
}

export function setupFlow(m: Messages, current: SetupStepId, step: SetupStep): StepFlow {
  const at = SETUP_STEP_IDS.indexOf(current)
  const steps: FlowStep[] = setupSteps(m).map((item, index): FlowStep => {
    if (index < at) return { ...item, state: "finished" }
    if (index > at) return { ...item, state: "todo" }
    return { ...item, state: step.gate ? "blocked" : "current", optional: step.skip !== undefined, gate: step.gate ?? null, summary: step.summary }
  })
  return {
    steps,
    current,
    ordered: false,
    proceed: step.proceed,
    next: step.next,
    skip: step.skip,
    linkFor: (id) => ({ to: ROUTE[id as SetupStepId] }),
  }
}
