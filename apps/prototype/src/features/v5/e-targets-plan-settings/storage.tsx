/**
 * S15 Storage (slice E, carried over from v4's T5 storage): location
 * availability, run and group footprints, duplicate candidates (live copies
 * only) and transfers; read-only (STO-FR-11/12). The v4 source is
 * `src/features/t5/storage.tsx` at commit 6ef221b1.
 * Foundation placeholder; slice E replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { locationAvailability } from "@/domain/library"
import { useStore } from "@/store/core"

export function StoragePage() {
  const state = useStore((s) => s)
  const locations = Object.values(state.catalog.locations)
  return (
    <PlaceholderPage
      screen={SCREENS.S15}
      facts={[{ label: "Locations", value: locations.map((l) => `${l.displayName} ${locationAvailability(state.disk, l)}`).join(" · ") || "None registered" }]}
    />
  )
}
