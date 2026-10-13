/**
 * Parts the page templates share (L3, plan §3.4): the object menu, the view
 * tabs, and the header and panel action rules.
 */
import type { ReactNode } from "react"
import { ActionBar } from "@/components/app/actions"
import type { Action, MenuItem } from "@/components/app/contracts"
import { CountBadge } from "@/components/app/pill"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/** A named object menu (C-7): "Project ▾" holding Edit…, Reopen…, Move to Trash…. */
export interface ObjectMenu {
  /** The object's noun: "Project", "Session", "Calibration". */
  label: string
  items: MenuItem[]
}

/** View switches above the page body: tabs, never pills ("Masters · Processes"). */
export interface PageViews {
  /** Names the tab list. */
  label: string
  items: { id: string; label: string; count?: number }[]
  /** The view on screen; the page passes that view's body. */
  value: string
  onChange: (id: string) => void
}

/**
 * A header's actions (§2b, P1): at most one primary and three standard
 * buttons; every other action, and every destructive one, goes to the
 * object menu ("More" without one). Null when there is nothing to show.
 */
export function headerActions(actions: Action[] = [], menu?: ObjectMenu): ReactNode {
  if (actions.length === 0 && (!menu || menu.items.length === 0)) return null
  return <ActionBar actions={actions} overflow={menu?.items} menuLabel={menu?.label} />
}

/** A panel or a section beside the page header offers standard actions: the header holds the view's one primary. */
export function asStandard(actions: Action[] = []): Action[] {
  return actions.map((action) => (action.kind === "primary" ? { ...action, kind: "standard" } : action))
}

/** A template's header always reads as a bar over its body, also as a level 2 child area. */
export function headerBar(level: 1 | 2): string | undefined {
  return level === 2 ? "border-b border-separator py-2" : undefined
}

/**
 * The view tabs of a ListPage or DetailPage: the tab list under the header
 * and the page body as the panel of the view on screen. Without `views` the
 * body renders alone.
 */
export function ViewTabs({ views, children }: { views?: PageViews; children: ReactNode }) {
  if (!views) return children
  return (
    <Tabs value={views.value} onValueChange={(value) => views.onChange(String(value))} className="min-h-0 flex-1 flex-col gap-0">
      <div data-chrome className="shrink-0 border-b border-separator px-5 pt-1.5 pb-1">
        <TabsList variant="line" aria-label={views.label}>
          {views.items.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {item.label}
              {item.count !== undefined ? <CountBadge count={item.count} /> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {/* The panel always holds the page's controls, so it takes no tab stop of its own. */}
      <TabsContent value={views.value} tabIndex={-1} className="flex min-h-0 flex-col">
        {children}
      </TabsContent>
    </Tabs>
  )
}
