/**
 * S10 Targets (slice E): My targets by default, unified search, the rig
 * selector with Fit and the band strip, presets (D-W17, D-W18, D-W19,
 * D-W23, D-W60 to D-W62). Foundation placeholder; slice E replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { bandStrip, myTargets, planningSite } from "@/domain/derive"
import { tonightAt } from "@/domain/planning"
import { nowIso, useStore } from "@/store/core"

export function TargetsPage() {
  const state = useStore((s) => s)
  const site = planningSite(state)
  const moon = site ? tonightAt(site, Date.parse(nowIso())).moon : null
  const strip = bandStrip(state.catalog, null, moon?.illuminationPct ?? null)
  return (
    <PlaceholderPage
      screen={SCREENS.S10}
      facts={[
        { label: "My targets", value: myTargets(state.catalog).map((t) => `${t.target.favourite ? "★ " : ""}${t.target.name}${t.projects.length ? ` (${t.projects.map((p) => p.name).join(", ")})` : ""}`).join(" · ") },
        { label: "Moon", value: moon ? `${moon.illuminationPct}% · ${moon.phase}` : "Add an observing site in Settings" },
        { label: "Filters", value: `${strip.cells.map((c) => `${c.band} ${c.state}`).join(" · ")} · ${strip.recommendation}` },
      ]}
    />
  )
}
