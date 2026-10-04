/**
 * Shell extension points (foundation-owned contract). Each track exports one
 * `ShellContribution` from `src/features/<track>/shell.tsx`; the app shell
 * renders them in fixed places, so tracks never edit the shell itself.
 */
import type { ComponentType } from "react"

export interface PaletteCommand {
  id: string
  label: string
  /** Palette group heading, e.g. "Actions" or "Views". */
  group: string
  keywords?: string
  /** Hash route to open, or an action to run. */
  to?: string
  run?: () => void
}

export interface ShellContribution {
  /** Rendered in the sidebar footer above Activity and Settings. T1 uses it for Getting started. */
  SidebarFooter?: ComponentType<{ collapsed: boolean }>
  /** Rendered once at the app root, for overlays such as an orientation tour. */
  Overlay?: ComponentType
  /** Extra command palette entries. Called as a hook in a fixed order. */
  useCommands?: () => PaletteCommand[]
}
