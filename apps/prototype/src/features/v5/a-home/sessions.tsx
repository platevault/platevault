/**
 * S12 Sessions (slice A): library light sessions with the Needs a Target,
 * Not in any Project and Trashed filters (D-W24, D-W25, D-W43, D-W59).
 * Foundation placeholder; slice A replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { isTrashedSession, liveLightSessions, sessionsNeedingWork } from "@/domain/derive"
import { useStore } from "@/store/core"

export function SessionsPage() {
  const catalog = useStore((s) => s.catalog)
  const work = sessionsNeedingWork(catalog)
  const trashed = Object.values(catalog.sessions).filter((s) => s.imageType === "light" && isTrashedSession(catalog, s)).length
  return (
    <PlaceholderPage
      screen={SCREENS.S12}
      facts={[
        { label: "Light sessions", value: `${liveLightSessions(catalog).length}` },
        { label: "Filters", value: `Needs a Target ${work.needsTarget.length} · Not in any Project ${work.notInProject.length} · Trashed ${trashed}` },
      ]}
    />
  )
}
