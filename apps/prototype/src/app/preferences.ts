/**
 * Shell preferences: theme (a registry theme or "system"), language, density,
 * and whether single-key shortcuts are on (WCAG 2.1.4). Stored outside the
 * prototype catalog so Reset keeps them; the pre-paint script in index.html
 * reads theme, scheme and density so the first frame is correct.
 */
import { useSyncExternalStore } from "react"
import { DEFAULT_LOCALE, isLocale, type Locale, translate } from "@/lib/i18n"
import { DEFAULT_THEME, isThemeId, SYSTEM_THEMES, type ThemeId, type ThemeScheme, themeInfo } from "./themes"

export type ThemePreference = ThemeId | "system"
export type Density = "compact" | "comfortable" | "spacious"

const THEME_KEY = "platevault.theme"
/** The resolved theme's scheme, so the pre-paint script can set `html.dark` without the registry. */
const SCHEME_KEY = "platevault.themeScheme"
const LOCALE_KEY = "platevault.locale"
const DENSITY_KEY = "platevault.density"
const SINGLE_KEY_SHORTCUTS_KEY = "platevault.singleKeyShortcuts"

interface Preferences {
  theme: ThemePreference
  /** The theme actually applied after resolving "system". */
  resolvedTheme: ThemeId
  /** Dark or light, from the resolved theme. */
  scheme: ThemeScheme
  locale: Locale
  density: Density
  /** ?, /, [ and G-sequences. Modifier shortcuts such as ⌘K stay on. */
  singleKeyShortcuts: boolean
}

const listeners = new Set<() => void>()
const media = window.matchMedia("(prefers-color-scheme: dark)")

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preference still applies for this session.
  }
}

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = stored(key)
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Saved theme; v4's "dark" and "light" read as the PlateVault themes. */
function readTheme(): ThemePreference {
  const value = stored(THEME_KEY)
  if (value === "system") return "system"
  if (value === "dark" || value === "light") return SYSTEM_THEMES[value]
  return value && isThemeId(value) ? value : DEFAULT_THEME
}

function resolve(theme: ThemePreference): ThemeId {
  return theme === "system" ? SYSTEM_THEMES[media.matches ? "dark" : "light"] : theme
}

function snapshot(theme: ThemePreference, rest: Omit<Preferences, "theme" | "resolvedTheme" | "scheme">): Preferences {
  const resolvedTheme = resolve(theme)
  return { ...rest, theme, resolvedTheme, scheme: themeInfo(resolvedTheme).scheme }
}

let current: Preferences = (() => {
  const locale = stored(LOCALE_KEY)
  return snapshot(readTheme(), {
    locale: locale && isLocale(locale) ? locale : DEFAULT_LOCALE,
    density: read<Density>(DENSITY_KEY, ["compact", "comfortable", "spacious"], "comfortable"),
    singleKeyShortcuts: read(SINGLE_KEY_SHORTCUTS_KEY, ["on", "off"], "on") === "on",
  })
})()

function apply() {
  const root = document.documentElement
  root.dataset.theme = current.resolvedTheme
  root.classList.toggle("dark", current.scheme === "dark")
  root.dataset.density = current.density
  root.lang = current.locale
  store(SCHEME_KEY, current.scheme)
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (meta) meta.content = current.scheme
}

function update(next: Partial<Omit<Preferences, "resolvedTheme" | "scheme">>) {
  const { theme, ...rest } = { ...current, ...next }
  current = snapshot(theme, { locale: rest.locale, density: rest.density, singleKeyShortcuts: rest.singleKeyShortcuts })
  apply()
  for (const listener of listeners) listener()
}

// The OS theme can change at any time; "system" follows it live.
media.addEventListener("change", () => {
  if (current.theme === "system") update({})
})

export function setTheme(theme: ThemePreference) {
  store(THEME_KEY, theme)
  update({ theme })
}

export function setLocale(locale: Locale) {
  store(LOCALE_KEY, locale)
  update({ locale })
}

export function setDensity(density: Density) {
  store(DENSITY_KEY, density)
  update({ density })
}

export function setSingleKeyShortcuts(enabled: boolean) {
  store(SINGLE_KEY_SHORTCUTS_KEY, enabled ? "on" : "off")
  update({ singleKeyShortcuts: enabled })
}

/** Current preferences, for event handlers outside React. */
export function getPreferences(): Preferences {
  return current
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => current,
  )
}

export type Translate = (source: string, vars?: Record<string, string | number>) => string

/**
 * The string-table helper bound to the chosen language: `t("Issues")`,
 * `t("{n} offline", { n })`. The key is the en-GB source string; a string
 * with no translation reads in en-GB (see `src/lib/i18n.ts`).
 */
export function useT(): Translate {
  const { locale } = usePreferences()
  return (source, vars) => translate(locale, source, vars)
}

/** The same helper outside React (event handlers, announcements). */
export function t(source: string, vars?: Record<string, string | number>): string {
  return translate(current.locale, source, vars)
}

apply()
