/**
 * Settings › Target lookup (PLAN-TGT-FR-19): the online resolver's on/off
 * choice and a test lookup. The library has no command that reads or saves
 * the provider setting, so the section names that gap and offers nothing
 * that would pretend to work. Lookups themselves run from Targets' search.
 */
import { useMessages } from "@/app/preferences"
import { SettingsPage } from "@/components/templates/settings-page"
import { Gap } from "./parts"

export function TargetLookupPage() {
  const m = useMessages()
  return (
    <SettingsPage title={m.settings_target_lookup()}>
      {/* astro-plan-wre19.23: no command reads or saves the provider setting. */}
      <Gap what={m.settings_lookup_online_title()} detail={m.settings_gap_target_lookup()} />
    </SettingsPage>
  )
}
