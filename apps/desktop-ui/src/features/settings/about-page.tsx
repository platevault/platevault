/**
 * Settings › About (LIB-FR-21): the installed app's version and the data
 * location, and nothing else. The version comes from the app bundle
 * (`api/app-info.ts`). The library reports no data location yet, so that
 * row names the gap instead of guessing a path.
 */
import { useQuery } from "@tanstack/react-query"
import { appVersion } from "@/api/app-info"
import { useMessages } from "@/app/preferences"
import { KeyValueList } from "@/components/app/data"
import { UnknownValue } from "@/components/app/feedback"
import { Section } from "@/components/app/page"
import { SettingsPage } from "@/components/templates/settings-page"
import { Gap } from "./parts"

export function AboutPage() {
  const m = useMessages()
  const version = useQuery({ queryKey: ["app", "version"], queryFn: appVersion, staleTime: Number.POSITIVE_INFINITY })
  return (
    <SettingsPage title={m.settings_about()}>
      <Section title={m.about_this_build()} level={3}>
        <KeyValueList items={[{ label: m.about_version(), value: version.data ?? <UnknownValue reason={m.settings_about_version_unknown()} /> }]} />
      </Section>
      {/* astro-plan-wre19.21: the library reports no data location yet. */}
      <Section title={m.about_data()} level={3}>
        <Gap what={m.about_stored_in()} detail={m.settings_gap_data_location()} />
      </Section>
    </SettingsPage>
  )
}
