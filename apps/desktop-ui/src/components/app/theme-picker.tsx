/**
 * ThemePicker (plan §3.3 P14; user item 256): the mode first (Dark, Light,
 * Match system: the owner's order, as in HIGH-LEVEL-DESIGN.md), then the
 * themes of that mode. Match system picks two: a dark theme and a light
 * theme, which the app switches between as the OS does (round 11). Choices
 * apply at once (the document's `data-theme` and `dark` class) and persist
 * through `app/preferences.ts`.
 *
 * - `ThemePicker`: the Settings › Appearance form, a segmented mode control
 *   over live swatches of that mode's themes.
 * - `ThemeMenuItems`: the same choices as menu radio groups, for a toolbar
 *   menu's Theme submenu.
 *
 * Leaving Match system applies the pair's theme of the chosen mode. Between
 * Dark and Light, a switch keeps the theme family when it has the other
 * scheme (Gruvbox Dark ↔ Gruvbox Light); otherwise it applies the pair's
 * theme of that mode.
 */
import { Monitor, Moon, Sun } from "lucide-react"
import { Fragment, useId } from "react"
import { setSystemThemes, setTheme, type SystemThemes, type ThemePreference, useMessages, usePreferences } from "@/app/preferences"
import { THEMES, type ThemeId, type ThemeInfo, type ThemeScheme, themeInfo } from "@/app/themes"
import { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type ThemeMode = ThemeScheme | "system"

const MODES: ThemeMode[] = ["dark", "light", "system"]

/** Match system's two choices, in the modes' order. */
const SCHEMES: ThemeScheme[] = ["dark", "light"]

const MODE_ICON = { light: Sun, dark: Moon, system: Monitor } as const

function modeLabel(m: Messages, mode: ThemeMode): string {
  const label: Record<ThemeMode, () => string> = { light: m.theme_picker_light, dark: m.theme_picker_dark, system: m.shell_theme_match_system }
  return label[mode]()
}

function schemeThemeLabel(m: Messages, scheme: ThemeScheme): string {
  return scheme === "dark" ? m.theme_picker_dark_theme() : m.theme_picker_light_theme()
}

export function themeMode(theme: ThemePreference): ThemeMode {
  return theme === "system" ? "system" : themeInfo(theme).scheme
}

/** The id up to its last "-" names the family: gruvbox-dark and gruvbox-light, catppuccin-mocha and catppuccin-latte. */
function family(id: ThemeId): string {
  const cut = id.lastIndexOf("-")
  return cut > 0 ? id.slice(0, cut) : id
}

/** The theme choice as the picker reads it: the preference, the theme it applies and the Match system pair. */
interface ThemeChoice {
  theme: ThemePreference
  resolvedTheme: ThemeId
  systemThemes: SystemThemes
}

/** The preference after choosing `mode`, from the current choice. */
export function themeForMode({ theme, resolvedTheme, systemThemes }: ThemeChoice, mode: ThemeMode): ThemePreference {
  if (mode === "system") return "system"
  if (theme === "system") return systemThemes[mode]
  if (themeInfo(resolvedTheme).scheme === mode) return resolvedTheme
  return THEMES.find((option) => option.scheme === mode && family(option.id) === family(resolvedTheme))?.id ?? systemThemes[mode]
}

function themesOf(scheme: ThemeScheme): ThemeInfo[] {
  return THEMES.filter((theme) => theme.scheme === scheme)
}

/** A miniature window in a theme: source list with its selection, toolbar, text, a primary button and the four status tones. */
export function ThemeSwatch({ id, className }: { id: ThemeId; className?: string }) {
  return (
    <span aria-hidden="true" data-theme={id} className={cn("flex h-14 min-w-0 overflow-hidden rounded-sm border border-border bg-background", themeInfo(id).scheme === "dark" && "dark", className)}>
      <span className="flex w-1/4 flex-col gap-1 border-r border-separator bg-sidebar p-1">
        <span className="h-1.5 rounded-xs bg-sidebar-primary" />
        <span className="h-1 w-3/4 rounded-xs bg-sidebar-foreground/40" />
        <span className="h-1 w-2/3 rounded-xs bg-sidebar-foreground/40" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="h-2.5 border-b border-separator bg-chrome" />
        <span className="flex flex-1 flex-col gap-1 p-1.5">
          <span className="h-1 w-2/3 rounded-xs bg-foreground" />
          <span className="h-1 w-1/2 rounded-xs bg-muted-foreground" />
          <span className="mt-auto flex items-center gap-1">
            <span className="h-2 w-5 rounded-xs bg-primary" />
            <span className="size-1.5 rounded-full bg-success" />
            <span className="size-1.5 rounded-full bg-warning" />
            <span className="size-1.5 rounded-full bg-destructive" />
            <span className="size-1.5 rounded-full bg-info" />
          </span>
        </span>
      </span>
    </span>
  )
}

const OPTION = "flex cursor-default flex-col gap-1.5 rounded-lg border border-border p-1.5 hover:bg-foreground/5 has-data-checked:border-ring has-data-checked:bg-accent/40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"

/** One swatch column at least 9.5rem wide, or the whole box when it is narrower, so the grid never runs past its edge. */
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(9.5rem,100%),1fr))] gap-2"

