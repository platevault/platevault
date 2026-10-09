/**
 * Settings › Appearance (J10 S2, S9). Theme, language, density and
 * single-key shortcuts live in `src/app/preferences.ts`: they apply
 * immediately, are stored in this browser and survive Reset prototype data.
 * The theme and language pickers are the foundation's (`src/app/appearance.tsx`).
 */
import { type ReactNode, useId, useState } from "react"
import { LanguagePicker, ThemePicker } from "@/app/appearance"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { type Density, setDensity, setLocale, setSingleKeyShortcuts, setTheme, type ThemePreference, usePreferences } from "@/app/preferences"
import { DEFAULT_THEME } from "@/app/themes"
import { DEFAULT_LOCALE } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const DENSITIES: Array<{ value: Density; title: string; description: string; rowClass: string }> = [
  { value: "compact", title: "Compact", description: "28 px rows. Most frames on screen.", rowClass: "h-7" },
  { value: "comfortable", title: "Comfortable", description: "32 px rows. Default.", rowClass: "h-8" },
  { value: "spacious", title: "Spacious", description: "40 px rows. Larger targets.", rowClass: "h-10" },
]

const DEFAULTS = { theme: DEFAULT_THEME as ThemePreference, locale: DEFAULT_LOCALE, density: "comfortable" as Density, singleKeyShortcuts: true }

function ChoiceCard({ id, value, title, description, children }: { id: string; value: string; title: string; description: string; children?: ReactNode }) {
  return (
    <FieldLabel htmlFor={id} className="items-stretch">
      <Field orientation="horizontal" className="items-start">
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          <FieldDescription className="text-xs">{description}</FieldDescription>
          {children}
        </FieldContent>
        <RadioGroupItem id={id} value={value} />
      </Field>
    </FieldLabel>
  )
}

export function AppearancePage() {
  const preferences = usePreferences()
  const [confirmReset, setConfirmReset] = useState(false)
  const ids = { theme: useId(), language: useId(), density: useId(), shortcuts: useId(), resetReason: useId() }
  const atDefaults =
    preferences.theme === DEFAULTS.theme && preferences.locale === DEFAULTS.locale && preferences.density === DEFAULTS.density && preferences.singleKeyShortcuts === DEFAULTS.singleKeyShortcuts

  return (
    <div>
      <PageHeader
        level={2}
        title="Appearance"
        description="Applies immediately and is stored in this browser. Resetting prototype data keeps these choices."
      />
      <PageBody>
        <Section title="Theme" level={3} id={ids.theme}>
          <ThemePicker />
        </Section>

        <Section title="Language" level={3} id={ids.language}>
          <LanguagePicker />
        </Section>

        <Section title="Density" level={3} id={ids.density} description="Row height in tables and lists. Text size stays the same.">
          <RadioGroup aria-labelledby={`${ids.density}-title`} value={preferences.density} onValueChange={(value) => setDensity(value as Density)} className="grid-cols-3">
            {DENSITIES.map((density) => (
              <ChoiceCard key={density.value} id={`${ids.density}-${density.value}`} value={density.value} title={density.title} description={density.description}>
                <div aria-hidden="true" className="mt-2 overflow-hidden rounded-md border text-xs">
                  {["18 Sep · Ha · 55", "24 Sep · OIII · 20", "26 Sep · OIII · 35"].map((row) => (
                    <div key={row} className={cn("flex items-center border-b px-2 text-muted-foreground tabular-nums last:border-0", density.rowClass)}>
                      {row}
                    </div>
                  ))}
                </div>
              </ChoiceCard>
            ))}
          </RadioGroup>
        </Section>

        <Section title="Keyboard" level={3} id={ids.shortcuts}>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <label htmlFor={`${ids.shortcuts}-switch`} className="text-sm font-medium">
                Single-key shortcuts
              </label>
              <p id={`${ids.shortcuts}-hint`} className="text-xs text-muted-foreground">
                ?, /, [ and G sequences. Turn off if they clash with speech input or other tools. ⌘K and Ctrl+K always work.
              </p>
            </div>
            <Switch
              id={`${ids.shortcuts}-switch`}
              aria-describedby={`${ids.shortcuts}-hint`}
              checked={preferences.singleKeyShortcuts}
              onCheckedChange={(checked) => setSingleKeyShortcuts(checked)}
            />
          </div>
        </Section>

        <Section title="Defaults" level={3} id="appearance-defaults">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" disabled={atDefaults} aria-describedby={atDefaults ? ids.resetReason : undefined} onClick={() => setConfirmReset(true)}>
              Restore appearance defaults
            </Button>
            {atDefaults ? (
              <span id={ids.resetReason} className="text-xs text-muted-foreground">
                Appearance already uses the defaults.
              </span>
            ) : null}
          </div>
        </Section>
      </PageBody>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Restore appearance defaults?"
        description="Only the appearance choices in this browser change."
        changes={["Theme becomes PlateVault Dark", "Language becomes English (UK)", "Density becomes Comfortable", "Single-key shortcuts turn on"]}
        unchanged={["Locations, equipment, sites and every other library record", "Prototype data in this browser"]}
        confirmLabel="Restore defaults"
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
