/**
 * Shared contract types of the composed components (lead-owned; design/
 * R9-COMPOSITION-PLAN.md §3.3, §7.7). Types only: W1 units build ActionBar,
 * RowActions, DataTable, FilterBar, ConfirmDialog and StepFlow against these
 * shapes, so the patterns agree before any of them exists. Plain data plus
 * ReactNode slots, so the contracts survive a stack change (§3.6).
 *
 * `Blocker` and `Column` move here from refusal.tsx and data-table.tsx when
 * their W1 owners switch those files to this one.
 */
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { StepLink } from "@/domain/derive"
import type { OpticalTrainId } from "@/domain/types"
import type { CommitResult } from "@/store/core"

/** One visible style per role. "destructive" is for irreversible actions only and is never primary. */
export type ActionKind = "primary" | "standard" | "destructive"

/** One user action. It renders the same as a header button, a named pull-down item, a row ⋯ item, a context-menu item and a palette command (P1). */
export interface Action {
  id: string
  label: string
  icon?: LucideIcon
  /** Default "standard". The kind decides the variant, never the flow position. */
  kind?: ActionKind
  run: () => CommitResult | void | Promise<CommitResult | void>
  /** Unavailable now: the trigger stays focusable but disabled and previews its blockers (BlockersPreview); with `columns`, as a table. */
  unavailable?: { action: string; reason: string; blockers: Blocker[]; columns?: BlockerColumns }
  /** Opens a ConfirmDialog before `run`. */
  confirm?: ConfirmSpec
  shortcut?: string
  /** More input follows, so menus add "…". */
  opensDialog?: boolean
  /** An owner-ticked action's two forms under the prototype's Quick actions switch. Without it, the action runs the same in both modes. */
  quick?: QuickAction
}

/** The Undo notice of a one-click action: what happened, and the action's existing inverse. */
export interface QuickUndo {
  /** The outcome: "M 31 LRGB restored". */
  message: string
  run: () => CommitResult | void
}

/**
 * How an action the owner ticked runs in each mode of the Quick actions
 * switch. Every runner (`useAction`) applies it, so pages declare both forms
 * and never read the switch.
 */
export interface QuickAction {
  /**
   * One-click: `run` commits in place, without its `confirm`. `undo` is
   * called just before `run`, so it captures the state its Undo restores; the
   * notice shows once `run` succeeds. A refresh (a re-read or a recompute)
   * offers no Undo.
   */
  oneClick: { undo: () => QuickUndo } | { refresh: true }
  /**
   * Open page: "keep" keeps the action as declared on the page that owns it,
   * its `confirm` included. A link, for an action placed elsewhere, opens the
   * owning page or flow at the item instead of running here; while it only
   * navigates, `unavailable` does not apply. With `commit`, `run` commits
   * first and the link shows the result in its flow (a session ticked on the
   * run's Select step).
   */
  openPage: "keep" | { link: StepLink; commit?: boolean }
}

export type MenuItem = Action | { separator: true } | { heading: string } | { submenu: string; items: MenuItem[] }

/** What stops an action or a step, and where it can be resolved. */
export interface Blocker {
  label: string
  link?: StepLink
  /** The place that holds it ("Cygnus HOO 2026"): the text `link` shows in a blocker table's second column. */
  where?: string
}

/** The headers of a blocker table, item · where ▸ ("Session · Project", P7): BlockersPreview then lists the blockers as one. */
export interface BlockerColumns {
  item: string
  where: string
}

/** The ConfirmDialog an action opens before it runs (P8). */
export interface ConfirmSpec {
  /** Verb plus object: "Move 14 files to Trash?". */
  title: string
  /** "1.2 GB · 2 locations". */
  summary?: string
  /** File lists that fold out one level. */
  groups?: { label: string; rows: FileRow[]; defaultOpen?: boolean }[]
  confirm: { label: string; kind?: ActionKind }
}

/** One file an operation moves, copies, unlinks or trashes, or one it keeps where it is ("keep": a run's Products on Finish run). */
export interface FileRow {
  file: string
  from: string
  to?: string
  action: "trash" | "move" | "unlink" | "copy" | "keep"
  /** Bytes. */
  size: number
  /** The file's identity, where the review must name it (CAL-FR-17: a master's Move to Trash). */
  sha256?: string
  /** A per-file refusal or note: "Read-only", "Linked by NGC 7000 OIII deep ▸". */
  status?: { label: string; link?: StepLink }
}

