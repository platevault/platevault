/**
 * Appearance pickers (foundation-owned): the theme picker with live
 * swatches and the language picker. Settings › Appearance mounts both; the
 * page layout around them belongs to that screen. Choices apply at once and
 * persist in this browser (`src/app/preferences.ts`).
 *
 * A swatch paints a miniature window with the theme's own tokens: the
 * `[data-theme]` attribute scopes that theme's custom properties to it.
 */
import { Pill } from "@/components/app/pill"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { LOCALE_META, LOCALES, type Locale, needsReviewNotice } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { setLocale, setTheme, type ThemePreference, useMessages, usePreferences } from "./preferences"
import { SYSTEM_THEMES, THEMES, type ThemeId, themeInfo } from "./themes"

const OPTION = "flex cursor-default flex-col gap-1.5 rounded-md border border-border p-1.5 hover:bg-accent/60 has-data-checked:border-ring has-data-checked:bg-accent/40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"

/** A miniature window in a theme: source list with its selection, toolbar, text, a primary button and the four status tones. */
export function ThemeSwatch({ id, className }: { id: ThemeId; className?: string }) {
  return (
    <span aria-hidden="true" data-theme={id} className={cn("flex h-14 min-w-0 overflow-hidden rounded-sm border border-border bg-background", themeInfo(id).scheme === "dark" && "dark", className)}>
      <span className="flex w-1/4 flex-col gap-1 border-r border-separator bg-sidebar p-1">
        <span className="h-1.5 rounded-[1px] bg-sidebar-primary" />
        <span className="h-1 w-3/4 rounded-[1px] bg-sidebar-foreground/40" />
        <span className="h-1 w-2/3 rounded-[1px] bg-sidebar-foreground/40" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="h-2.5 border-b border-separator bg-chrome" />
        <span className="flex flex-1 flex-col gap-1 p-1.5">
          <span className="h-1 w-2/3 rounded-[1px] bg-foreground" />
          <span className="h-1 w-1/2 rounded-[1px] bg-muted-foreground" />
          <span className="mt-auto flex items-center gap-1">
            <span className="h-2 w-5 rounded-[2px] bg-primary" />
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

export function ThemePicker({ className }: { className?: string }) {
  const m = useMessages()
  const { theme } = usePreferences()
  return (
    <RadioGroup aria-label={m.shell_theme()} value={theme} onValueChange={(value) => setTheme(value as ThemePreference)} className={cn("grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]", className)}>
      {THEMES.map((option) => (
        <label key={option.id} className={OPTION} data-theme-option={option.id}>
          <ThemeSwatch id={option.id} />
          <span className="flex items-center gap-1.5 px-0.5 text-xs">
            <RadioGroupItem value={option.id} />
            <span className="truncate">{option.name}</span>
          </span>
        </label>
      ))}
      <label className={OPTION} data-theme-option="system">
        <span className="flex gap-1">
          <ThemeSwatch id={SYSTEM_THEMES.dark} className="flex-1" />
          <ThemeSwatch id={SYSTEM_THEMES.light} className="flex-1" />
        </span>
        <span className="flex items-center gap-1.5 px-0.5 text-xs">
          <RadioGroupItem value="system" />
          <span className="truncate">{m.shell_theme_match_system()}</span>
        </span>
      </label>
    </RadioGroup>
  )
}

/**
 * One choice per shipped locale, named in its own language (the accessible
 * name); the flag is decoration, and a machine-generated catalogue says so.
 */
export function LanguagePicker({ className }: { className?: string }) {
  const m = useMessages()
  const { locale } = usePreferences()
  return (
    <RadioGroup aria-label={m.shell_language()} value={locale} onValueChange={(value) => setLocale(value as Locale)} className={cn("w-fit gap-1", className)}>
      {LOCALES.map((id) => (
        <label key={id} className="flex h-(--row-h) cursor-default items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/60">
          <RadioGroupItem value={id} />
          <span aria-hidden="true">{LOCALE_META[id].flag}</span>
          <span lang={id}>{LOCALE_META[id].nativeName}</span>
          {needsReviewNotice(id) ? <Pill tone="muted">{m.locale_machine_generated()}</Pill> : null}
        </label>
      ))}
    </RadioGroup>
  )
}
