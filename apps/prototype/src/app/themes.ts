/**
 * Theme registry (foundation-owned). Names the themes for the picker and the
 * preference store; it carries no colour. Every theme maps the one token set:
 * the values live in `src/themes.css`, which `scripts/themes.mjs` generates
 * from each theme's published palette after raising tone and text tokens to
 * 4.5:1 on every surface (table: `design/themes-contrast.md`).
 *
 * Plain data with no imports, so the generator script can import it too.
 */
export type ThemeScheme = "dark" | "light"

export interface ThemeInfo {
  id: string
  /** The palette's published name, a proper noun: not translated, like a locale's native name. */
  name: string
  scheme: ThemeScheme
}

export const THEMES = [
  { id: "platevault-dark", name: "PlateVault Dark", scheme: "dark" },
  { id: "platevault-light", name: "PlateVault Light", scheme: "light" },
  { id: "gruvbox-dark", name: "Gruvbox Dark", scheme: "dark" },
  { id: "gruvbox-light", name: "Gruvbox Light", scheme: "light" },
  { id: "nord", name: "Nord", scheme: "dark" },
  { id: "dracula", name: "Dracula", scheme: "dark" },
  { id: "solarized-dark", name: "Solarized Dark", scheme: "dark" },
  { id: "solarized-light", name: "Solarized Light", scheme: "light" },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", scheme: "dark" },
  { id: "catppuccin-latte", name: "Catppuccin Latte", scheme: "light" },
  { id: "tokyo-night", name: "Tokyo Night", scheme: "dark" },
  { id: "one-dark", name: "One Dark", scheme: "dark" },
  { id: "rose-pine", name: "Rosé Pine", scheme: "dark" },
] as const satisfies readonly ThemeInfo[]

export type ThemeId = (typeof THEMES)[number]["id"]

export const DEFAULT_THEME: ThemeId = "platevault-dark"

/** "Match system" follows the OS between these two. */
export const SYSTEM_THEMES: Record<ThemeScheme, ThemeId> = { dark: "platevault-dark", light: "platevault-light" }

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}
