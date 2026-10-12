/**
 * Table parts (L1): the one table look. DataTable (components/app/
 * data-table.tsx) renders every table through them; features render
 * DataTable, never these parts (plan P4). Row height and cell padding follow
 * the density tokens `--row-h` and `--row-py`.
 *
 * A data row paints its tint (stripe, hover, selected, current) as the
 * variable `--row-bg` too, so cells pinned over the scrolled ones can paint
 * the same tint on an opaque surface.
 */
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { cn } from "cn"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table data-slot="table" className={cn("w-full text-sm", className)} {...props} />
}

/** Names the data set for assistive technology; visually hidden. */
function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("sr-only", className)} {...props} />
}

/** The column-header row group; it stays pinned while its frame scrolls. */
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      data-chrome
      className={cn(
        "sticky top-0 z-10 bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]",
        className,
      )}
      {...props}
    />
  )
}

function TableBody(props: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot data-slot="table-footer" className={cn("border-t bg-muted/50 font-medium", className)} {...props} />
}

const tableRowVariants = cva("h-(--row-h)", {
  variants: {
    kind: {
      // `data-alt` marks every other row of a body; the stripe skips selected rows, so the selected tint always shows.
      data: [
        "group/row border-b border-border/50 last:border-0 data-alt:not-data-selected:bg-foreground/[0.022] hover:bg-foreground/[0.06]",
        "data-selected:bg-primary/16 data-selected:hover:bg-primary/22",
        "aria-[current=true]:bg-accent aria-[current=true]:shadow-[inset_2px_0_0_var(--primary)]",
        "[--row-bg:transparent] data-alt:not-data-selected:[--row-bg:color-mix(in_oklab,var(--foreground)_2.2%,transparent)] hover:[--row-bg:color-mix(in_oklab,var(--foreground)_6%,transparent)]",
        "data-selected:[--row-bg:color-mix(in_oklab,var(--primary)_16%,transparent)] data-selected:hover:[--row-bg:color-mix(in_oklab,var(--primary)_22%,transparent)]",
        "aria-[current=true]:[--row-bg:var(--accent)]",
      ],
      /** A group header row: its label spans the columns. */
      group: "border-b bg-muted/40 not-first:border-t",
      /** The detail an expanded row opens, right under it. */
      detail: "border-b border-border/50 bg-muted/30 last:border-0",
      /** A row that stands for the rows: loading, empty or error. */
      state: "border-b last:border-0",
    },
  },
  defaultVariants: { kind: "data" },
})

function TableRow({ className, kind, ...props }: React.ComponentProps<"tr"> & VariantProps<typeof tableRowVariants>) {
  return <tr data-slot="table-row" className={cn(tableRowVariants({ kind }), className)} {...props} />
}

/** A column header (`th scope="col"`). */
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th data-slot="table-head" scope="col" className={cn("h-(--row-h) px-3 text-left font-medium whitespace-nowrap", className)} {...props} />
}

/** A body cell; `rowHeader` renders it as the row's header (`th scope="row"`). */
function TableCell({ className, rowHeader = false, ...props }: React.ComponentProps<"td"> & { rowHeader?: boolean }) {
  const Cell = rowHeader ? "th" : "td"
  return <Cell data-slot="table-cell" scope={rowHeader ? "row" : undefined} className={cn("px-3 py-(--row-py) text-left font-normal tabular-nums", className)} {...props} />
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
