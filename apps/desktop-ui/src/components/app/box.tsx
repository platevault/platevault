/**
 * Box (foundation primitive): a hairline group panel with an optional small
 * heading and actions, used instead of separator text. Never nested: a Box
 * inside a Box loses its frame (index.css), as group boxes do.
 *
 * - `count`: a CountBadge beside the title ("Masters 3"), so no caller
 *   assembles a heading.
 * - `BoxTable`: a DataTable that fills a flush Box. The Box frame is the
 *   table's frame, so the table draws no second border and grows with its
 *   rows. A DetailPage section is a Box holding a BoxTable or a KeyValueList.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { DataTable, type DataTableProps } from "./data-table"
import { CountBadge } from "./pill"

export interface BoxProps {
  title?: ReactNode
  /** A count beside the title, such as the rows of the table the box holds. */
  count?: number
  /** Heading level of the title; 3 inside a page section. */
  level?: 2 | 3 | 4
  actions?: ReactNode
  /** Drop the body padding for a table or list that fills the box. */
  flush?: boolean
  id?: string
  className?: string
  children: ReactNode
}

export function Box({ title, count, level = 3, actions, flush = false, id, className, children }: BoxProps) {
  const Heading = `h${level}` as const
  return (
    <section data-slot="box" aria-labelledby={title && id ? `${id}-title` : undefined} className={cn("min-w-0 overflow-hidden rounded-md border border-border bg-card", className)}>
      {title || actions ? (
        <div data-chrome className="flex min-h-8 items-center gap-2 border-b border-border px-3 py-1">
          {title ? (
            <Heading id={id ? `${id}-title` : undefined} className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <span className="truncate">{title}</span>
              {count !== undefined ? <CountBadge count={count} /> : null}
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

/** The frame of a DataTable inside a flush Box: none, since the Box frame is the table's. */
export const BOXED_TABLE_FRAME = "rounded-none border-0"

/**
 * The DataTable of a flush Box: it takes the Box frame as its own and grows
 * with its rows (the page scrolls). A table that needs a filter toolbar or a
 * batch bar is a ListPage table, not a box.
 */
export type BoxTableProps<T> = DataTableProps<T> & { className?: never; scroll?: never; toolbar?: never; batchActions?: never; stickyFirstColumn?: never }

export function BoxTable<T>(props: BoxTableProps<T>) {
  return <DataTable {...props} scroll="none" className={BOXED_TABLE_FRAME} />
}
