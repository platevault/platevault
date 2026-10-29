/**
 * Shell preferences: theme (a registry theme or "system"), the light and
 * dark themes "system" switches between, language, and whether single-key
 * shortcuts are on (WCAG 2.1.4). Each applies at once and persists in
 * PlateVault's per-user settings store, outside every library (LIB-FR-21,
 * D-W166), through the library IPC. The store is the only copy. A save that
 * fails says so in a toast, and the choice applies until PlateVault restarts.
 *
 * The shell hands each webview the stored preferences before its page loads
 * (`window.__PLATEVAULT_PREFERENCES__`, `commands/appearance.rs`), so this
 * module reads them synchronously and the first frame paints with them.
 * Outside the desktop shell there is no store: a change applies for the
 * session only.
 *
 * The resolved theme is applied to the document root: `data-theme` selects
 * the theme's tokens (themes.css) and the `dark` class marks a dark theme for
 * the `dark:` variant (index.css). The saved language is the active
 * Paraglide locale: the "custom-preferences" strategy below hands it to
 * `m.*()`, and `useMessages()` re-renders a component when it changes.
 */
import { useSyncExternalStore } from "react"
import { type ActionResult, type AppearancePreferences, inShell, type LibraryFailure, library, type PreferenceChange, type PreferencesView } from "../api/ipc"
import { failureMessage } from "../components/app/run-result"
import { DEFAULT_LOCALE, isLocale, type Locale, m } from "../lib/i18n"
import { defineCustomClientStrategy } from "../paraglide/runtime"
import { DEFAULT_SYSTEM_THEMES, DEFAULT_THEME, type ThemeId, type ThemeScheme, themeInfo } from "./themes"

declare global {
  interface Window {
    /** The stored preferences, set by the shell before the page loads. */
    __PLATEVAULT_PREFERENCES__?: PreferencesView
  }
}

export type ThemePreference = ThemeId | "system"

/** The theme "system" applies while the OS is in each scheme. */
export type SystemThemes = Record<ThemeScheme, ThemeId>

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

type Chosen = Omit<Preferences, "resolvedTheme" | "scheme">

/** What Restore defaults sets: PlateVault Dark, the PlateVault pair, English (UK), shortcuts on. */
const DEFAULTS: Chosen = { theme: DEFAULT_THEME, systemThemes: DEFAULT_SYSTEM_THEMES, locale: DEFAULT_LOCALE, singleKeyShortcuts: true }

const listeners = new Set<() => void>()
const media = window.matchMedia("(prefers-color-scheme: dark)")

function chosen(stored: AppearancePreferences): Chosen {
  return {
    theme: stored.theme.mode === "system" ? "system" : stored.theme.theme,
    systemThemes: stored.systemThemes,
    locale: stored.language,
    singleKeyShortcuts: stored.singleKeyShortcuts,
  }
}

function snapshot({ theme, ...rest }: Chosen): Preferences {
  const resolvedTheme = theme === "system" ? rest.systemThemes[media.matches ? "dark" : "light"] : theme
  return { ...rest, theme, resolvedTheme, scheme: themeInfo(resolvedTheme).scheme }
}

const handed = window.__PLATEVAULT_PREFERENCES__
let current: Preferences = snapshot(handed ? chosen(handed.preferences) : DEFAULTS)

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

function update(next: Partial<Chosen>): void {
  const { theme, systemThemes, locale, singleKeyShortcuts } = { ...current, ...next }
  current = snapshot({ theme, systemThemes, locale, singleKeyShortcuts })
  apply()
  for (const listener of listeners) listener()
}

/** Store calls, one at a time in the order the changes were made. */
let saving: Promise<void> = Promise.resolve()
/** Set by the first change, after which the store's boot read no longer applies. */
let changed = false

function save(write: () => Promise<ActionResult<PreferencesView>>, what: string): void {
  changed = true
  if (!inShell()) return
  saving = saving.then(async () => {
    const result = await write()
    if (result.ok) return
    console.error(`PlateVault could not save the ${what} preference`, result.failure)
    await reportUnsaved(result.failure)
  })
}

/** A save that failed says why in a toast; the choice still applies until PlateVault restarts. */
async function reportUnsaved(failure: LibraryFailure): Promise<void> {
  // Loaded on demand: the toast's components read this module's hooks, so a static import would be a cycle.
  const { toast } = await import("../components/app/feedback")
  toast({ message: m.settings_preference_unsaved({ reason: failureMessage(m, failure) }) })
}

function change(next: Partial<Chosen>, stored: PreferenceChange): void {
  update(next)
  save(() => library.libraryChangePreference(stored), stored.field)
}

// The values handed at load are those of the webview's first page: after a
// reload they can trail the store, so the store's own read follows them up.
if (inShell()) {
  saving = saving.then(async () => {
    const result = await library.libraryPreferences()
    if (result.ok && !changed) update(chosen(result.data.preferences))
  })
}

// The OS theme can change at any time; "system" follows it live.
media.addEventListener("change", () => {
  if (current.theme === "system") update({})
})

export function setTheme(theme: ThemePreference): void {
  change({ theme }, { field: "theme", choice: theme === "system" ? { mode: "system" } : { mode: "fixed", theme } })
}

/** The pair "system" follows; it applies at once while the theme is "system". */
export function setSystemThemes(systemThemes: SystemThemes): void {
  change({ systemThemes }, { field: "systemThemes", themes: systemThemes })
}

export function setLocale(locale: Locale): void {
  change({ locale }, { field: "language", language: locale })
}

export function setSingleKeyShortcuts(enabled: boolean): void {
  change({ singleKeyShortcuts: enabled }, { field: "singleKeyShortcuts", enabled })
}

/** Restore defaults (LIB-FR-21): the theme, the "system" pair, the language and the shortcut preference. */
export function restoreDefaultPreferences(): void {
  update(DEFAULTS)
  save(() => library.libraryRestoreDefaultPreferences(), "default")
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
