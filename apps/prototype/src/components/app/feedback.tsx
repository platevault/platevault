/**
 * Feedback states (foundation-owned): empty, notices (offline, uncertain,
 * partial, refusal), errors next to the action, save state, unknown values
 * and structural skeletons. Conventions are in HIGH-LEVEL-DESIGN.md §9.
 */
import { CircleAlert, CircleHelp, Info, type LucideIcon, OctagonX, RotateCw, TriangleAlert, Unplug } from "lucide-react"
import { type ReactNode, useEffect, useRef } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
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
  description: ReactNode
  /** The one next action. Required: an empty state always says what to do. */
  action: ReactNode
  className?: string
  /** Heading element for the title: h3 inside a page section (default), h2 for a whole area, h1 for a whole page. */
  titleAs?: "h1" | "h2" | "h3"
}

export function EmptyState({ icon: Icon, title, description, action, className, titleAs: Title = "h3" }: EmptyStateProps) {
  return (
    <Empty className={cn("border border-dashed py-10", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <Title className="text-sm font-medium text-balance">{title}</Title>
        <EmptyDescription className="text-pretty">{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  )
}

export type NoticeTone = "info" | "offline" | "warning" | "refusal"

const NOTICE: Record<NoticeTone, { icon: LucideIcon; className: string; role: "status" | "alert" }> = {
  info: { icon: Info, className: "border-border", role: "status" },
  offline: { icon: Unplug, className: "border-warning/40 [&>svg]:text-warning", role: "status" },
  warning: { icon: TriangleAlert, className: "border-warning/40 [&>svg]:text-warning", role: "status" },
  refusal: { icon: OctagonX, className: "border-destructive/50 [&>svg]:text-destructive", role: "alert" },
}

export interface NoticeProps {
  tone: NoticeTone
  title: string
  children?: ReactNode
  /** Recovery or alternative actions, e.g. Reconnect, Choose another location. */
  actions?: ReactNode
  className?: string
}

/**
 * Inline callout for offline, uncertain, partial and refused states. A
 * refusal names what was refused, why, and the supported alternatives.
 */
export function Notice({ tone, title, children, actions, className }: NoticeProps) {
  const meta = NOTICE[tone]
  const Icon = meta.icon
  return (
    <Alert role={meta.role} className={cn("px-3 py-2.5", meta.className, className)}>
      <Icon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      {children || actions ? (
        <AlertDescription className="space-y-2">
          {children ? <div>{children}</div> : null}
          {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
        </AlertDescription>
      ) : null}
    </Alert>
  )
}

export interface ActionErrorProps {
  /** Names what failed and why. Never "Something went wrong". */
  message: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
  id?: string
}

/** Error shown directly beside the control that triggered it. */
export function ActionError({ message, onRetry, retryLabel = "Retry", className, id }: ActionErrorProps) {
  return (
    <div id={id} role="alert" className={cn("flex flex-wrap items-start gap-2 text-sm text-destructive", className)}>
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1 text-pretty">{message}</span>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden="true" data-icon="inline-start" />
          {retryLabel}
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
          Retry
        </Button>
      ) : null}
      {state === "stale" && onReview ? (
        <Button size="sm" variant="outline" onClick={onReview}>
          Review current revision
        </Button>
      ) : null}
      {message && (state === "failed" || state === "stale") ? <p className="w-full text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}

/**
 * Renders a value that is not known. Unknown is never shown as zero, empty
 * or absent. Standard labels: "Unknown", "Not measured", "Position unknown",
 * "FOV unknown", "Not set". A reason makes it a button (the tooltip trigger)
 * named "label: reason", so keyboard, pointer and screen-reader users all
 * reach the reason (WCAG 4.1.2).
 */
export function UnknownValue({ label = "Unknown", reason }: { label?: string; reason?: string }) {
  const content = (
    <>
      <CircleHelp aria-hidden="true" className="size-3.5" />
      {label}
      {reason ? <span className="sr-only">: {reason}</span> : null}
    </>
  )
  if (!reason) return <span className="inline-flex items-center gap-1 text-muted-foreground">{content}</span>
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="inline-flex cursor-help items-center gap-1 rounded-sm text-left text-muted-foreground underline decoration-dotted underline-offset-2"
      >
        {content}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
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
