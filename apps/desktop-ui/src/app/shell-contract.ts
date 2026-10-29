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
 *
 * Pages reach the shell by registering their routes in `src/routes.tsx`; a
 * source-list row and its go-to key appear once their path is registered.
 * The Settings bead must register a bare `/settings` route (its layout or
 * index) as well as its sections: the Settings row and `G ,` open that path.
 */
import type { ComponentType } from "react"
import type { PaletteCommand } from "@/components/app/contracts"

/** What a contribution's `useCommands` knows about the palette. */
export interface PaletteState {
  open: boolean
}

export interface ShellContribution {
  /** Rendered in the sidebar footer, above Activity and Settings. */
  SidebarFooter?: ComponentType<{ collapsed: boolean }>
  /** Rendered once at the app root, for overlays such as the orientation walk. */
  Overlay?: ComponentType
  /**
   * Extra palette commands, called as a hook in a fixed order on every
   * render of the palette host. Group "Actions" joins the built-in Actions
   * group; any other group gets its own heading. `open` is false while the
   * palette is closed: read nothing then (`enabled: open` on a query) and
   * return no commands, so a closed palette costs no library reads.
   */
  useCommands?: (palette: PaletteState) => PaletteCommand[]
}

/** The review body of one session's intake Review step. */
export interface SessionReviewProps {
  sessionId: string
  /** The review finished: intake goes on past its Review step. */
  onFinished: () => void
  /**
   * Set while intake's Review step is locked behind an earlier step: marks and
   * Finish review are unavailable for `reason`, which names that step. Viewing,
   * navigation, filters, views, Compare and the corner inspector still work.
   */
  readOnly: { reason: string } | null
}

/** What the router hands the session intake page. */
export interface SessionIntakeProps {
  review: ComponentType<SessionReviewProps>
}
