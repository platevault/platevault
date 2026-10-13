/**
 * Settings › Appearance (J10 S2, S9; plan §4a). The theme (mode first, then
 * that mode's themes) and the language apply at once and persist in this
 * browser (`src/app/preferences.ts`): they survive Reset prototype data.
 * Restore defaults confirms first. The keyboard setting lives on Help.
 */
import { LanguagePicker } from "@/app/appearance"
import { setLocale, setTheme, type ThemePreference, useMessages, usePreferences } from "@/app/preferences"
import { DEFAULT_THEME, themeInfo } from "@/app/themes"
import { ActionButton } from "@/components/app/actions"
import { SettingsRow, SettingsSection } from "@/components/app/settings"
import { ThemePicker } from "@/components/app/theme-picker"
import { SettingsPage } from "@/components/templates/settings-page"
import { DEFAULT_LOCALE, LOCALE_META } from "@/lib/i18n"
import { usePreferenceSaveState } from "./preference-save"

const DEFAULTS = { theme: DEFAULT_THEME as ThemePreference, locale: DEFAULT_LOCALE }

export function AppearancePage() {
  const m = useMessages()
  const { theme, locale } = usePreferences()
  const indicator = usePreferenceSaveState(`${theme} ${locale}`)
  const atDefaults = theme === DEFAULTS.theme && locale === DEFAULTS.locale

  return (
    <SettingsPage title={m.settings_appearance()}>
      <SettingsSection
        title={m.settings_group_general()}
        actions={
          <>
            {indicator}
            <ActionButton
              action={{
                id: "restore-defaults",
                label: m.settings_restore_defaults(),
                unavailable: atDefaults ? { action: m.settings_restore_defaults(), reason: m.settings_at_defaults(), blockers: [] } : undefined,
                confirm: {
                  title: m.settings_restore_title(),
                  summary: [m.shell_theme_named({ name: themeInfo(DEFAULT_THEME).name }), m.shell_language_named({ name: LOCALE_META[DEFAULT_LOCALE].nativeName })].join(" · "),
                  confirm: { label: m.settings_restore_defaults() },
                },
                run: () => {
                  setTheme(DEFAULTS.theme)
                  setLocale(DEFAULTS.locale)
                },
              }}
            />
          </>
        }
      >
        <SettingsRow label={m.shell_theme()}>
          <ThemePicker />
        </SettingsRow>
        <SettingsRow label={m.shell_language()}>
          <LanguagePicker />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}