/** One step of a staged flow (P11). */
export interface FlowStep {
  id: string
  label: string
  state: "todo" | "current" | "finished" | "skipped" | "blocked" | "redo"
  optional?: boolean
  /** An unmet gate keeps Proceed focusable but disabled: "Proceed blocked · 2 unresolved ▸". */
  gate?: { reason: string; blockers: Blocker[] } | null
  summary?: string
}

/** A staged flow: the StepStrip under the header and the StepFooter with Skip · Proceed. */
export interface StepFlow {
  steps: FlowStep[]
  /** The id of the current step. */
  current: string
  /** Later steps are viewable but read-only until the earlier ones finish. */
  ordered: boolean
  /** Label "Proceed", or the flow's terminal verb on the last step ("Finish run…"). Null once the flow is finished: the footer shows the viewed step's summary only. */
  proceed: Action | null
  /** Where the host navigates after `proceed.run` succeeds; null stays (the page turns read-only). */
  next: StepLink | null
  /** Optional steps only. */
  skip?: Action
  reopen?: (stepId: string) => Action
  /** Route of each step; absent for flows whose steps are local state (FormDialog steps). */
  linkFor?: (stepId: string) => StepLink
}

/** One named filter of a FilterBar: a single select with "All {label}" first, or a multi-select (P5). Controlled: the host owns `value`. */
export interface Facet {
  id: string
  label: string
  kind: "single" | "multi"
  options: { value: string; label: string; count?: number }[]
  value: string | string[]
}

/** One entry of a FilterBar's Presets ▾ menu; the host applies it. */
export interface Preset {
  id: string
  label: string
  /** "builtin" ships with the product; "custom" was saved by the user and can be deleted. */
  source: "builtin" | "custom"
  /** Why the preset cannot apply now ("Needs a rig"), shown in the menu. */
  unavailable?: string
}

/** One DataTable column (P4): sortable through `sortValue`, or `static`. */
export type Column<T> = ColumnBase<T> &
  (
    | {
        /** The column's order: every data column sorts. */
        sortValue: (row: T) => string | number | null
        static?: false
      }
    | {
        sortValue?: undefined
        /** A column with no order (row actions, a thumbnail), so it has no sort button. */
        static: true
      }
  )

interface ColumnBase<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  align?: "left" | "right"
  /** DataTable-internal; features pass none. */
  className?: string
  /** Render this column's cell as the row header (`th scope="row"`). */
  rowHeader?: boolean
  /** Truncate long text (paths, names); the full text shows only when it is cut (§6.2 T2). */
  truncate?: boolean
  /**
   * The user can hide it from the table's Columns menu. The row header always shows, so a `rowHeader` column
   * is never hideable and never listed.
   */
  hideable?: boolean
  /** A hideable column that starts hidden, until the user shows it from the Columns menu. */
  defaultHidden?: boolean
}

/**
 * The session intake Review step's body (P-REV2, C14): the review workspace
 * for one session. The intake StepPage (P3) hosts it with `fill`; P4
 * implements it (`SessionReview`), and the route injects it.
 */
export interface SessionReviewProps {
  sessionId: string
  /** The host's Finish review; the workspace's Finish command (⌘↵) calls it once no frame is Unreviewed. */
  onFinished?: () => void
}

/**
 * "Add {value} to {rig}" in a session (PLAN-EQ-FR-04, D-W127): what Settings ›
 * Equipment offers for a FILTER value no filter of the session's confirmed rig
 * matches. Each filter record that already matches it, from another rig, is
 * offered as "Add {filter}" and reused; then a new filter, through the filter
 * dialog prefilled with the value and the bands it likely passes. The intake
 * Rig step (P3) hosts it; slice E implements it (`AddFilterToRig`), and the
 * route injects it.
 */
export interface AddFilterToRigProps {
  /** The unknown FILTER value and the rig it goes onto; null while there is none, and the prompt offers nothing. */
  unknown: { value: string; rigId: OpticalTrainId } | null
  /** Renders the host's action bar with the prompt's actions. */
  children: (actions: Action[]) => ReactNode
  /** Where focus goes once the filter is on the rig: adding removes the prompt that was used. */
  focusAfterAdd: () => HTMLElement | null
}
