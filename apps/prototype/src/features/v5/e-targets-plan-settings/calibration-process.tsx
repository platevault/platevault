/**
 * A calibration process as a staged flow, `/calibration/processes/$processId/$step`
 * (design/R9-COMPOSITION-PLAN.md §4a: StepPage, Stack → Detect → Import →
 * Register → Raws). A route stub until the Calibration unit builds it.
 */
import { useMessages } from "@/app/preferences"
import { PageHeader } from "@/components/app/page"

export function CalibrationProcessPage() {
  const m = useMessages()
  return <PageHeader title={m.calibration_process_title()} />
}
