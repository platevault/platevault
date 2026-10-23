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
 * - Aside: a second column of sections. From 1280 px wide the sections form
 *   the left column and the aside the right; narrower, everything stacks in
 *   one column, the sections first, then the aside. Without an aside the
 *   page is one column.
 * - Detail: an item of a section table opens `detail` beside the sections,
 *   as on a ListPage.
 *
 * Home is a DetailPage with sections and an aside (C8).
 */
import type { ReactNode } from "react"
import { Box } from "@/components/app/box"
import type { Action, MenuItem } from "@/components/app/contracts"
import type { PageNotice } from "@/components/app/feedback"
import { PageHeader, type PathItem } from "@/components/app/page"
import { m } from "@/lib/i18n"
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
  /** Less frequent actions under the Box header's More menu ("Rescan"). */
  more?: MenuItem[]
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
  /** A StatusBadge, or a header control such as a Favourite toggle, beside the title. */
  status?: ReactNode
  /** The refusal or failure of a `status` control, on its own row under the header row (the host's runner feedback). */
  statusFeedback?: ReactNode
  actions?: Action[]
  menu?: ObjectMenu
  views?: PageViews
  notice?: PageNotice | null
  sections: DetailSection[]
  /** The right column from 1280 px; below, it stacks under `sections`. */
  aside?: DetailSection[]
  detail?: PageDetail | null
}

export function DetailPage({ path, title, level = 1, status, statusFeedback, actions, menu, views, notice, sections, aside = [], detail }: DetailPageProps) {
  const sectionLevel = level === 1 ? 2 : 3
  const box = (section: DetailSection) => (
    <Box
      key={section.id}
      id={section.id}
      level={sectionLevel}
      title={section.title}
      count={section.count}
      flush={section.flush}
      actions={headerActions(asStandard(section.actions), section.more?.length ? { label: m.common_more(), items: section.more } : undefined)}
    >
      {section.content}
    </Box>
  )
  return (
    <div data-template="detail" className="flex min-h-0 flex-1 flex-col">
      <PageHeader level={level} path={path} title={title} meta={status} actions={headerActions(actions, menu)} feedback={statusFeedback} notice={notice} className={headerBar(level)} />
      <ViewTabs views={views}>
        <DetailDock detail={detail} level={level}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {aside.length === 0 ? (
              <div className="space-y-4 px-5 py-4">{sections.map(box)}</div>
            ) : (
              <div className="grid gap-4 px-5 py-4 xl:grid-cols-2 xl:items-start" data-detail-columns="">
                <div className="min-w-0 space-y-4">{sections.map(box)}</div>
                <div className="min-w-0 space-y-4">{aside.map(box)}</div>
              </div>
            )}
          </div>
        </DetailDock>
      </ViewTabs>
    </div>
  )
}
