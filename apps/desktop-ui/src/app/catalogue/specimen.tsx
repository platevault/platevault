import type { ReactNode } from "react"
import { Section } from "@/components/app/page"

/** One catalogue row: a reviewer caption (variant or state) beside the live component. */
export function Specimen({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-3">
      <span className="pt-0.5 font-mono text-xs text-muted-foreground">{caption}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

/**
 * A catalogue section titled by the exported names of the components it shows. Those names are code
 * identifiers, the same in every language, so they come in as `components`, never as catalogue copy;
 * the description is translated.
 */
export function ComponentSection({ components, description, level, children }: { components: string[]; description?: ReactNode; level?: 2 | 3; children: ReactNode }) {
  return (
    <Section title={components.join(" · ")} description={description} level={level}>
      {children}
    </Section>
  )
}
