/**
 * Shell preferences: theme (a registry theme or "system"), the light and
 * dark themes "system" switches between, language, and whether single-key
 * shortcuts are on (WCAG 2.1.4). Each applies at once and persists in this
 * webview's storage.
 *
 * The resolved theme is applied to the document root: `data-theme` selects
 * the theme's tokens (themes.css) and the `dark` class marks a dark theme for
 * the `dark:` variant (index.css). The saved language is the active
 * Paraglide locale: the "custom-preferences" strategy below hands it to
 * `m.*()`, and `useMessages()` re-renders a component when it changes.
 */
import { useSyncExternalStore } from "react"
import { DEFAULT_LOCALE, isLocale, type Locale, m } from "../lib/i18n"
import { defineCustomClientStrategy } from "../paraglide/runtime"
import { DEFAULT_SYSTEM_THEMES, DEFAULT_THEME, isThemeId, type ThemeId, type ThemeScheme, themeInfo } from "./themes"

export type ThemePreference = ThemeId | "system"

/** The theme "system" applies while the OS is in each scheme. */
export type SystemThemes = Record<ThemeScheme, ThemeId>

const THEME_KEY = "platevault.theme"
const LOCALE_KEY = "platevault.locale"
const SYSTEM_THEME_KEY: Record<ThemeScheme, string> = { dark: "platevault.systemTheme.dark", light: "platevault.systemTheme.light" }
const SINGLE_KEY_SHORTCUTS_KEY = "platevault.singleKeyShortcuts"

export interface Preferences {
  theme: ThemePreference
  /** The theme actually applied after resolving "system". */
  resolvedTheme: ThemeId
  systemThemes: SystemThemes
  /** Dark or light, from the resolved theme. */
  scheme: ThemeScheme
  locale: Locale
  /** ?, /, [, G-sequences and Space on a table row. Modifier shortcuts such as ⌘K stay on. */
  singleKeyShortcuts: boolean
}

const listeners = new Set<() => void>()
const media = window.matchMedia("(prefers-color-scheme: dark)")

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Storage may be unavailable in test or restricted webview contexts.
    return null
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The preference still applies for this session.
  }
}

function readTheme(): ThemePreference {
  const value = stored(THEME_KEY)
  if (value === "system") return "system"
  return value && isThemeId(value) ? value : DEFAULT_THEME
}

/** Saved system pair; a theme of the wrong scheme, or none, reads as the PlateVault one. */
function readSystemThemes(): SystemThemes {
  const pick = (scheme: ThemeScheme): ThemeId => {
    const value = stored(SYSTEM_THEME_KEY[scheme])
    return value && isThemeId(value) && themeInfo(value).scheme === scheme ? value : DEFAULT_SYSTEM_THEMES[scheme]
  }
  return { dark: pick("dark"), light: pick("light") }
}

function snapshot(theme: ThemePreference, rest: Omit<Preferences, "theme" | "resolvedTheme" | "scheme">): Preferences {
  const resolvedTheme = theme === "system" ? rest.systemThemes[media.matches ? "dark" : "light"] : theme
  return { ...rest, theme, resolvedTheme, scheme: themeInfo(resolvedTheme).scheme }
}

let current: Preferences = (() => {
  const locale = stored(LOCALE_KEY)
  return snapshot(readTheme(), {
    systemThemes: readSystemThemes(),
    locale: locale && isLocale(locale) ? locale : DEFAULT_LOCALE,
    singleKeyShortcuts: stored(SINGLE_KEY_SHORTCUTS_KEY) !== "off",
  })
})()

// The strategy chain is declared in vite.config.ts and the i18n:compile script:
// this preference first, then the base locale. Paraglide calls `setLocale`
// once on its first resolution, with the locale it just read here.
defineCustomClientStrategy("custom-preferences", {
  getLocale: () => current.locale,
  setLocale: (locale) => {
    if (isLocale(locale) && locale !== current.locale) setLocale(locale)
  },
})

function apply(): void {
  const root = document.documentElement
  root.dataset.theme = current.resolvedTheme
  root.classList.toggle("dark", current.scheme === "dark")
  root.lang = current.locale
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (meta) meta.content = current.scheme
}

function update(next: Partial<Omit<Preferences, "resolvedTheme" | "scheme">>): void {
  const { theme, systemThemes, locale, singleKeyShortcuts } = { ...current, ...next }
  current = snapshot(theme, { systemThemes, locale, singleKeyShortcuts })
  apply()
  for (const listener of listeners) listener()
}

// The OS theme can change at any time; "system" follows it live.
media.addEventListener("change", () => {
  if (current.theme === "system") update({})
})

export function setTheme(theme: ThemePreference): void {
  store(THEME_KEY, theme)
  update({ theme })
}

/** The pair "system" follows; it applies at once while the theme is "system". */
export function setSystemThemes(systemThemes: SystemThemes): void {
  store(SYSTEM_THEME_KEY.dark, systemThemes.dark)
  store(SYSTEM_THEME_KEY.light, systemThemes.light)
  update({ systemThemes })
}

export function setLocale(locale: Locale): void {
  store(LOCALE_KEY, locale)
  update({ locale })
}

export function setSingleKeyShortcuts(enabled: boolean): void {
  store(SINGLE_KEY_SHORTCUTS_KEY, enabled ? "on" : "off")
  update({ singleKeyShortcuts: enabled })
}

/** Current preferences, for event handlers outside React. */
export function getPreferences(): Preferences {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, () => current)
}

/** One catalogue object per locale: `m` changes identity with the language, as a hook's value should. */
const catalogues = new Map<Locale, typeof m>()

/**
 * The message catalogue for a component: `const m = useMessages()`, then
 * `m.nav_home()`. The caller re-renders when the language changes, which a
 * bare `m` import does not do, and gets that language's own object, so a
 * memo or effect that lists `m` as a dependency re-runs and re-words its copy.
 */
export function useMessages(): typeof m {
  const locale = useSyncExternalStore(subscribe, () => current.locale)
  let catalogue = catalogues.get(locale)
  if (!catalogue) {
    catalogue = { ...m }
    catalogues.set(locale, catalogue)
  }
  return catalogue
}

apply()
