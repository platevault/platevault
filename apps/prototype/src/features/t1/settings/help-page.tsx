/**
 * Settings › Help, `/settings/help` (plan §4a; C S0c): the keyboard setting
 * and every shortcut, the rules the pages no longer explain in tooltips
 * (§6.2), and the getting-started walk and setup.
 */
import { useNavigate } from "@tanstack/react-router"
import { restartWalk } from "@/app/onboarding"
import { useMessages, usePreferences } from "@/app/preferences"
import { reviewShortcuts, SingleKeyShortcutsField, ShortcutsTable } from "@/app/shortcuts"
import { ActionButton } from "@/components/app/actions"
import { KeyValueList } from "@/components/app/data"
import { Section } from "@/components/app/page"
import { SettingsRow, SettingsSection } from "@/components/app/settings"
import { SettingsPage } from "@/components/templates/settings-page"
import { restartSetup } from "../lib/writes"
import { usePreferenceSaveState } from "./preference-save"

export function HelpPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const { singleKeyShortcuts } = usePreferences()
  const saved = usePreferenceSaveState(String(singleKeyShortcuts))
  return (
    <SettingsPage title={m.settings_help()}>
      <SettingsSection title={m.settings_keyboard()} actions={saved}>
        <SingleKeyShortcutsField />
      </SettingsSection>

      <Section title={m.help_shortcuts()} level={3}>
        <ShortcutsTable extra={[reviewShortcuts(m)]} />
      </Section>

      <Section title={m.help_tips()} level={3}>
        <KeyValueList
          items={[
            { label: m.help_tip_marks(), value: m.help_tip_marks_library() },
            { label: m.help_tip_auto_advance(), value: m.help_tip_auto_advance_value() },
            { label: m.help_tip_pan(), value: m.help_tip_pan_value() },
            { label: m.help_tip_threshold(), value: m.help_tip_threshold_value() },
            { label: m.help_tip_duplicates(), value: m.help_tip_duplicates_value() },
            { label: m.settings_lookup_online_title(), value: m.settings_lookup_online_help() },
            { label: m.status_default_site(), value: m.help_tip_default_site_value() },
            { label: m.help_tip_site_headers(), value: m.help_tip_site_headers_value() },
          ]}
        />
      </Section>

      <SettingsSection title={m.help_guide()}>
        <SettingsRow label={m.onboarding_walk_name()}>
          <ActionButton
            action={{
              id: "restart-walk",
              label: m.onboarding_restart_walk(),
              run: () => {
                restartWalk()
                void navigate({ to: "/" })
              },
            }}
          />
        </SettingsRow>
        <SettingsRow label={m.about_first_run_setup()}>
          <ActionButton
            action={{
              id: "restart-setup",
              label: m.about_restart_setup(),
              opensDialog: true,
              confirm: { title: m.about_restart_title(), summary: m.about_restart_change(), confirm: { label: m.about_restart_setup() } },
              run: () => {
                restartSetup()
                void navigate({ to: "/setup/locations" })
              },
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}
