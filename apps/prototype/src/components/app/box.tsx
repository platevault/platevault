/**
 * Box (foundation primitive): a hairline group panel with an optional small
 * heading and actions, used instead of separator text. Never nested: a Box
 * inside a Box loses its frame (index.css), as group boxes do.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface BoxProps {
  title?: ReactNode
  /** Heading level of the title; 3 inside a page section. */
  level?: 2 | 3 | 4
  actions?: ReactNode
  /** Drop the body padding for a table or list that fills the box. */
  flush?: boolean
  id?: string
  className?: string
  children: ReactNode
}

export function Box({ title, level = 3, actions, flush = false, id, className, children }: BoxProps) {
  const Heading = `h${level}` as const
  return (
    <section data-slot="box" aria-labelledby={title && id ? `${id}-title` : undefined} className={cn("min-w-0 overflow-hidden rounded-md border border-border bg-card", className)}>
      {title || actions ? (
        <div data-chrome className="flex min-h-8 items-center gap-2 border-b border-border px-3 py-1">
          {title ? (
            <Heading id={id ? `${id}-title` : undefined} className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
              {title}
            </Heading>
          ) : (
            <div className="flex-1" />
          )}
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(!flush && "p-3")}>{children}</div>
    </section>
  )
}
