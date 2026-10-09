/**
 * S1 Home (slice A), the start page: the control-panel dashboard (D-W39).
 * Foundation placeholder; slice A replaces this file. The facts below come
 * from the shared derivations the real screen uses.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { homeTopLine, projectNext, runningWork } from "@/domain/derive"
import { nowIso, useStore } from "@/store/core"

export function HomePage() {
  const state = useStore((s) => s)
  const top = homeTopLine(state.catalog)
  const now = Date.parse(nowIso())
  const projects = Object.values(state.catalog.projects).filter((p) => p.state === "open")
  return (
    <PlaceholderPage
      screen={SCREENS.S1}
      facts={[
        { label: "Top line", value: top.text },
        { label: "Projects", value: projects.map((p) => `${p.name}: ${projectNext(state, p, now)?.label ?? "No Next"}`).join(" · ") || "No open Projects" },
        { label: "Running work", value: `${runningWork(state.operations).length}` },
      ]}
    />
  )
}
