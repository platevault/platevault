/**
 * ListPage (L3 template; plan §3.4, §2b). One list of objects: a header
 * bar, optional view tabs, one DataTable with its toolbar, and the open
 * row's DetailPanel docked beside it (spec 054).
 *
 * - Header: the title, a summary (the count), at most one primary and three
 *   standard actions, and the object menu ("Calibration ▾") for the rest.
 *   No description and no navigation buttons (C10): views are tabs, places
 *   are links.
 * - Body: the page never scrolls; the table frame does, under its pinned
 *   header row. The toolbar row (FilterBar controls, toolbar actions) and the
 *   batch bar that replaces it share one height, so selecting moves nothing.
 * - Detail: a row click or the row's "Details" opens `detail`; the page
 *   marks that row with `table.activeRowId`. Changing the open row keeps the
 *   panel's place and size.
 */
import type { Action } from "@/components/app/contracts"
import { DataTable, type DataTableProps, type DataTableToolbar } from "@/components/app/data-table"
import type { PageNotice } from "@/components/app/feedback"
import { PageHeader } from "@/components/app/page"
import { DetailDock, type PageDetail } from "./detail-panel"
import { headerActions, headerBar, type ObjectMenu, type PageViews, ViewTabs } from "./parts"

/** The list's DataTable: always with its toolbar; the template sets its frame. */
export type ListPageTable<T> = DataTableProps<T> & { toolbar: DataTableToolbar; className?: never; scroll?: never }

export interface ListPageProps<T> {
  title: string
  /** 1 for a route's page; 2 for a child area of a layout route (Settings) or a catalogue specimen. */
  level?: 1 | 2
  /** The count beside the title: "128 sessions". */
  summary?: string
  /** At most one primary and three standard get a button; the rest go to the menu. */
  actions?: Action[]
  menu?: ObjectMenu
  views?: PageViews
  notice?: PageNotice | null
  table: ListPageTable<T>
  detail?: PageDetail | null
}

export function ListPage<T>({ title, level = 1, summary, actions, menu, views, notice, table, detail }: ListPageProps<T>) {
  return (
    <div data-template="list" className="flex min-h-0 flex-1 flex-col">
      <PageHeader level={level} title={title} summary={summary} actions={headerActions(actions, menu)} notice={notice} className={headerBar(level)} />
      <ViewTabs views={views}>
        <DetailDock detail={detail} level={level}>
          {/* The table fills the body: its wrapper becomes a column and its frame takes the rest (the frame scrolls, the page does not). */}
          <div className="flex min-h-0 flex-1 flex-col px-5 pt-3 pb-4 *:flex *:min-h-0 *:flex-1 *:flex-col">
            <DataTable {...table} scroll="frame" className="max-h-none min-h-0 flex-1" />
          </div>
        </DetailDock>
      </ViewTabs>
    </div>
  )
}
