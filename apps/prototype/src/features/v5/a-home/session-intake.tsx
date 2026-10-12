/**
 * Session intake as a staged flow, `/sessions/$sessionId?step=` (design/
 * R9-COMPOSITION-PLAN.md §4a, §5.3: StepPage, Target → Rig → Review). A
 * route stub until the Sessions unit builds it; without `step` the route
 * shows the session page.
 */
import { useMessages } from "@/app/preferences"
import { PageHeader } from "@/components/app/page"

export function SessionIntakePage() {
  const m = useMessages()
  return <PageHeader title={m.session_intake_title()} />
}
