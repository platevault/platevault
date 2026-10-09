/**
 * S10 Target detail (slice E): one Target with Captured per channel, its
 * Projects, Fit per rig and planning (D-W17, D-W18, D-W61, D-W62).
 * Foundation placeholder; slice E replaces this file.
 */
import { Link, useParams } from "@tanstack/react-router"
import { MissingRecord } from "@/app/missing-record"
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { rigName, targetFit } from "@/domain/derive"
import { useStore } from "@/store/core"

export function TargetPage() {
  const { targetId } = useParams({ strict: false }) as { targetId?: string }
  const catalog = useStore((s) => s.catalog)
  const target = targetId ? catalog.targets[targetId] : undefined
  if (!target) return <MissingRecord noun="Target" backTo="/targets" backLabel="Open Targets" />
  return (
    <PlaceholderPage
      screen={{ ...SCREENS.S10, route: "/targets/$targetId" }}
      title={target.name}
      eyebrow={<Link to="/targets">Targets</Link>}
      facts={[
        { label: "My targets", value: target.favourite ? "★ Favourite" : "Not a favourite" },
        { label: "Fit", value: Object.keys(catalog.opticalTrains).map((id) => `${rigName(catalog, id)}: ${targetFit(catalog, target, id).label}`).join(" · ") || "No rigs" },
      ]}
    />
  )
}
