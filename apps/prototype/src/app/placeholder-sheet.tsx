/**
 * Foundation placeholder for a workflow sheet (S4 New Project, S9 Done /
 * Archive, S13 Import, Start a run). Opens when `useShellUi().sheet` names
 * its kind, names the screen and its IA row, and says it is built next.
 * The owning slice replaces the host component that renders it.
 */
import type { ReactNode } from "react"
import type { PlaceholderScreen } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { closeSheet } from "./ui-state"

export function PlaceholderSheet({ open, screen, title, facts = [] }: { open: boolean; screen: PlaceholderScreen; title?: string; facts?: Array<{ label: string; value: ReactNode }> }) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeSheet()}>
      <SheetContent side="right" className="w-[28rem] max-w-[90vw]" data-placeholder-sheet={screen.id}>
        <SheetHeader>
          <SheetTitle>{title ?? screen.title}</SheetTitle>
          <SheetDescription>
            {screen.id} · slice {screen.slice} · built next
          </SheetDescription>
        </SheetHeader>
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 text-sm">
          {facts.map((fact, index) => (
            <div key={`${index}-${fact.label}`} className="contents">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="min-w-0">{fact.value}</dd>
            </div>
          ))}
          {screen.contract ? (
            <>
              <dt className="text-muted-foreground">Contract</dt>
              <dd>{screen.contract}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Must show</dt>
          <dd className="text-pretty">{screen.mustShow}</dd>
        </dl>
        <SheetFooter>
          <Button variant="outline" size="sm" onClick={closeSheet}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
