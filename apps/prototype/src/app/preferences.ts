/**
 * Shell preferences: theme (a registry theme or "system"), the light and
 * dark themes "system" switches between, language, and whether single-key
 * shortcuts are on (WCAG 2.1.4). Stored outside the prototype catalog so
 * Reset keeps them; the pre-paint script in index.html reads theme, scheme,
 * the system pair and language so the first frame is correct.
 *
 * The saved language is the active Paraglide locale: the "custom-preferences"
 * strategy below hands it to `m.*()`, and `useMessages()` re-renders a
 * component when it changes.
 */
import { useSyncExternalStore } from "react"
import { DEFAULT_LOCALE, isLocale, type Locale, m } from "@/lib/i18n"
import { defineCustomClientStrategy } from "@/paraglide/runtime"
import { DEFAULT_SYSTEM_THEMES, DEFAULT_THEME, isThemeId, type ThemeId, type ThemeScheme, themeInfo } from "./themes"

export type ThemePreference = ThemeId | "system"

/** The theme "system" applies while the OS is in each scheme. */
export type SystemThemes = Record<ThemeScheme, ThemeId>

const THEME_KEY = "platevault.theme"
/** The resolved theme's scheme, so the pre-paint script can set `html.dark` without the registry. */
const SCHEME_KEY = "platevault.themeScheme"
const LOCALE_KEY = "platevault.locale"
const SYSTEM_THEME_KEY: Record<ThemeScheme, string> = { dark: "platevault.systemTheme.dark", light: "platevault.systemTheme.light" }
const SINGLE_KEY_SHORTCUTS_KEY = "platevault.singleKeyShortcuts"

interface Preferences {
  theme: ThemePreference
  /** The theme actually applied after resolving "system". */
  resolvedTheme: ThemeId
  systemThemes: SystemThemes
  /** Dark or light, from the resolved theme. */
  scheme: ThemeScheme
  locale: Locale
  /** ?, /, [, G-sequences and Space on a table row (P-KBD1). Modifier shortcuts such as ⌘K stay on. */
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
  if (value === "dark" || value === "light") return DEFAULT_SYSTEM_THEMES[value]
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
    singleKeyShortcuts: read(SINGLE_KEY_SHORTCUTS_KEY, ["on", "off"], "on") === "on",
  })
})()

// The strategy chain is declared in vite.config.ts and the i18n:compile script:
// this preference first, then the en-GB base locale. Paraglide calls
// `setLocale` once on its first resolution, with the locale it just read here.
defineCustomClientStrategy("custom-preferences", {
  getLocale: () => current.locale,
  setLocale: (locale) => {
    if (isLocale(locale) && locale !== current.locale) setLocale(locale)
  },
})

function apply() {
  const root = document.documentElement
  root.dataset.theme = current.resolvedTheme
  root.classList.toggle("dark", current.scheme === "dark")
  root.lang = current.locale
  store(SCHEME_KEY, current.scheme)
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (meta) meta.content = current.scheme
}

function update(next: Partial<Omit<Preferences, "resolvedTheme" | "scheme">>) {
  const { theme, systemThemes, locale, singleKeyShortcuts } = { ...current, ...next }
  current = snapshot(theme, { systemThemes, locale, singleKeyShortcuts })
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

/** The pair "system" follows; it applies at once while the theme is "system". */
export function setSystemThemes(systemThemes: SystemThemes) {
  store(SYSTEM_THEME_KEY.dark, systemThemes.dark)
  store(SYSTEM_THEME_KEY.light, systemThemes.light)
  update({ systemThemes })
}

export function setLocale(locale: Locale) {
  store(LOCALE_KEY, locale)
  update({ locale })
}

export function setSingleKeyShortcuts(enabled: boolean) {
  store(SINGLE_KEY_SHORTCUTS_KEY, enabled ? "on" : "off")
  update({ singleKeyShortcuts: enabled })
}

/** Current preferences, for event handlers outside React. */
export function getPreferences(): Preferences {
  return current
}

function subscribe(listener: () => void) {
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
