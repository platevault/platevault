/**
 * ListPage (L3 template; plan §3.4, §2b). One list of objects: a header
 * bar, optional view tabs, one DataTable with its toolbar, and the open
 * row's DetailPanel docked beside it (spec 054).
 *
 * - Header: the path (breadcrumb) for a list that belongs to an object
 *   (a Project's Trash), the title, a summary (the count), the page's context controls
 *   (`context`: the night and site pickers on Targets) beside the title, at
 *   most one primary and three standard actions, and the object menu
 *   ("Calibration ▾") for the rest. The bar wraps when it runs out of room.
 *   No description and no navigation buttons (C10): views are tabs, places
 *   are links.
 * - Body: the page never scrolls; the table frame does, under its pinned
 *   header row. The toolbar row (FilterBar controls, toolbar actions) and the
 *   batch bar that replaces it share one height, so selecting moves nothing.
 * - Detail: a row click or the row's "Details" opens `detail`; the page
 *   marks that row with `table.activeRowId`. Changing the open row keeps the
 *   panel's place and size.
 */
import type { ReactNode } from "react"
import type { Action } from "@/components/app/contracts"
import { DataTable, type DataTableProps, type DataTableToolbar } from "@/components/app/data-table"
import type { PageNotice } from "@/components/app/feedback"
import { PageHeader, type PathItem } from "@/components/app/page"
import { DetailDock, type PageDetail } from "./detail-panel"
import { headerActions, headerBar, type ObjectMenu, type PageViews, ViewTabs } from "./parts"

/** The list's DataTable: always with its toolbar; the template sets its frame. */
export type ListPageTable<T> = DataTableProps<T> & { toolbar: DataTableToolbar; className?: never; scroll?: never }

export interface ListPageProps<T> {
  /** The breadcrumb for a list inside an object (Projects › {Project}); omit for a top-level list. */
  path?: PathItem[]
  title: string
  /** 1 for a route's page; 2 for a child area of a layout route (Settings) or a catalogue specimen. */
  level?: 1 | 2
  /** The count beside the title: "128 sessions". */
  summary?: string
  /** Controls that set what the whole list shows (NightPicker, SitePicker, DarkLine): beside the title, wrapping with it. */
  context?: ReactNode
  /** At most one primary and three standard get a button; the rest go to the menu. */
  actions?: Action[]
  menu?: ObjectMenu
  views?: PageViews
  notice?: PageNotice | null
  table: ListPageTable<T>
  detail?: PageDetail | null
}

export function ListPage<T>({ path, title, level = 1, summary, context, actions, menu, views, notice, table, detail }: ListPageProps<T>) {
  return (
    <div data-template="list" className="flex min-h-0 flex-1 flex-col">
      <PageHeader level={level} path={path} title={title} summary={summary} meta={context} actions={headerActions(actions, menu)} notice={notice} className={headerBar(level)} />
      <ViewTabs views={views}>
        <DetailDock detail={detail} level={level}>
          <div className="flex min-h-0 flex-1 flex-col px-5 pt-3 pb-4">
            <DataTable {...table} scroll="fill" />
          </div>
        </DetailDock>
      </ViewTabs>
    </div>
  )
}
