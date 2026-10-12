/**
 * Settings › Help, `/settings/help` (design/R9-COMPOSITION-PLAN.md §4a:
 * shortcuts, tips, guide, restart walk). A route stub until the Settings unit
 * builds it.
 */
import { useMessages } from "@/app/preferences"
import { PageHeader } from "@/components/app/page"

export function HelpPage() {
  const m = useMessages()
  return <PageHeader level={2} title={m.settings_help()} />
}