/** One scheme's themes as swatch radios; `labelledBy` names the group when a visible heading does, else `label` does. */
function ThemeChoices({ scheme, value, onChange, label, labelledBy }: { scheme: ThemeScheme; value: ThemeId; onChange: (id: ThemeId) => void; label?: string; labelledBy?: string }) {
  return (
    <RadioGroup aria-label={label} aria-labelledby={labelledBy} value={value} onValueChange={(next) => onChange(next as ThemeId)} className={GRID} data-theme-choices={scheme}>
      {themesOf(scheme).map((option) => (
        <label key={option.id} className={OPTION} data-theme-option={option.id}>
          <ThemeSwatch id={option.id as ThemeId} />
          <span className="flex items-center gap-1.5 px-0.5 text-xs">
            <RadioGroupItem value={option.id} />
            <span className="truncate">{option.name}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
  )
}

/** Match system's pair: a dark theme and a light theme, each under its own heading. */
function SystemThemeChoices({ systemThemes }: { systemThemes: SystemThemes }) {
  const m = useMessages()
  const base = useId()
  return (
    <div className="flex flex-col gap-4">
      {SCHEMES.map((scheme) => (
        <div key={scheme} className="flex flex-col gap-2">
          <span id={`${base}${scheme}`} className="text-xs font-medium text-muted-foreground">
            {schemeThemeLabel(m, scheme)}
          </span>
          <ThemeChoices scheme={scheme} value={systemThemes[scheme]} onChange={(id) => setSystemThemes({ ...systemThemes, [scheme]: id })} labelledBy={`${base}${scheme}`} />
        </div>
      ))}
    </div>
  )
}

export function ThemePicker() {
  const m = useMessages()
  const choice = usePreferences()
  const mode = themeMode(choice.theme)
  return (
    // The full row: in a SettingsRow's wrapping flex line the picker would shrink to one swatch column.
    <div className="flex w-full min-w-0 flex-col gap-3" data-theme-picker={mode}>
      <ToggleGroup
        value={[mode]}
        onValueChange={(value) => value[0] && setTheme(themeForMode(choice, value[0] as ThemeMode))}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label={m.theme_picker_mode()}
        // In a narrow box the modes wrap onto a second line inside it, never past its edge.
        className="max-w-full flex-wrap gap-y-1"
      >
        {MODES.map((option) => {
          const Icon = MODE_ICON[option]
          return (
            <ToggleGroupItem key={option} value={option} data-theme-mode={option}>
              <Icon aria-hidden="true" data-icon="inline-start" />
              {modeLabel(m, option)}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
      {mode === "system" ? (
        <SystemThemeChoices systemThemes={choice.systemThemes} />
      ) : (
        <ThemeChoices scheme={mode} value={choice.resolvedTheme} onChange={setTheme} label={m.theme_picker_theme()} />
      )}
    </div>
  )
}

/** One menu radio group of a scheme's themes under its label. */
function ThemeMenuGroup({ scheme, label, value, onChange }: { scheme: ThemeScheme; label: string; value: ThemeId; onChange: (id: ThemeId) => void }) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as ThemeId)} data-theme-choices={scheme}>
        {themesOf(scheme).map((option) => (
          <DropdownMenuRadioItem key={option.id} value={option.id} data-theme-option={option.id}>
            {option.name}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  )
}

/** The mode, then the mode's themes (Match system: its dark and light theme) as menu radio groups; the host puts them in its Theme submenu. */
export function ThemeMenuItems() {
  const m = useMessages()
  const choice = usePreferences()
  const mode = themeMode(choice.theme)
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{m.theme_picker_mode()}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => setTheme(themeForMode(choice, value as ThemeMode))}>
          {MODES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} data-theme-mode={option}>
              {modeLabel(m, option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      {mode === "system" ? (
        SCHEMES.map((scheme) => (
          <Fragment key={scheme}>
            <DropdownMenuSeparator />
            <ThemeMenuGroup scheme={scheme} label={schemeThemeLabel(m, scheme)} value={choice.systemThemes[scheme]} onChange={(id) => setSystemThemes({ ...choice.systemThemes, [scheme]: id })} />
          </Fragment>
        ))
      ) : (
        <>
          <DropdownMenuSeparator />
          <ThemeMenuGroup scheme={mode} label={m.theme_picker_theme()} value={choice.resolvedTheme} onChange={setTheme} />
        </>
      )}
    </>
  )
}
