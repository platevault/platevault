/**
 * Settings › About this prototype. Names the build as a prototype, shows
 * where its data lives, offers Restart first-run setup and embeds the
 * simulation controls, including Reset to a seed.
 */
import { useNavigate } from "@tanstack/react-router"
import { FlaskConical } from "lucide-react"
import { useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList } from "@/components/app/data"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SimulationControls } from "@/app/simulation-panel"
import { STORAGE_KEY } from "@/store"
import { formatDateTime, plural } from "@/lib/format"
import { nowIso, useStore } from "@/store/core"
import { restartSetup } from "../lib/writes"

const VERSION = "0.0.0 · prototype build"

export function AboutPage() {
  const navigate = useNavigate()
  const seed = useStore((s) => s.seed)
  const counts = useStore((s) => ({
    locations: Object.keys(s.catalog.locations).length,
    sessions: Object.values(s.catalog.sessions).filter((x) => !x.supersededBy && x.imageType === "light").length,
    frames: Object.keys(s.catalog.assets).length,
    runs: Object.keys(s.catalog.runs).length,
  }))
  const clockOffset = useStore((s) => s.faults.clockOffsetMs)
  const [confirmRestart, setConfirmRestart] = useState(false)

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
      />
      <PageBody>
        <p className="flex flex-wrap items-center gap-1.5">
          <Pill tone="info">Simulated data</Pill>
          <Pill tone="muted">No files touched</Pill>
          <Pill tone="muted">No network</Pill>
        </p>

        <Section title="This build" level={3}>
          <KeyValueList
            items={[
              { label: "Version", value: VERSION },
              { label: "Data", value: seed === "demo" ? "Demo library" : "Empty (first run)" },
              { label: "Stored in", value: `localStorage · ${STORAGE_KEY}`, mono: false },
              {
                label: "Catalog",
                value: `${plural(counts.locations, "location")} · ${plural(counts.sessions, "light session")} · ${plural(counts.frames, "frame")} · ${plural(counts.runs, "processing run")}`,
              },
              { label: "PlateVault clock", value: clockOffset ? `${formatDateTime(nowIso())} (simulated)` : "This computer" },
            ]}
          />
        </Section>

        <Section title="Onboarding" level={3}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
            <span className="text-sm font-medium">First-run setup</span>
            <Button variant="outline" onClick={() => setConfirmRestart(true)}>
              Restart setup
            </Button>
          </div>
        </Section>

        <Section title="Simulation" level={3}>
          <SimulationControls />
        </Section>
      </PageBody>

      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title="Restart first-run setup?"
        description={null}
        changes={["Open the Choose locations step"]}
        confirmLabel="Restart setup"
        onConfirm={() => {
          restartSetup()
          void navigate({ to: "/setup/locations" })
        }}
      />
    </div>
  )
}
