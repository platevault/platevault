/**
 * Refusal (P7): the terse line shown beside the control whose action was
 * refused, `<Action> blocked · <reason> ▸` or `Can't <verb> · <reason> ▸`.
 * The blockers, each linked to where it can be resolved, and any actions
 * that resolve them open in a BlockersPreview hover card on the reason, so
 * nothing is inserted into the page and nothing moves. Never one long
 * semicolon line, never above a list.
 *
 *   <Refusal action="Can't remove rig" reason="used by 6 runs" blockers={runs.map(…)} />
 *   <Refusal {...refusalFrom(m, failure, "Can't remove rig")} />
 */
import { OctagonX } from "lucide-react"
import type { ReactNode } from "react"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Blocker } from "./contracts"
import { BlockersPreview } from "./previews"
import { failureMessage, type RunFailure } from "./run-result"

export interface RefusalProps {
  /** "Can't remove rig". */
  action: string
  /** "used by 6 runs". */
  reason: string
  blockers: Blocker[]
  className?: string
  /** A refusal shown as standing state (an action that is unavailable while it renders), not the outcome of a click: no alert role, so it is not announced on load. */
  standing?: boolean
  /** Buttons that resolve the refusal, shown in the hover card after the blockers. */
  actions?: ReactNode
}

export function Refusal({ action, reason, blockers, className, standing = false, actions }: RefusalProps) {
  return (
    <div role={standing ? undefined : "alert"} className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm", className)} data-refusal>
      <OctagonX aria-hidden="true" className="size-3.5 shrink-0 text-destructive" />
      <span className="font-medium">{action}</span>
      <span aria-hidden="true" className="text-muted-foreground">
        ·
      </span>
      <BlockersPreview action={action} reason={reason} blockers={blockers} actions={actions} />
    </div>
  )
}

/** Refusal props from a refused run: the library's failure, worded, is the reason; it names no blocker list. */
export function refusalFrom(m: Messages, failure: RunFailure, action: string): RefusalProps {
  return { action, reason: failureMessage(m, failure), blockers: [] }
}
