import type { ReactNode } from "react"

/** One catalogue row: a reviewer caption (variant or state) beside the live component. */
export function Specimen({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-3">
      <span className="pt-0.5 font-mono text-xs text-muted-foreground">{caption}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}
