/**
 * Import as a staged flow, `/import?step=` (design/R9-COMPOSITION-PLAN.md
 * §4a: StepPage, Source → Preview). A route stub until the Import unit
 * builds it; the plain `/import` still opens the Import sheet.
 */
import { useMessages } from "@/app/preferences"
import { PageHeader } from "@/components/app/page"

export function ImportFlowPage() {
  const m = useMessages()
  return <PageHeader title={m.import_flow_title()} />
}
