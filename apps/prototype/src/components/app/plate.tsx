/**
 * Plate on a mount (HARNESS V1, from Direction B): a frame or product preview
 * sits on an always-dark plate inside a paper mat, with a catalogue caption
 * underneath. The caption carries values beside the source they were read
 * from (`300 s · EXPTIME`), so a value is never shown without its origin.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface PlateSource {
  value: ReactNode
  /** Where the value came from: a FITS keyword, "built-in", "imported", "manifest". */
  source: string
}

export interface PlateMountProps {
  /** Catalogue line: what the plate is (file, Target, channel). */
  caption: ReactNode
  /** Values with their source, shown as `value source` pairs under the caption. */
  sources?: PlateSource[]
  /** Status shown at the trailing end of the caption line (badges). */
  status?: ReactNode
  children: ReactNode
  /** "large" for the inspector preview, "thumb" for contact sheets and galleries. */
  size?: "large" | "thumb"
  /** Dims the plate (an excluded frame or an unavailable product) without hiding it. */
  dimmed?: boolean
  /** Render spans instead of figure/figcaption, for a plate inside a button (phrasing content only). */
  inline?: boolean
  className?: string
}

export function PlateMount({ caption, sources, status, children, size = "large", dimmed = false, inline = false, className }: PlateMountProps) {
  const Root = inline ? "span" : "figure"
  const Box = inline ? "span" : "div"
  const Caption = inline ? "span" : "figcaption"
  return (
    <Root
      data-slot="plate-mount"
      className={cn(
        "block min-w-0 rounded-[3px] bg-mount shadow-[inset_0_0_0_1px_var(--mount-edge),0_1px_2px_rgb(0_0_0/0.1)]",
        size === "large" ? "p-2.5 pb-2" : "p-1.5 pb-1",
        className,
      )}
    >
      <Box className={cn("relative block overflow-hidden rounded-[1px] bg-plate shadow-[0_0_0_1px_rgb(0_0_0/0.4)]", dimmed && "opacity-45")}>{children}</Box>
      <Caption className={cn("block min-w-0 px-0.5 leading-tight", size === "large" ? "mt-2 space-y-1 text-xs" : "mt-1 space-y-0.5 text-[0.6875rem]")}>
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate font-medium text-foreground">{caption}</span>
          {status ? <span className="flex shrink-0 items-center gap-1">{status}</span> : null}
        </span>
        {sources && sources.length > 0 ? (
          <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-muted-foreground">
            {sources.map((s) => (
              <span key={s.source} className="num whitespace-nowrap">
                <span className="text-foreground">{s.value}</span> <span className="font-mono text-[0.625rem] tracking-wide uppercase">{s.source}</span>
              </span>
            ))}
          </span>
        ) : null}
      </Caption>
    </Root>
  )
}