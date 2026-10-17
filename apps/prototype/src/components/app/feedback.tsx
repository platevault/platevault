/**
 * Feedback states (foundation-owned): empty, notices (offline, uncertain,
 * partial), errors next to the action, toasts, save state, unknown values
 * and structural skeletons. Conventions are in HIGH-LEVEL-DESIGN.md §9.
 *
 * One route per situation (R9-COMPOSITION-PLAN P7, C-5):
 * - action unavailable now: a focusable-disabled control in a BlockersPreview (previews.tsx);
 * - action refused on click: `Refusal` beside the control (refusal.tsx);
 * - field invalid: `ActionError` under the field;
 * - finished with an off-screen effect (trash, archive, rescan, import): `toast`;
 * - standing page state (offline location, closed project, read-only): a
 *   `PageNotice` in the template's notice slot, rendered by `NoticeSlot`.
 * Nothing is inserted above a list.
 */
import { CircleAlert, CircleHelp, Info, type LucideIcon, RotateCw, TriangleAlert, Unplug } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { CommitResult } from "@/store/core"
import type { Action } from "./contracts"
import { StatusBadge, type StatusValue, statusMeta } from "./status"

let liveRegion: HTMLElement | null = null
let pendingAnnouncement = 0

/**
 * Announce a status politely through the app's one persistent live region
 * (WCAG 4.1.3). Use it for status shown by an element that mounts with its
 * text: a live region born with content is not announced. Repeating the same
 * message announces it again.
 */
export function announce(message: string) {
  const region = liveRegion
  if (!region) return
  region.textContent = ""
  window.clearTimeout(pendingAnnouncement)
  pendingAnnouncement = window.setTimeout(() => {
    region.textContent = message
  }, 100)
}

/**
 * The persistent polite live region behind `announce`. RootLayout mounts it
 * once, before any dialog opens; Base UI keeps `[aria-live]` elements out of
 * a modal's inert outside, so announcements still reach users in a dialog.
 */
export function LiveAnnouncer() {
  return (
    <div
      ref={(node) => {
        liveRegion = node
        return () => {
          liveRegion = null
        }
      }}
      aria-live="polite"
      className="sr-only"
      data-live-announcer=""
    />
  )
}

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  /** Optional: an empty state is one line plus one action. */
  description?: ReactNode
  /** The one next action. Required: an empty state always says what to do. */
  action: ReactNode
  className?: string
  /** Heading element for the title: h3 inside a page section (default), h2 for a whole area, h1 for a whole page. */
  titleAs?: "h1" | "h2" | "h3"
}

export function EmptyState({ icon: Icon, title, description, action, className, titleAs: Title = "h3" }: EmptyStateProps) {
  return (
    <Empty className={cn("border border-dashed border-border py-8", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <Title className="text-sm font-medium text-balance">{title}</Title>
        {description ? <EmptyDescription className="text-pretty">{description}</EmptyDescription> : null}
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  )
}

/** A notice is standing state only: a refused action shows a `Refusal` beside its control, never a notice. */
export type NoticeTone = "info" | "offline" | "warning"

// Harness v4: an inline info bar (as in Xcode or Mail), tinted by tone, hairline edge, 5 px radius.
const NOTICE: Record<NoticeTone, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "border-border bg-foreground/[0.035] [&>svg]:text-info" },
  offline: { icon: Unplug, className: "border-warning/30 bg-warning/[0.07] [&>svg]:text-warning" },
  warning: { icon: TriangleAlert, className: "border-warning/30 bg-warning/[0.07] [&>svg]:text-warning" },
}

export interface NoticeProps {
  tone: NoticeTone
  title: string
  children?: ReactNode
  /** Recovery or alternative actions, e.g. Reconnect, Choose another location. */
  actions?: ReactNode
  className?: string
}

/** Inline callout for an offline, uncertain or partial state, with its recovery or alternative actions. */
export function Notice({ tone, title, children, actions, className }: NoticeProps) {
  const meta = NOTICE[tone]
  const Icon = meta.icon
  return (
    <Alert role="status" className={cn("rounded-md px-3 py-2", meta.className, className)}>
      <Icon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      {children ? <AlertDescription>{children}</AlertDescription> : null}
      {/* Actions sit outside the muted description so each keeps its own button style (no link underline). */}
      {actions ? <div className="flex flex-wrap gap-2 pt-1.5 group-has-[>svg]/alert:col-start-2">{actions}</div> : null}
    </Alert>
  )
}

/**
 * The template notice slot's contract: one standing page state, fixed under
 * the header (P7). Never the outcome of a click (toast), a refusal (Refusal)
 * or a field error (ActionError).
 */
export interface PageNotice {
  tone: NoticeTone
  /** "Location offline". */
  title: string
  detail?: ReactNode
  /** Recovery: Reconnect, Reopen project. */
  actions?: ReactNode
}

/** Renders a template's notice slot; nothing when the page has no standing state. */
export function NoticeSlot({ notice }: { notice?: PageNotice | null }) {
  if (!notice) return null
  return (
    <Notice tone={notice.tone} title={notice.title} actions={notice.actions}>
      {notice.detail}
    </Notice>
  )
}

