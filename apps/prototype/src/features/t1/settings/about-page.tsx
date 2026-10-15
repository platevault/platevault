/**
 * Settings › About (plan §4a; C AB1-AB2): the build's facts as one
 * label-value list. Restart walk and Restart setup live on Help; the
 * simulation controls live in the Prototype panel.
 */
import { useMessages } from "@/app/preferences"
import { KeyValueList } from "@/components/app/data"
import { Section } from "@/components/app/page"
import { SettingsPage } from "@/components/templates/settings-page"
import { formatCount, formatDateTime } from "@/lib/format"
import { STORAGE_KEY } from "@/store"
import { nowIso, useStore } from "@/store/core"

const VERSION = "0.0.0"
/** The product licence, an SPDX identifier. */
const LICENCE = "AGPL-3.0-only"

export function AboutPage() {
  const m = useMessages()
  const seed = useStore((s) => s.seed)
  const locations = useStore((s) => Object.keys(s.catalog.locations).length)
  const sessions = useStore((s) => Object.values(s.catalog.sessions).filter((x) => !x.supersededBy && x.imageType === "light").length)
  const frames = useStore((s) => Object.keys(s.catalog.assets).length)
  const runs = useStore((s) => Object.keys(s.catalog.runs).length)
  const clockOffset = useStore((s) => s.faults.clockOffsetMs)

  return (
    <SettingsPage title={m.settings_about()}>
      <Section title={m.about_this_build()} level={3}>
        <KeyValueList
          items={[
            { label: m.about_version(), value: VERSION },
            { label: m.about_licence(), value: LICENCE },
            { label: m.about_data(), value: seed === "demo" ? m.about_data_demo() : m.about_data_empty() },
            { label: m.about_stored_in(), value: `localStorage · ${STORAGE_KEY}`, mono: true },
            {
              label: m.about_catalog(),
              value: [
                m.about_count_locations({ count: locations, n: formatCount(locations) }),
                m.about_count_light_sessions({ count: sessions, n: formatCount(sessions) }),
                m.about_count_frames({ count: frames, n: formatCount(frames) }),
                m.about_count_runs({ count: runs, n: formatCount(runs) }),
              ].join(" · "),
            },
            { label: m.about_clock(), value: clockOffset ? m.prototype_about_clock({ date: formatDateTime(nowIso()) }) : m.about_clock_system() },
          ]}
        />
      </Section>
    </SettingsPage>
  )
}
