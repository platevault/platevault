/**
 * DetailPage (L3 template; plan §3.4). One object: a header bar with its
 * path, optional view tabs, a column of sections, and an item's
 * DetailPanel docked beside them (spec 054).
 *
 * - Header: the path (breadcrumb), the title, its StatusBadge, at most one
 *   primary and three standard actions, and the object menu ("Project ▾":
 *   Edit…, Reopen…, Move to Trash…). One verb edits: "Edit…" (Q2).
 * - Sections: each a Box holding a BoxTable or a KeyValueList, with a count
 *   and standard actions in its header. The section column scrolls; the
 *   header stays.
 * - Detail: an item of a section table opens `detail` beside the sections,
 *   as on a ListPage.
 *
 * Home is a DetailPage with sections only (Q8).
 */
import type { ReactNode } from "react"
import { Box } from "@/components/app/box"
import type { Action } from "@/components/app/contracts"
import type { PageNotice } from "@/components/app/feedback"
import { PageHeader, type PathItem } from "@/components/app/page"
import { DetailDock, type PageDetail } from "./detail-panel"
import { asStandard, headerActions, headerBar, type ObjectMenu, type PageViews, ViewTabs } from "./parts"

/** One section of a DetailPage: a Box. */
export interface DetailSection {
  /** Unique on the page: it names the Box and its heading. */
  id: string
  title: string
  /** A count beside the title, such as the rows of its table. */
  count?: number
  /** Standard actions in the Box header ("Add session…"); a primary one renders as standard. */
  actions?: Action[]
  /** A BoxTable or a KeyValueList. */
  content: ReactNode
  /** The content meets the Box edge (a BoxTable); default false (padded). */
  flush?: boolean
}

export interface DetailPageProps {
  path?: PathItem[]
  title: string
  /** 1 for a route's page; 2 for a child area of a layout route or a catalogue specimen. */
  level?: 1 | 2
  /** A StatusBadge beside the title. */
  status?: ReactNode
  /** At most one primary and three standard get a button; the rest go to the menu. */
  actions?: Action[]
  menu?: ObjectMenu
  views?: PageViews
  notice?: PageNotice | null
  sections: DetailSection[]
  detail?: PageDetail | null
}

export function DetailPage({ path, title, level = 1, status, actions, menu, views, notice, sections, detail }: DetailPageProps) {
  const sectionLevel = level === 1 ? 2 : 3
  return (
    <div data-template="detail" className="flex min-h-0 flex-1 flex-col">
      <PageHeader level={level} path={path} title={title} meta={status} actions={headerActions(actions, menu)} notice={notice} className={headerBar(level)} />
      <ViewTabs views={views}>
        <DetailDock detail={detail} level={level}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-4 px-5 py-4">
              {sections.map((section) => {
                const sectionActions = asStandard(section.actions)
                return (
                  <Box
                    key={section.id}
                    id={section.id}
                    level={sectionLevel}
                    title={section.title}
                    count={section.count}
                    flush={section.flush}
                    actions={headerActions(sectionActions)}
                  >
                    {section.content}
                  </Box>
                )
              })}
            </div>
          </div>
        </DetailDock>
      </ViewTabs>
    </div>
  )
}
