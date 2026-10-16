/**
 * ThemePicker (plan §3.3 P14; user item 256): the mode first (Light, Dark,
 * Match system), then the themes of that mode. Choices apply at once and
 * persist in this browser (`app/preferences.ts`).
 *
 * - `ThemePicker`: the Settings › Appearance form, a segmented mode control
 *   over live swatches of that mode's themes.
 * - `ThemeMenuItems`: the same two choices as menu radio groups, for a
 *   toolbar menu's Theme submenu.
 *
 * Switching mode keeps the theme family when it has the other scheme
 * (Gruvbox Dark ↔ Gruvbox Light); otherwise it falls back to the PlateVault
 * theme of that mode. Match system follows the OS between the two
 * PlateVault themes (`SYSTEM_THEMES`).
 */
import { Monitor, Moon, Sun } from "lucide-react"
import { setTheme, type ThemePreference, useMessages, usePreferences } from "@/app/preferences"
import { SYSTEM_THEMES, THEMES, type ThemeId, type ThemeInfo, type ThemeScheme, themeInfo } from "@/app/themes"
import { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type ThemeMode = ThemeScheme | "system"

const MODES: ThemeMode[] = ["light", "dark", "system"]

const MODE_ICON = { light: Sun, dark: Moon, system: Monitor } as const

function modeLabel(m: Messages, mode: ThemeMode): string {
  const label: Record<ThemeMode, () => string> = { light: m.theme_picker_light, dark: m.theme_picker_dark, system: m.shell_theme_match_system }
  return label[mode]()
}

export function themeMode(theme: ThemePreference): ThemeMode {
  return theme === "system" ? "system" : themeInfo(theme).scheme
}

/** The id up to its last "-" names the family: gruvbox-dark and gruvbox-light, catppuccin-mocha and catppuccin-latte. */
function family(id: ThemeId): string {
  const cut = id.lastIndexOf("-")
  return cut > 0 ? id.slice(0, cut) : id
}

/** The preference after choosing `mode`, from the theme now applied. */
export function themeForMode(resolved: ThemeId, mode: ThemeMode): ThemePreference {
  if (mode === "system") return "system"
  if (themeInfo(resolved).scheme === mode) return resolved
  return THEMES.find((theme) => theme.scheme === mode && family(theme.id) === family(resolved))?.id ?? SYSTEM_THEMES[mode]
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

export function ThemePicker() {
  const m = useMessages()
  const { theme, resolvedTheme } = usePreferences()
  const mode = themeMode(theme)
  return (
    <div className="flex flex-col gap-3" data-theme-picker={mode}>
      <ToggleGroup
        value={[mode]}
        onValueChange={(value) => value[0] && setTheme(themeForMode(resolvedTheme, value[0] as ThemeMode))}
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
        // One fixed pair: a preview of what the OS switches between, not a choice.
        <div className={GRID}>
          <div className="flex flex-col gap-1.5 rounded-lg border border-border p-1.5" data-theme-option="system">
            <span className="flex gap-1">
              <ThemeSwatch id={SYSTEM_THEMES.dark} className="flex-1" />
              <ThemeSwatch id={SYSTEM_THEMES.light} className="flex-1" />
            </span>
            <span className="truncate px-0.5 text-xs text-muted-foreground">{`${themeInfo(SYSTEM_THEMES.dark).name} · ${themeInfo(SYSTEM_THEMES.light).name}`}</span>
          </div>
        </div>
      ) : (
        <RadioGroup aria-label={m.theme_picker_theme()} value={theme} onValueChange={(value) => setTheme(value as ThemeId)} className={GRID}>
          {themesOf(mode).map((option) => (
            <label key={option.id} className={OPTION} data-theme-option={option.id}>
              <ThemeSwatch id={option.id as ThemeId} />
              <span className="flex items-center gap-1.5 px-0.5 text-xs">
                <RadioGroupItem value={option.id} aria-label={option.name} />
                <span className="truncate">{option.name}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      )}
    </div>
  )
}

/** The mode and the mode's themes as menu radio groups; the host puts them in its Theme submenu. */
export function ThemeMenuItems() {
  const m = useMessages()
  const { theme, resolvedTheme } = usePreferences()
  const mode = themeMode(theme)
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{m.theme_picker_mode()}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => setTheme(themeForMode(resolvedTheme, value as ThemeMode))}>
          {MODES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} data-theme-mode={option}>
              {modeLabel(m, option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      {mode === "system" ? null : (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{m.theme_picker_theme()}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeId)}>
              {themesOf(mode).map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id} data-theme-option={option.id}>
                  {option.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </>
      )}
    </>
  )
}
