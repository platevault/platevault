/**
 * Shell preferences: theme (dark default, light, system), density, and
 * whether single-key shortcuts are on (WCAG 2.1.4). Stored outside the
 * prototype catalog so Reset keeps them; the pre-paint script in index.html
 * reads theme and density so the first frame is correct.
 */
import { useSyncExternalStore } from "react"

export type ThemePreference = "dark" | "light" | "system"
export type Density = "compact" | "comfortable" | "spacious"

const THEME_KEY = "platevault.theme"
const DENSITY_KEY = "platevault.density"
const SINGLE_KEY_SHORTCUTS_KEY = "platevault.singleKeyShortcuts"

interface Preferences {
  theme: ThemePreference
  density: Density
  /** The theme actually applied after resolving "system". */
  resolvedTheme: "dark" | "light"
  /** ?, /, [ and G-sequences. Modifier shortcuts such as ⌘K stay on. */
  singleKeyShortcuts: boolean
}

const listeners = new Set<() => void>()
const media = window.matchMedia("(prefers-color-scheme: dark)")

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function resolve(theme: ThemePreference): "dark" | "light" {
  if (theme === "system") return media.matches ? "dark" : "light"
  return theme
}

let current: Preferences = (() => {
  const theme = read<ThemePreference>(THEME_KEY, ["dark", "light", "system"], "dark")
  return {
    theme,
    density: read<Density>(DENSITY_KEY, ["compact", "comfortable", "spacious"], "comfortable"),
    resolvedTheme: resolve(theme),
    singleKeyShortcuts: read(SINGLE_KEY_SHORTCUTS_KEY, ["on", "off"], "on") === "on",
  }
})()

function apply() {
  const root = document.documentElement
  root.classList.toggle("dark", current.resolvedTheme === "dark")
  root.dataset.density = current.density
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (meta) meta.content = current.resolvedTheme
}

function update(next: Partial<Preferences>) {
  const theme = next.theme ?? current.theme
  current = { ...current, ...next, resolvedTheme: resolve(theme) }
  apply()
  for (const listener of listeners) listener()
}

// The OS theme can change at any time; "system" follows it live.
media.addEventListener("change", () => {
  if (current.theme === "system") update({})
})

export function setTheme(theme: ThemePreference) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Preference still applies for this session.
  }
  update({ theme })
}

export function setDensity(density: Density) {
  try {
    localStorage.setItem(DENSITY_KEY, density)
  } catch {
    // Preference still applies for this session.
  }
  update({ density })
}

export function setSingleKeyShortcuts(enabled: boolean) {
  try {
    localStorage.setItem(SINGLE_KEY_SHORTCUTS_KEY, enabled ? "on" : "off")
  } catch {
    // Preference still applies for this session.
  }
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

apply()
