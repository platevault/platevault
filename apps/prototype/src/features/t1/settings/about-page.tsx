/**
 * Settings › About this prototype (J10 S9; J18 S5, S16-S17). Names the build
 * as a prototype, shows where its data lives, holds the onboarding controls
 * and embeds the simulation controls, including Reset to a seed.
 */
import { useNavigate } from "@tanstack/react-router"
import { FlaskConical } from "lucide-react"
import { useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList } from "@/components/app/data"
import { Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SimulationControls } from "@/app/simulation-panel"
import { STORAGE_KEY } from "@/store"
import { formatDateTime, plural } from "@/lib/format"
import { nowIso, useStore } from "@/store/core"
import { replayTour, restartSetup, setChecklistHidden } from "../lib/writes"

const VERSION = "0.0.0 · prototype build"

export function AboutPage() {
  const navigate = useNavigate()
  const seed = useStore((s) => s.seed)
  const counts = useStore((s) => ({
    locations: Object.keys(s.catalog.locations).length,
    sessions: Object.values(s.catalog.sessions).filter((x) => !x.supersededBy && x.imageType === "light").length,
    frames: Object.keys(s.catalog.assets).length,
    views: Object.keys(s.catalog.views).length,
  }))
  const onboarding = useStore((s) => s.settings.onboarding)
  const clockOffset = useStore((s) => s.faults.clockOffsetMs)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const ids = { restore: useId() }

  return (
    <div>
      <PageHeader
        level={2}
        title="About this prototype"
        meta={
          <Badge variant="outline" className="gap-1 rounded-md">
            <FlaskConical aria-hidden="true" />
            Prototype
          </Badge>
        }
        description="A design prototype of PlateVault. It is not the production app and makes no claim about backend behaviour."
      />
      <PageBody className="max-w-3xl">
        <Notice tone="info" title="Simulated data only">
          Folders, volumes, files and operations are fixture data held in this browser. Nothing on your computer is read, moved or changed, and no request leaves this
          browser.
        </Notice>

        <Section title="This build" level={3}>
          <KeyValueList
            items={[
              { label: "Version", value: VERSION },
              { label: "Data", value: seed === "demo" ? "Demo library" : "Started empty (first run)" },
              { label: "Stored in", value: `This browser, localStorage key ${STORAGE_KEY}`, mono: false },
              {
                label: "Catalog",
                value: `${plural(counts.locations, "location")} · ${plural(counts.sessions, "light session")} · ${plural(counts.frames, "frame")} · ${plural(counts.views, "View")}`,
              },
              { label: "PlateVault clock", value: clockOffset ? `${formatDateTime(nowIso())} (simulated)` : "Matches this computer" },
            ]}
          />
        </Section>

        <Section title="Onboarding" level={3} description="The orientation tour and the Getting started checklist are independent.">
          <ul className="divide-y rounded-lg border">
            <li className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">Orientation tour</p>
                <p className="text-xs text-muted-foreground">
                  {onboarding.tourCompletedAt ? `Finished or skipped ${formatDateTime(onboarding.tourCompletedAt)}. It never starts again by itself.` : "Starts once after setup."}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  replayTour()
                  void navigate({ to: "/targets" })
                }}
              >
                Replay orientation
              </Button>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">Getting started checklist</p>
                <p id={ids.restore} className="text-xs text-muted-foreground">
                  {onboarding.checklistHidden ? "Removed from the sidebar. Restoring it shows progress from your current library." : "Getting started is shown in the sidebar."}
                </p>
              </div>
              <Button variant="outline" disabled={!onboarding.checklistHidden} aria-describedby={ids.restore} onClick={() => setChecklistHidden(false)}>
                Restore Getting started
              </Button>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">First-run setup</p>
                <p className="text-xs text-muted-foreground">Reopens the setup steps. Locations and library data stay.</p>
              </div>
              <Button variant="outline" onClick={() => setConfirmRestart(true)}>
                Restart first-run setup
              </Button>
            </li>
          </ul>
        </Section>

        <Section title="Simulation controls" level={3} description="The same controls as the header Prototype button: volumes, folder access, external file changes, faults, clock and seeds.">
          <SimulationControls />
        </Section>
      </PageBody>

      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title="Restart first-run setup?"
        description="You go back to the setup steps; the library is not reset."
        changes={["Open the Choose locations step", "Library pages wait until you open the library again"]}
        unchanged={["Registered locations, sessions, decisions and Views", "The orientation tour and the checklist"]}
        confirmLabel="Restart setup"
        onConfirm={() => {
          restartSetup()
          void navigate({ to: "/setup/locations" })
        }}
      />
    </div>
  )
}
