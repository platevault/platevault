/**
 * S11 Plan (slice E): Tonight (best window per subject and favourite, Moon,
 * darkness, site and time zone) and the night timeline; `?project=` scopes
 * it to that Project's subjects (D-W16, D-W63, PLAN-FR-02/09/10/11).
 * Foundation placeholder; slice E replaces this file.
 */
import { useSearch } from "@tanstack/react-router"
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { planningSite } from "@/domain/derive"
import { tonightAt } from "@/domain/planning"
import { formatTime } from "@/lib/format"
import { nowIso, useStore } from "@/store/core"

export function PlanPage() {
  const search = useSearch({ strict: false }) as { project?: string }
  const state = useStore((s) => s)
  const site = planningSite(state)
  const tonight = site ? tonightAt(site, Date.parse(nowIso())) : null
  const project = search.project ? state.catalog.projects[search.project] : undefined
  return (
    <PlaceholderPage
      screen={SCREENS.S11}
      facts={[
        { label: "Site", value: site ? `${site.name} (${site.timeZone})` : "Add an observing site in Settings" },
        { label: "Darkness", value: tonight?.darkness ? `${formatTime(tonight.darkness.start, site!.timeZone)}–${formatTime(tonight.darkness.end, site!.timeZone)}` : "–" },
        { label: "Moon", value: tonight ? `${tonight.moon.illuminationPct}% · ${tonight.moon.phase}` : "–" },
        { label: "Scope", value: project ? `${project.name}'s subjects` : "My targets" },
      ]}
    />
  )
}
