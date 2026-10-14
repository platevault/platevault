/**
 * A location's State cell (C L2): the one state that needs attention, as
 * `locationAttention` ranks it, and nothing while the location is healthy.
 * Settings › Locations and the setup steps show the same badge.
 */
import { useMessages } from "@/app/preferences"
import { StatusBadge } from "@/components/app/status"
import type { LocationAttention } from "../lib/locations"

export function LocationAttentionBadge({ state }: { state: LocationAttention }) {
  const m = useMessages()
  if (!state) return null
  if (state.kind === "indexing") return <StatusBadge kind="operation" value="running" label={m.location_indexing()} />
  if (state.kind === "availability") return <StatusBadge kind="availability" value={state.value} />
  if (state.kind === "access") return <StatusBadge kind="access" value={state.value} />
  return <StatusBadge kind="scanScope" value={state.value} />
}
