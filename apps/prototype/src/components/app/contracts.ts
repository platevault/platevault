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
  /** Unavailable now: the trigger stays focusable but disabled and previews its blockers (BlockersPreview). */
  unavailable?: { action: string; reason: string; blockers: Blocker[] }
  /** Opens a ConfirmDialog before `run`. */
  confirm?: ConfirmSpec
  shortcut?: string
  /** More input follows, so menus add "…". */
  opensDialog?: boolean
}

export type MenuItem = Action | { separator: true } | { heading: string } | { submenu: string; items: MenuItem[] }

/** What stops an action or a step, and where it can be resolved. */
export interface Blocker {
  label: string
  link?: StepLink
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

/** One file an operation moves, copies, unlinks or trashes. */
export interface FileRow {
  file: string
  from: string
  to?: string
  action: "trash" | "move" | "unlink" | "copy"
  /** Bytes. */
  size: number
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

/** One DataTable column (P4). */
export interface Column<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /** Required unless `static`: a lint warning until W4, then a type error. */
  sortValue?: (row: T) => string | number | null
  /** A column with no order (row actions, a thumbnail), so it has no sort button. */
  static?: boolean
  align?: "left" | "right"
  /** DataTable-internal; features pass none. */
  className?: string
  /** Render this column's cell as the row header (`th scope="row"`). */
  rowHeader?: boolean
  /** Truncate long text (paths, names); the full text shows only when it is cut (§6.2 T2). */
  truncate?: boolean
}
