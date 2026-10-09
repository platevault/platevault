/**
 * S14 Calibration library (slice E, carried over from v4's T4 library):
 * masters and raw sets, adoption, and the runs that use each master (CAL).
 * The v4 source is `src/features/t4/library.tsx` at commit 6ef221b1; the
 * matching engine it used is now `src/domain/calibration.ts`.
 * Foundation placeholder; slice E replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { reusableSources } from "@/domain/calibration"
import { useStore } from "@/store/core"

export function CalibrationPage() {
  const state = useStore((s) => s)
  const sources = reusableSources(state.catalog, state.disk)
  const candidates = Object.values(state.catalog.masters).filter((m) => m.state === "candidate").length
  return (
    <PlaceholderPage
      screen={SCREENS.S14}
      facts={[{ label: "Library", value: `${sources.filter((s) => s.isMaster).length} adopted masters · ${sources.filter((s) => !s.isMaster).length} raw sets · ${candidates} candidate masters` }]}
    />
  )
}