/**
 * Toast for an operation that finished with an off-screen effect (trash,
 * archive, rescan, import), bottom trailing, announced politely. `action` is
 * the one follow-up (Undo, Show); the history lives in Activity.
 */
export function toast({ message, action }: { message: string; action?: Action }): void {
  showToast({ title: message, action: action ? { label: action.label, onClick: () => void action.run() } : undefined })
}

export interface ActionErrorProps {
  /** Names what failed and why. Never "Something went wrong". */
  message: string
  onRetry?: () => void
  /** Defaults to Retry. */
  retryLabel?: string
  className?: string
  id?: string
}

/** Error shown directly beside the control that triggered it. */
export function ActionError({ message, onRetry, retryLabel, className, id }: ActionErrorProps) {
  const m = useMessages()
  return (
    <div id={id} role="alert" className={cn("flex flex-wrap items-start gap-2 text-sm text-destructive", className)}>
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1 text-pretty">{message}</span>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden="true" data-icon="inline-start" />
          {retryLabel ?? m.verb_retry()}
        </Button>
      ) : null}
    </div>
  )
}

export interface SaveStateProps {
  state: StatusValue<"save">
  onRetry?: () => void
  onReview?: () => void
  /** Commit result message for failed or stale writes. */
  message?: string
}

/**
 * Durable-write status (D08). "Saved" only after a committed write; a failed
 * write stays "Not saved" with Retry; a stale edit offers the current revision.
 * Announced through `announce`: every change while mounted, and "Not saved" or
 * "Changed elsewhere" when it appears with them. "Unsaved changes" is never
 * announced (it follows the user's own typing), nor "Saved" on appearing.
 */
export function SaveState({ state, onRetry, onReview, message }: SaveStateProps) {
  const m = useMessages()
  const shown = useRef<StatusValue<"save"> | null>(null)
  useEffect(() => {
    const previous = shown.current
    shown.current = state
    if (state === "unsaved" || state === previous) return
    if (previous === null && state !== "failed" && state !== "stale") return
    const label = statusMeta("save", state).label
    announce(message && (state === "failed" || state === "stale") ? `${label}. ${message}` : label)
  }, [state, message])
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge kind="save" value={state} />
      {state === "failed" && onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden="true" data-icon="inline-start" />
          {m.verb_retry()}
        </Button>
      ) : null}
      {state === "stale" && onReview ? (
        <Button size="sm" variant="outline" onClick={onReview}>
          {m.save_review_current()}
        </Button>
      ) : null}
      {message && (state === "failed" || state === "stale") ? <p className="w-full text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}

/** What `useSaveState` shows: the last write's outcome, and how to retry a failed one. */
interface SaveOutcome {
  state: StatusValue<"save">
  message?: string
  retry?: () => void
}

export interface SaveStateHook {
  /** Runs one durable write (a store action) and records its outcome; returns the write's result. */
  save: (write: () => CommitResult | void) => CommitResult | void
  /** The section's `SaveState`; null before the first save, since nothing has been written from here yet. */
  indicator: ReactNode
}

/**
 * The save state of one settings section (D08): every change saves through
 * its store action at once. A write that succeeds reads "Saved"; a failed or
 * refused write stays "Not saved" with Retry, which runs the same write
 * again; a stale write reads "Changed elsewhere" with the commit message.
 */
export function useSaveState(): SaveStateHook {
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)
  function save(write: () => CommitResult | void): CommitResult | void {
    const result = write()
    if (!result || result.ok) setOutcome({ state: "saved" })
    else if (result.reason === "stale") setOutcome({ state: "stale", message: result.message })
    else setOutcome({ state: "failed", message: result.message, retry: () => void save(write) })
    return result
  }
  const indicator = outcome ? <SaveState state={outcome.state} message={outcome.message} onRetry={outcome.retry} /> : null
  return { save, indicator }
}

/**
 * Renders a value that is not known. Unknown is never shown as zero, empty
 * or absent. Standard labels: "Unknown", "Not measured", "Position unknown",
 * "FOV unknown", "Not set". A reason follows the label as visible text
 * ("FOV unknown · Equipment not confirmed"), never in a tooltip (§6.2).
 */
export function UnknownValue({ label, reason }: { label?: string; reason?: string }) {
  const m = useMessages()
  const word = label ?? m.status_unknown()
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <CircleHelp aria-hidden="true" className="size-3.5" />
      {reason ? `${word} · ${reason}` : word}
    </span>
  )
}

/** Structural loading placeholder for a table. */
export function TableSkeleton({ rows = 8, columns = 5, label }: { rows?: number; columns?: number; label: string }) {
  return (
    <div role="status" className="space-y-0 rounded-lg border">
      <span className="sr-only">{label}</span>
      <div className="flex gap-3 border-b px-3 py-2.5">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-(--row-h) items-center gap-3 border-b px-3 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3", c === 0 ? "w-1/4" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Structural loading placeholder for a detail pane. */
export function DetailSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-4 p-6">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <div className="grid grid-cols-2 gap-3 pt-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    </div>
  )
}
