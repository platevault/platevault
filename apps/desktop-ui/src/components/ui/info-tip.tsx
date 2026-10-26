/**
 * InfoTip: the ⓘ that carries help text for a form or settings row, text
 * that appears nowhere else on screen (docs/adr/0002-lock-and-infotip-stay-separate.md).
 *
 * A focusable `role="note"` named "<label>: <tip>", label defaulting to
 * "More information". The tooltip popup is portalled and mounted only while
 * open, so the name is the only route to the text for a screen reader; the
 * role is what exposes `aria-label` on a span. `tip` is a string, not a node,
 * because only a string can be mirrored into the name.
 *
 * It has no decorative mode, and must not gain one: its text is the sole
 * carrier of the information. Lock, which marks protected state, keeps its
 * own decorative mode; the ADR rejects merging the two.
 *
 * HelpTip (components/app/tips.tsx) is the other ⓘ, with another contract: a
 * button named "Help" by default and described by a hidden copy of its tip, which may
 * hold markup. A screen uses HelpTip, under tooltip policy T4, since features
 * import nothing from components/ui (I5). InfoTip is the primitive an
 * app-layer field or settings row composes when a plain-text tip should be
 * the glyph's own name.
 */
import { Info } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { cn } from "cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

export interface InfoTipProps {
  /** The help text, shown on hover or focus and mirrored into the accessible name. */
  tip: string
  /** The name's prefix; default "More information". */
  label?: string
  side?: "top" | "bottom" | "left" | "right"
  className?: string
}

export function InfoTip({ tip, label, side = "top", className }: InfoTipProps) {
  const m = useMessages()
  const name = m.info_tip_name({ label: label ?? m.info_tip_more_information(), tip })
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="note"
            tabIndex={0}
            aria-label={name}
            data-slot="info-tip"
            // The same glyph geometry as HelpTip (components/app/tips.tsx): a 16 px glyph whose ::before widens the hit area to 24 px (WCAG 2.5.8).
            className={cn("relative inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground before:absolute before:-inset-1 hover:text-foreground", className)}
          />
        }
      >
        <Info aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-64 text-pretty">
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}
