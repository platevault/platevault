/**
 * Settings › Appearance (J10 S2, S9). Theme, language, density and
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
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { type Density, setDensity, setLocale, setSingleKeyShortcuts, setTheme, type ThemePreference, useMessages, usePreferences } from "@/app/preferences"
import { DEFAULT_THEME, themeInfo } from "@/app/themes"
import { DEFAULT_LOCALE, LOCALE_META, m } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const DENSITIES: Array<{ value: Density; title: () => string; rows: string; rowClass: string }> = [
  { value: "compact", title: m.settings_density_compact, rows: "28 px", rowClass: "h-7" },
  { value: "comfortable", title: m.settings_density_comfortable, rows: "32 px", rowClass: "h-8" },
  { value: "spacious", title: m.settings_density_spacious, rows: "40 px", rowClass: "h-10" },
]

const DEFAULTS = { theme: DEFAULT_THEME as ThemePreference, locale: DEFAULT_LOCALE, density: "comfortable" as Density, singleKeyShortcuts: true }

export function AppearancePage() {
  const m = useMessages()
  const preferences = usePreferences()
  const [confirmReset, setConfirmReset] = useState(false)
  const ids = { theme: useId(), language: useId(), density: useId(), shortcuts: useId() }
  const atDefaults =
    preferences.theme === DEFAULTS.theme && preferences.locale === DEFAULTS.locale && preferences.density === DEFAULTS.density && preferences.singleKeyShortcuts === DEFAULTS.singleKeyShortcuts

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

        <Section title={m.settings_density()} level={3} id={ids.density}>
          <RadioGroup aria-labelledby={`${ids.density}-title`} value={preferences.density} onValueChange={(value) => setDensity(value as Density)} className="grid-cols-3">
            {DENSITIES.map((density) => (
              <FieldLabel key={density.value} htmlFor={`${ids.density}-${density.value}`} className="items-stretch">
                <Field orientation="horizontal" className="items-start">
                  <FieldContent>
                    <FieldTitle>{density.title()}</FieldTitle>
                    <FieldDescription className="text-xs tabular-nums">{density.rows}</FieldDescription>
                    <div aria-hidden="true" className="mt-2 overflow-hidden rounded-md border text-xs">
                      {["18 Sep · Ha · 55", "24 Sep · OIII · 20", "26 Sep · OIII · 35"].map((row) => (
                        <div key={row} className={cn("flex items-center border-b px-2 text-muted-foreground tabular-nums last:border-0", density.rowClass)}>
                          {row}
                        </div>
                      ))}
                    </div>
                  </FieldContent>
                  <RadioGroupItem id={`${ids.density}-${density.value}`} value={density.value} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
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
          m.settings_restore_density({ name: m.settings_density_comfortable() }),
          m.palette_single_key_on(),
        ]}
        confirmLabel={m.settings_restore_defaults()}
        onConfirm={() => {
          setTheme(DEFAULTS.theme)
          setLocale(DEFAULTS.locale)
          setDensity(DEFAULTS.density)
          setSingleKeyShortcuts(DEFAULTS.singleKeyShortcuts)
        }}
      />
    </div>
  )
}
