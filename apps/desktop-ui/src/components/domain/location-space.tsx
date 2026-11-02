/**
 * LocationFreeSpace (L2-domain, PRJ-FR-17 item 4): a Location's free
 * volume space as Home's Status and Settings › Locations show it, with the
 * Low space badge when the library flags it (under the share Settings ›
 * Locations saves). Unknown while the location is offline, retired or
 * unprobeable, never zero; the row's state says why.
 */
import type { Location } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { UnknownValue } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { formatBytes } from "@/lib/format"

export function LocationFreeSpace({ location }: { location: Pick<Location, "freeBytes" | "lowSpace"> }) {
  const m = useMessages()
  if (location.freeBytes === null) return <UnknownValue />
  return (
    <>
      {location.lowSpace ? <StatusBadge kind="space" value="low" /> : null} {m.import_free({ size: formatBytes(location.freeBytes) })}
    </>
  )
}
