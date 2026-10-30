import type { NextAction } from "@/api/ipc"
import type { StepLink } from "@/components/app/contracts"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"

/** Word and link a Project's library-computed next action consistently across its surfaces. */
export function projectNextStep(m: Messages, projectId: string, next: NextAction): { label: string; link: StepLink } {
  const project: StepLink = { to: "/projects/$projectId", params: { projectId } }
  switch (next.kind) {
    case "review_new_frames":
      return { label: m.domain_next_review_new_frames({ count: next.frames, n: formatCount(next.frames) }), link: project }
    case "waits_on_user":
      return { label: next.step === "view" ? m.home_next_view() : m.home_next_sessions(), link: { ...project, search: { stage: next.step } } }
    case "plan_tonight":
      return { label: m.target_plan_tonight(), link: { to: "/targets" } }
    case "apply_changes":
      return { label: m.domain_next_apply_changes({ count: next.changes }), link: { ...project, search: { stage: "view" } } }
    case "open_view":
      return { label: m.home_next_open_view(), link: { ...project, search: { stage: "view" } } }
    case "add_sessions":
      return { label: m.project_add_sessions(), link: { ...project, search: { stage: "sessions" } } }
  }
}

/** Each next action's place in PRJ-FR-18's rule order, rule 4's three in the order the library tries them. */
const RULE_ORDER: Record<NextAction["kind"], number> = { review_new_frames: 0, waits_on_user: 1, plan_tonight: 2, apply_changes: 3, open_view: 4, add_sessions: 5 }

/** Sort key of a Project's next action by PRJ-FR-18's rule order; a Project without one sorts last. */
export function projectNextStepOrder(next: NextAction | null): number {
  return next ? RULE_ORDER[next.kind] : Object.keys(RULE_ORDER).length
}
