/**
 * Lock: the padlock beside a row or category that is protected, with a
 * tooltip that says why (docs/adr/0002-lock-and-infotip-stay-separate.md).
 *
 * Labelled (the default): a focusable `role="note"` whose `aria-label` is the
 * reason, or "Protected" without one. The name is the only route to the text
 * for a screen reader, since the tooltip popup is portalled and mounted only
 * while open; `aria-label` on a role-less span is not reliably exposed, so the
 * role is load-bearing. `tabIndex={0}` makes the reason reachable by keyboard
 * (WCAG 2.1.1, 1.4.13).
 *
 * Decorative: `aria-hidden`, no role, no tab stop, no tooltip. Correct only
 * where the reason is already stated in nearby text AND is identical for every
 * instance (a table that states the rule once above its rows), so N rows do not
 * queue N identical announcements.
 *
 * Distinct from InfoTip, which carries help text and so has no decorative
 * mode; the ADR rejects merging the two.
 */
import { Lock as LockGlyph } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { cn } from "cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

type Side = "top" | "bottom" | "left" | "right"

export type LockProps =
  | {
      /** Why the thing is protected; the accessible name. Default "Protected". */
      reason?: string
      decorative?: false
      side?: Side
      className?: string
    }
  | {
      /** Pure decoration: the reason is in nearby text and the same for every instance. */
      decorative: true
      reason?: never
      side?: never
      className?: string
    }

// The same glyph geometry as HelpTip (components/app/tips.tsx): a 16 px glyph whose ::before widens the hit area to 24 px (WCAG 2.5.8).
const GLYPH = "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground"

export function Lock(props: LockProps) {
  const m = useMessages()
  const icon = <LockGlyph aria-hidden="true" className="size-3.5" />
  if (props.decorative) {
    return (
      <span aria-hidden="true" data-slot="lock" className={cn(GLYPH, props.className)}>
        {icon}
      </span>
    )
  }
  const label = props.reason ?? m.status_protected()
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="note" tabIndex={0} aria-label={label} data-slot="lock" className={cn(GLYPH, "before:absolute before:-inset-1 hover:text-foreground", props.className)} />}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side={props.side ?? "top"} className="max-w-64 text-pretty">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
