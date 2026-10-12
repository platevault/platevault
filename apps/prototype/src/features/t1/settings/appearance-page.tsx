/**
 * Settings › Appearance (J10 S2, S9). Theme, language and
 * single-key shortcuts live in `src/app/preferences.ts`: they apply
 * immediately, are stored in this browser and survive Reset prototype data.
 * The theme picker (live swatches over the theme registry) and the language
 * picker (en-GB, and pt-BR marked machine-generated) are the foundation's
 * (`src/app/appearance.tsx`).
 */
import { useId, useState } from "react"
import { LanguagePicker, ThemePicker } from "@/app/appearance"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { setLocale, setSingleKeyShortcuts, setTheme, type ThemePreference, useMessages, usePreferences } from "@/app/preferences"
import { DEFAULT_THEME, themeInfo } from "@/app/themes"
import { DEFAULT_LOCALE, LOCALE_META } from "@/lib/i18n"

const DEFAULTS = { theme: DEFAULT_THEME as ThemePreference, locale: DEFAULT_LOCALE, singleKeyShortcuts: true }

export function AppearancePage() {
  const m = useMessages()
  const preferences = usePreferences()
  const [confirmReset, setConfirmReset] = useState(false)
  const ids = { theme: useId(), language: useId(), shortcuts: useId() }
  const atDefaults = preferences.theme === DEFAULTS.theme && preferences.locale === DEFAULTS.locale && preferences.singleKeyShortcuts === DEFAULTS.singleKeyShortcuts

  return (
    <div>
      <PageHeader
        level={2}
        title={m.settings_appearance()}
        actions={
          <Button variant="outline" size="sm" disabled={atDefaults} title={atDefaults ? m.settings_at_defaults() : undefined} onClick={() => setConfirmReset(true)}>
            {m.settings_restore_defaults()}
          </Button>
        }
      />
      <PageBody>
        <Section title={m.shell_theme()} level={3} id={ids.theme}>
          <ThemePicker />
        </Section>

        <Section title={m.shell_language()} level={3} id={ids.language}>
          <LanguagePicker />
        </Section>

        <Section title={m.settings_keyboard()} level={3} id={ids.shortcuts}>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <span className="inline-flex items-center gap-1.5">
              <label htmlFor={`${ids.shortcuts}-switch`} className="text-sm font-medium">
                {m.shortcuts_single_key()}
              </label>
              <HelpTip label={m.settings_shortcuts_about()}>{m.settings_shortcuts_help()}</HelpTip>
            </span>
            <Switch id={`${ids.shortcuts}-switch`} checked={preferences.singleKeyShortcuts} onCheckedChange={(checked) => setSingleKeyShortcuts(checked)} />
          </div>
        </Section>
      </PageBody>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={m.settings_restore_title()}
        description={null}
        changes={[
          m.shell_theme_named({ name: themeInfo(DEFAULT_THEME).name }),
          m.shell_language_named({ name: LOCALE_META[DEFAULT_LOCALE].nativeName }),
          m.palette_single_key_on(),
        ]}
        confirmLabel={m.settings_restore_defaults()}
        onConfirm={() => {
          setTheme(DEFAULTS.theme)
          setLocale(DEFAULTS.locale)
          setSingleKeyShortcuts(DEFAULTS.singleKeyShortcuts)
        }}
      />
    </div>
  )
}
