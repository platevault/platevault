/**
 * Help and note markers (foundation primitives), both tooltips on a small
 * focusable glyph, so screens carry no explanatory paragraphs:
 * - HelpTip: an ⓘ for the rare rule that truly needs explaining. Default to none.
 * - NoteMarker: the ① beside a measured value; its tooltip carries the
 *   method, basis and time, as short label and value rows.
 *
 * The tooltip's text is also the glyph's description: a hidden copy that
 * stays in the DOM while the tooltip is closed, so a screen reader reads it
 * on focus (WCAG 1.3.1, 4.1.2). A NoteMarker's name starts with its number
 * (WCAG 2.5.3), and the hit area is 24 px around the small glyph (WCAG 2.5.8).
 */
import { Info } from "lucide-react"
import { Fragment, type ReactNode, useId } from "react"
import { createPortal } from "react-dom"
import { useMessages } from "@/app/preferences"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// A ::before pseudo-element widens the hit area to 24 px square (its inset counts from inside the border)
// without moving the glyph or its neighbours.
const GLYPH_BUTTON = "relative inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground before:absolute hover:text-foreground"

type Side = "top" | "bottom" | "left" | "right"

function GlyphTip({ name, glyph, tip, description, side, className, contentClassName }: { name: string; glyph: ReactNode; tip: ReactNode; description: ReactNode; side?: Side; className: string; contentClassName: string }) {
  const descriptionId = useId()
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={name} aria-describedby={descriptionId} className={className} />}>{glyph}</TooltipTrigger>
      <TooltipContent side={side} className={contentClassName}>
        {tip}
      </TooltipContent>
      {/* In the body, so the copy neither nests in the button (content may hold a control) nor sits in the caller's layout; hidden, so nothing in it takes focus. */}
      {createPortal(
        <span id={descriptionId} hidden>
          {description}
        </span>,
        document.body,
      )}
    </Tooltip>
  )
}

export function HelpTip({ children, label, side = "top", className }: { children: ReactNode; label?: string; side?: Side; className?: string }) {
  const m = useMessages()
  return (
    <GlyphTip
      name={label ?? m.tips_help()}
      glyph={<Info aria-hidden="true" className="size-3.5" />}
      tip={children}
      description={children}
      side={side}
      className={cn(GLYPH_BUTTON, "size-4 align-middle before:-inset-1", className)}
      contentClassName="max-w-64 text-pretty"
    />
  )
}

export interface NoteRow {
  label: string
  value: ReactNode
}

/**
 * ① beside a value. Pass `rows` for method, basis and time ("Method",
 * "PlateVault PSF (Moffat β=4)"), or `children` for one short line.
 * `label` names what the note is about ("FWHM source"); the accessible name
 * puts the number first ("Note 1: FWHM source").
 */
export function NoteMarker({ n = 1, rows, children, label, className }: { n?: number; rows?: NoteRow[]; children?: ReactNode; label?: string; className?: string }) {
  const m = useMessages()
  return (
    <GlyphTip
      name={label ? m.tips_note_named({ number: n, label }) : m.tips_note({ number: n })}
      glyph={<span aria-hidden="true">{n}</span>}
      tip={
        rows ? (
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
        )
      }
      description={
        rows
          ? rows.map((row, index) => (
              <Fragment key={row.label}>
                {`${index > 0 ? "; " : ""}${row.label}: `}
                {row.value}
              </Fragment>
            ))
          : children
      }
      className={cn(GLYPH_BUTTON, "size-3.5 border border-current align-super text-[0.5625rem] leading-none font-semibold tabular-nums before:-inset-1.5", className)}
      contentClassName="max-w-72"
    />
  )
}
