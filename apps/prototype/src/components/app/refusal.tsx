/**
 * Refusal (foundation primitive): a terse line, `<Action> blocked · <count>
 * <reason>`, with a disclosure that lists each blocker as a chip, linked to
 * where it can be resolved. Never one long semicolon line.
 *
 *   <Refusal action="Can't remove rig" reason="used by 6 runs" blockers={runs.map(…)} />
 *   <Refusal {...refusalFrom(result, "Can't remove rig")} />
 */
import { ChevronRight, OctagonX } from "lucide-react"
import { useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import type { StepLink } from "@/domain/derive"
import { m } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { CommitResult } from "@/store/core"
import { Pill } from "./pill"

export interface Blocker {
  label: string
  /** Where the blocker can be resolved. */
  link?: StepLink
}

export interface RefusalProps {
  /** "Can't remove rig". */
  action: string
  /** "used by 6 runs". */
  reason: string
  blockers: Blocker[]
  className?: string
}

export function Refusal({ action, reason, blockers, className }: RefusalProps) {
  // The same catalogue as the module `m`, subscribed so the words follow a language change.
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const panel = useId()
  return (
    <div role="alert" className={cn("space-y-1.5 text-sm", className)} data-refusal>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
        <OctagonX aria-hidden="true" className="size-3.5 shrink-0 text-destructive" />
        <span className="font-medium">{action}</span>
        <span className="text-muted-foreground">· {reason}</span>
        {blockers.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-5 items-center rounded-sm px-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <ChevronRight aria-hidden="true" className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
            <span className="sr-only">{open ? m.refusal_hide_details() : m.refusal_details()}</span>
          </button>
        ) : null}
      </div>
      {blockers.length > 0 && open ? (
        <ul id={panel} className="flex flex-wrap gap-1 pl-5">
          {blockers.map((b) => (
            <li key={b.label}>
              <Pill tone="neutral" link={b.link}>
                {b.label}
              </Pill>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Refusal props from a refused store action: its reasons become the blocker chips. Null for any other result. */
export function refusalFrom(result: CommitResult | null, action: string, links: Record<string, StepLink> = {}): RefusalProps | null {
  if (!result || result.ok || result.reason !== "refused") return null
  return { action, reason: m.refusal_blockers({ count: result.reasons.length }), blockers: result.reasons.map((label) => ({ label, link: links[label] })) }
}
