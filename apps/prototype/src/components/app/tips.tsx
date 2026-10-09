/**
 * Help and note markers (foundation primitives), both tooltips on a small
 * focusable glyph, so screens carry no explanatory paragraphs:
 * - HelpTip: an ⓘ for the rare rule that truly needs explaining. Default to none.
 * - NoteMarker: the ① beside a measured value; its tooltip carries the
 *   method, basis and time, as short label and value rows.
 */
import { Info } from "lucide-react"
import type { ReactNode } from "react"
import { useT } from "@/app/preferences"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const GLYPH_BUTTON = "inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"

export function HelpTip({ children, label, side = "top", className }: { children: ReactNode; label?: string; side?: "top" | "bottom" | "left" | "right"; className?: string }) {
  const t = useT()
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label ?? t("Help")} className={cn(GLYPH_BUTTON, "size-4 align-middle", className)} />}>
        <Info aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-64 text-pretty">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

export interface NoteRow {
  label: string
  value: ReactNode
}

/**
 * ① beside a value. Pass `rows` for method, basis and time ("Method",
 * "PlateVault PSF (Moffat β=4)"), or `children` for one short line.
 */
export function NoteMarker({ n = 1, rows, children, label, className }: { n?: number; rows?: NoteRow[]; children?: ReactNode; label?: string; className?: string }) {
  const t = useT()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label ?? `${t("Note")} ${n}`}
            className={cn(GLYPH_BUTTON, "size-3.5 border border-current align-super text-[0.5625rem] leading-none font-semibold tabular-nums", className)}
          />
        }
      >
        <span aria-hidden="true">{n}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        {rows ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="opacity-75">{row.label}</dt>
                <dd className="tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          children
        )}
      </TooltipContent>
    </Tooltip>
  )
}
