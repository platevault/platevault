/**
 * The shell's extension points (shell-owned contract).
 *
 * - `ShellContribution`: each feature area exports one from
 *   `src/features/<area>/shell.tsx`, and `contributions.ts` lists it. The
 *   shell renders the parts in fixed places, so a feature never edits the
 *   shell. A feature's entity search (Projects, Targets, sessions) and its
 *   row Actions reach the palette through `useCommands`, built with
 *   `actionCommand` (components/app/actions.tsx) from the same `Action` its
 *   rows show, so a palette entry and its row item share one descriptor.
 * - `SessionReviewProps` and `SessionIntakeProps`: session intake (Library)
 *   shows the review workspace (Review) on its Review step. Features never
 *   import each other (I6), so the router passes the review body into the
 *   intake page.
 */
import type { ComponentType } from "react"
import type { PaletteCommand } from "@/components/app/contracts"

export interface ShellContribution {
  /** Rendered in the sidebar footer, above Activity and Settings. */
  SidebarFooter?: ComponentType<{ collapsed: boolean }>
  /** Rendered once at the app root, for overlays such as the orientation walk. */
  Overlay?: ComponentType
  /** Extra palette commands, called as a hook in a fixed order. Group "Actions" joins the built-in Actions group; any other group gets its own heading. */
  useCommands?: () => PaletteCommand[]
}

/** The review body of one session's intake Review step. */
export interface SessionReviewProps {
  sessionId: string
  /** The review finished: intake goes on past its Review step. */
  onFinished: () => void
}

/** What the router hands the session intake page. */
export interface SessionIntakeProps {
  review: ComponentType<SessionReviewProps>
}
