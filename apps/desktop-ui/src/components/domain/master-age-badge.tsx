import { useMessages } from "@/app/preferences"
import { StatusBadge } from "@/components/app/status"

/** The label and warning badge for a calibration master past its configured age. */
export function MasterAgeBadge({ ageDays }: { ageDays: number }) {
  const m = useMessages()
  return <StatusBadge kind="masterAge" value="old" label={m.flow_master_old({ n: ageDays })} />
}
