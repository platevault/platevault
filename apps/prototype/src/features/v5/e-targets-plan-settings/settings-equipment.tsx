/**
 * S16 Settings › Equipment (slice E): rigs (optical trains) with camera kind
 * mono or OSC, sensor, field of view and a simple filter list; unknown
 * FILTER values per rig with "Add {value} to {rig}" (D-W31, PLAN-EQ-FR-01
 * to PLAN-EQ-FR-06). Foundation placeholder; slice E replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { rigBands, rigCameraKind, rigFieldOfView, unknownFilterValues } from "@/domain/derive"
import { useStore } from "@/store/core"

export function EquipmentSettingsPage() {
  const catalog = useStore((s) => s.catalog)
  return (
    <PlaceholderPage
      screen={{ ...SCREENS.S16, title: "Equipment", route: "/settings/equipment" }}
      level={2}
      facts={Object.values(catalog.opticalTrains).map((rig) => {
        const fov = rigFieldOfView(catalog, rig)
        const unknown = unknownFilterValues(catalog, rig.id)
        return {
          label: rig.name,
          value: `${rigCameraKind(catalog, rig) ?? "camera unknown"} · ${fov ? `${fov.widthDeg.toFixed(2)}° × ${fov.heightDeg.toFixed(2)}°` : "field of view unknown"} · filters ${rig.filters.map((f) => f.name).join(", ") || "none"} · bands ${rigBands(catalog, rig).join(" ") || "none"}${unknown.length ? ` · unknown FILTER ${unknown.join(", ")}` : ""}`,
        }
      })}
    />
  )
}
