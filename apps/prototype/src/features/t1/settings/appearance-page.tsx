/**
 * Settings › Appearance (J10 S2, S9). Theme, density and single-key shortcuts
 * live in `src/app/preferences.ts`: they apply immediately, are stored in this
 * browser and survive Reset prototype data.
 */
import { type ReactNode, useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { type Density, setDensity, setSingleKeyShortcuts, setTheme, type ThemePreference, usePreferences } from "@/app/preferences"
import { cn } from "@/lib/utils"

const THEMES: Array<{ value: ThemePreference; title: string; description: string }> = [
  { value: "dark", title: "Dark", description: "Default. Low glare for night sessions." },
  { value: "light", title: "Light", description: "For daylight work and bright rooms." },
  { value: "system", title: "Match system", description: "Follows your operating system as it changes." },
]

const DENSITIES: Array<{ value: Density; title: string; description: string; rowClass: string }> = [
  { value: "compact", title: "Compact", description: "28 px rows. Most frames on screen.", rowClass: "h-7" },
  { value: "comfortable", title: "Comfortable", description: "32 px rows. Default.", rowClass: "h-8" },
  { value: "spacious", title: "Spacious", description: "40 px rows. Larger targets.", rowClass: "h-10" },
]

const DEFAULTS = { theme: "dark" as ThemePreference, density: "comfortable" as Density, singleKeyShortcuts: true }

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
  const ids = { theme: useId(), density: useId(), shortcuts: useId(), resetReason: useId() }
  const atDefaults = preferences.theme === DEFAULTS.theme && preferences.density === DEFAULTS.density && preferences.singleKeyShortcuts === DEFAULTS.singleKeyShortcuts

  return (
    <div>
      <PageHeader
        level={2}
        title="Appearance"
        description="Applies immediately and is stored in this browser. Resetting prototype data keeps these choices."
        actions={
          <div className="flex items-center gap-2">
            {atDefaults ? (
              <span id={ids.resetReason} className="text-xs text-muted-foreground">
                Appearance already uses the defaults.
              </span>
            ) : null}
            <Button variant="outline" disabled={atDefaults} aria-describedby={atDefaults ? ids.resetReason : undefined} onClick={() => setConfirmReset(true)}>
              Restore appearance defaults
            </Button>
          </div>
        }
      />
      <PageBody className="max-w-3xl">
        <Section title="Theme" id={ids.theme}>
          <RadioGroup aria-labelledby={`${ids.theme}-title`} value={preferences.theme} onValueChange={(value) => setTheme(value as ThemePreference)} className="grid-cols-3">
            {THEMES.map((theme) => (
              <ChoiceCard key={theme.value} id={`${ids.theme}-${theme.value}`} value={theme.value} title={theme.title} description={theme.description} />
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">
            Currently showing the {preferences.resolvedTheme} theme{preferences.theme === "system" ? ", from your system setting" : ""}.
          </p>
        </Section>

        <Section title="Density" id={ids.density} description="Row height in tables and lists. Text size stays the same.">
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

        <Section title="Keyboard" id={ids.shortcuts}>
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
      </PageBody>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Restore appearance defaults?"
        description="Only the appearance choices in this browser change."
        changes={["Theme becomes Dark", "Density becomes Comfortable", "Single-key shortcuts turn on"]}
        unchanged={["Locations, equipment, sites and every other library record", "Prototype data in this browser"]}
        confirmLabel="Restore defaults"
        onConfirm={() => {
          setTheme(DEFAULTS.theme)
          setDensity(DEFAULTS.density)
          setSingleKeyShortcuts(DEFAULTS.singleKeyShortcuts)
        }}
      />
    </div>
  )
}
