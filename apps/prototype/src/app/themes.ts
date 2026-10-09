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
  label: string
  scheme: ThemeScheme
}

export const THEMES = [
  { id: "platevault-dark", label: "PlateVault Dark", scheme: "dark" },
  { id: "platevault-light", label: "PlateVault Light", scheme: "light" },
  { id: "gruvbox-dark", label: "Gruvbox Dark", scheme: "dark" },
  { id: "gruvbox-light", label: "Gruvbox Light", scheme: "light" },
  { id: "nord", label: "Nord", scheme: "dark" },
  { id: "dracula", label: "Dracula", scheme: "dark" },
  { id: "solarized-dark", label: "Solarized Dark", scheme: "dark" },
  { id: "solarized-light", label: "Solarized Light", scheme: "light" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", scheme: "dark" },
  { id: "catppuccin-latte", label: "Catppuccin Latte", scheme: "light" },
  { id: "tokyo-night", label: "Tokyo Night", scheme: "dark" },
  { id: "one-dark", label: "One Dark", scheme: "dark" },
  { id: "rose-pine", label: "Rosé Pine", scheme: "dark" },
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
