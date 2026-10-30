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
