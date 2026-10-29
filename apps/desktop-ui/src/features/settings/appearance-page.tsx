/**
 * Settings › Appearance (LIB-FR-21, D-W143, D-W166): the mode first, then
 * that mode's themes (Match system: one dark and one light theme, which
 * follow the OS live), and the language. Each choice applies at once and
 * persists in PlateVault's per-user settings store (`app/preferences.ts`);
 * a save the store refuses says so in a toast and the choice applies until
 * restart. Restore defaults confirms first and resets the theme, the pair,
 * the language and the single-key shortcut preference. The app has one
 * density, so there is no density control.
 */
import { restoreDefaultPreferences, useMessages, usePreferences } from "@/app/preferences"
import { DEFAULT_SYSTEM_THEMES, DEFAULT_THEME, themeInfo } from "@/app/themes"
import { ActionButton } from "@/components/app/actions"
import { SettingsRow, SettingsSection } from "@/components/app/settings"
import { ThemePicker } from "@/components/app/theme-picker"
import { SettingsPage } from "@/components/templates/settings-page"
import { DEFAULT_LOCALE } from "@/lib/i18n"
import { LanguageField, localeName } from "./language-field"

export function AppearancePage() {
  const m = useMessages()
  const { theme, systemThemes, locale, singleKeyShortcuts } = usePreferences()
  const atDefaults =
    theme === DEFAULT_THEME && systemThemes.dark === DEFAULT_SYSTEM_THEMES.dark && systemThemes.light === DEFAULT_SYSTEM_THEMES.light && locale === DEFAULT_LOCALE && singleKeyShortcuts
  const label = m.settings_restore_defaults()
  return (
    <SettingsPage title={m.settings_appearance()}>
      <SettingsSection
        title={m.settings_group_general()}
        actions={
          <ActionButton
            action={{
              id: "restore-appearance-defaults",
              label,
              unavailable: atDefaults ? { action: label, reason: m.settings_at_defaults(), blockers: [] } : undefined,
              confirm: {
                title: m.settings_restore_title(),
                summary: [m.shell_theme_named({ name: themeInfo(DEFAULT_THEME).name }), m.shell_language_named({ name: localeName(DEFAULT_LOCALE) }), m.shortcuts_single_key()].join(" · "),
                confirm: { label },
              },
              run: restoreDefaultPreferences,
            }}
          />
        }
      >
        <SettingsRow label={m.shell_theme()}>
          <ThemePicker />
        </SettingsRow>
        <LanguageField />
      </SettingsSection>
    </SettingsPage>
  )
}
