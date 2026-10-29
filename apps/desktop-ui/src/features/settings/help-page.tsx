/**
 * Settings › Help (LIB-FR-21): the single-key shortcut switch, every
 * keyboard shortcut, the tips, and the guide: replay the orientation walk
 * from its first stop (LIB-FR-27) or open first-run setup again at its
 * Locations step. Neither creates or changes a record.
 */
import { useNavigate } from "@tanstack/react-router"
import { useMessages } from "@/app/preferences"
import { ShortcutsTable, SingleKeyShortcutsField } from "@/app/shortcuts"
import { ActionButton } from "@/components/app/actions"
import { KeyValueList } from "@/components/app/data"
import { Section } from "@/components/app/page"
import { SettingsRow, SettingsSection } from "@/components/app/settings"
import { SettingsPage } from "@/components/templates/settings-page"
import { openWalk } from "./walk"

export function HelpPage() {
  const m = useMessages()
  const navigate = useNavigate()
  return (
    <SettingsPage title={m.settings_help()}>
      <SettingsSection title={m.settings_keyboard()}>
        <SingleKeyShortcutsField />
      </SettingsSection>
      <Section title={m.help_shortcuts()} level={3}>
        <ShortcutsTable />
      </Section>
      <Section title={m.help_tips()} level={3}>
        <KeyValueList
          items={[
            { label: m.help_tip_marks(), value: m.help_tip_marks_library() },
            { label: m.help_tip_auto_advance(), value: m.help_tip_auto_advance_value() },
            { label: m.help_tip_pan(), value: m.help_tip_pan_value() },
            { label: m.help_tip_threshold(), value: m.help_tip_threshold_value() },
            { label: m.help_tip_duplicates(), value: m.help_tip_duplicates_value() },
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
                void navigate({ to: "/" })
                openWalk()
              },
            }}
          />
        </SettingsRow>
        <SettingsRow label={m.about_first_run_setup()}>
          <ActionButton
            action={{
              id: "restart-setup",
              label: m.about_restart_setup(),
              confirm: { title: m.about_restart_title(), summary: m.about_restart_change(), confirm: { label: m.about_restart_setup() } },
              run: () => void navigate({ to: "/setup/locations" }),
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}
