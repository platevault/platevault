/**
 * Pills and count badges (foundation primitives): the shared bubble
 * vocabulary for channels, bands, kinds and counts.
 *
 * - Pill: an inert, tone-tinted rounded tag (C-9). It is never a control:
 *   navigation is a link button or a tab, an action is a Button, and data
 *   behind a pill goes in a HoverCard preview (components/app/previews.tsx).
 *   Tone text over its own 12% tint keeps 4.5:1 on every surface of every
 *   theme (design/themes-contrast.md).
 * - CountBadge: a small number, capped at 99+, with an optional
 *   screen-reader label so the count is part of the parent's name.
 *
 * State is never colour alone: a status reads through StatusBadge.
 */
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { Tone } from "./status"

const PILL = "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset [&>svg]:size-3 [&>svg]:shrink-0"

const PILL_TONE: Record<Tone, string> = {
  neutral: "bg-muted text-foreground ring-border",
  muted: "bg-muted text-muted-foreground ring-border",
  info: "bg-info/12 text-info ring-info/30",
  success: "bg-success/12 text-success ring-success/30",
  warning: "bg-warning/12 text-warning ring-warning/30",
  danger: "bg-destructive/12 text-destructive ring-destructive/30",
}

/** The Pill API: an inert tag, no interactive props. */
export interface PillProps {
  tone?: Tone
  icon?: LucideIcon
  children: ReactNode
  /** The full text when the label truncates; not a tooltip for extra data. */
  title?: string
  className?: string
}

export function Pill({ tone = "neutral", icon: Icon, children, title, className }: PillProps) {
  return (
    <span className={cn(PILL, PILL_TONE[tone], className)} title={title} data-pill={tone}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </span>
  )
}

const BADGE_TONE: Record<Tone, string> = {
  neutral: "bg-foreground/10 text-foreground",
  muted: "bg-foreground/10 text-muted-foreground",
  info: "bg-info/16 text-info",
  success: "bg-success/16 text-success",
  warning: "bg-warning/16 text-warning",
  danger: "bg-destructive/16 text-destructive",
}

export function CountBadge({ count, tone = "neutral", max = 99, label, className }: { count: number; tone?: Tone; max?: number; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[0.6875rem] leading-none font-semibold tabular-nums", BADGE_TONE[tone], className)} data-count-badge={tone}>
      <span aria-hidden={label ? true : undefined}>{count > max ? `${max}+` : count}</span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}
