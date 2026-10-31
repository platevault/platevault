/**
 * Settings › About (LIB-FR-21): the installed app's version and data location,
 * and nothing else. The version comes from the app bundle (`api/app-info.ts`);
 * the shell reports the native directory that contains its catalog.
 */
import { useQuery } from "@tanstack/react-query"
import { appVersion } from "@/api/app-info"
import { useMessages } from "@/app/preferences"
import { libraryQuery } from "@/api/query"
import { KeyValueList, PathText } from "@/components/app/data"
import { UnknownValue } from "@/components/app/feedback"
import { Section } from "@/components/app/page"
import { SettingsPage } from "@/components/templates/settings-page"

export function AboutPage() {
  const m = useMessages()
  const version = useQuery({ queryKey: ["app", "version"], queryFn: appVersion, staleTime: Number.POSITIVE_INFINITY })
  const dataLocation = useQuery(libraryQuery("libraryDataLocation"))
  return (
    <SettingsPage title={m.settings_about()}>
      <Section title={m.about_this_build()} level={3}>
        <KeyValueList items={[{ label: m.about_version(), value: version.data ?? <UnknownValue reason={m.settings_about_version_unknown()} /> }]} />
      </Section>
      <Section title={m.about_data()} level={3}>
        <KeyValueList
          items={[
            {
              label: m.about_stored_in(),
              value: dataLocation.data ? <PathText path={dataLocation.data.display} /> : <UnknownValue reason={dataLocation.isError ? m.home_read_failed() : m.common_loading()} />,
              mono: true,
            },
          ]}
        />
      </Section>
    </SettingsPage>
  )
}
