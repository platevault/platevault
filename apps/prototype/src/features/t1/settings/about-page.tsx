/**
 * Settings › About this prototype. Names the build as a prototype, shows
 * where its data lives, offers Restart first-run setup and embeds the
 * simulation controls, including Reset to a seed.
 */
import { useNavigate } from "@tanstack/react-router"
import { FlaskConical } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList } from "@/components/app/data"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SimulationControls } from "@/app/simulation-panel"
import { STORAGE_KEY } from "@/store"
import { formatCount, formatDateTime } from "@/lib/format"
import { nowIso, useStore } from "@/store/core"
import { restartSetup } from "../lib/writes"

const VERSION = "0.0.0"

export function AboutPage() {
  const m = useMessages()
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
        title={m.settings_about()}
        meta={
          <Badge variant="outline" className="gap-1 rounded-md">
            <FlaskConical aria-hidden="true" />
            {m.common_prototype()}
          </Badge>
        }
      />
      <PageBody>
        <p className="flex flex-wrap items-center gap-1.5">
          <Pill tone="info">{m.about_simulated_data()}</Pill>
          <Pill tone="muted">{m.about_no_files_touched()}</Pill>
          <Pill tone="muted">{m.about_no_network()}</Pill>
        </p>

        <Section title={m.about_this_build()} level={3}>
          <KeyValueList
            items={[
              { label: m.about_version(), value: m.about_version_value({ version: VERSION }) },
              { label: m.about_data(), value: seed === "demo" ? m.about_data_demo() : m.about_data_empty() },
              { label: m.about_stored_in(), value: `localStorage · ${STORAGE_KEY}`, mono: false },
              {
                label: m.about_catalog(),
                value: [
                  m.about_count_locations({ count: counts.locations, n: formatCount(counts.locations) }),
                  m.about_count_light_sessions({ count: counts.sessions, n: formatCount(counts.sessions) }),
                  m.about_count_frames({ count: counts.frames, n: formatCount(counts.frames) }),
                  m.about_count_runs({ count: counts.runs, n: formatCount(counts.runs) }),
                ].join(" · "),
              },
              { label: m.about_clock(), value: clockOffset ? m.about_clock_simulated({ date: formatDateTime(nowIso()) }) : m.about_clock_system() },
            ]}
          />
        </Section>

        <Section title={m.about_onboarding()} level={3}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
            <span className="text-sm font-medium">{m.about_first_run_setup()}</span>
            <Button variant="outline" onClick={() => setConfirmRestart(true)}>
              {m.about_restart_setup()}
            </Button>
          </div>
        </Section>

        <Section title={m.about_simulation()} level={3}>
          <SimulationControls />
        </Section>
      </PageBody>

      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title={m.about_restart_title()}
        description={null}
        changes={[m.about_restart_change()]}
        confirmLabel={m.about_restart_setup()}
        onConfirm={() => {
          restartSetup()
          void navigate({ to: "/setup/locations" })
        }}
      />
    </div>
  )
}
