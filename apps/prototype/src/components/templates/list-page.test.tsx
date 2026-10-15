import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Column } from "@/components/app/contracts"
import { ListDetail, PageHeader } from "@/components/app/page"
import { m } from "@/lib/i18n"
import { ListPage, type ListPageTable } from "./list-page"

interface Row {
  id: string
  name: string
}

const ROWS: Row[] = [
  { id: "a", name: "Vega" },
  { id: "b", name: "Deneb" },
]
const COLUMNS: Column<Row>[] = [{ id: "name", header: "Name", cell: (row) => row.name, sortValue: (row) => row.name, rowHeader: true }]
const TABLE: ListPageTable<Row> = { label: "Stars", rows: ROWS, columns: COLUMNS, getRowId: (row) => row.id, toolbar: { search: { label: "Search stars", value: "", onChange: () => {} } } }

/** The table's scroll frame: the element around the <table>. */
const frameOf = () => screen.getByRole("table", { name: "Stars" }).parentElement!

describe("ListPage", () => {
  // DetailDock measures its room; jsdom has no ResizeObserver and lays nothing out.
  const original = globalThis.ResizeObserver
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })
  afterAll(() => {
    globalThis.ResizeObserver = original
  })

  it("fills its body with the table: the frame takes the rest of the column, with no height cap", () => {
    render(<ListPage title="Stars" table={TABLE} />)
    const frame = frameOf()
    expect(frame).toHaveClass("min-h-0", "flex-1", "overflow-auto")
    expect(frame.className).not.toMatch(/max-h-/)
    // Every box from the body down to the frame is a shrinkable flex column, without a `*:` stretch on any of them.
    const page = frame.closest<HTMLElement>("[data-template='list']")!
    for (let box = frame.parentElement; box && box !== page; box = box.parentElement) {
      expect(box).toHaveClass("flex", "flex-col", "min-h-0", "flex-1")
      expect(box.className).not.toMatch(/\*:/)
    }
  })

  it("renders `context` in the header beside the title, in a row that wraps", () => {
    render(<ListPage title="Targets" context={<button type="button">Tonight</button>} table={TABLE} />)
    const header = screen.getByRole("heading", { level: 1, name: "Targets" }).closest("header")!
    const control = within(header).getByRole("button", { name: "Tonight" })
    const holder = control.parentElement!
    expect(holder).toHaveClass("flex", "flex-wrap")
    // The title row and the header bar wrap too, so the context drops under the title at narrow widths.
    expect(holder.parentElement).toHaveClass("flex-wrap")
    expect(header).toHaveClass("flex-wrap")
  })

  it("as a level-2 child of the settings pane (ListDetail), fills the detail pane", () => {
    render(
      <div data-testid="pane" className="flex h-full flex-col">
        <ListDetail listLabel="Settings" list={<a href="#/settings">Library</a>} detail={<ListPage level={2} title="Locations" table={TABLE} />} />
      </div>,
    )
    const page = screen.getByRole("heading", { level: 2, name: "Locations" }).closest<HTMLElement>("[data-template='list']")!
    expect(page).toHaveClass("flex", "flex-col", "min-h-0", "flex-1")
    // The detail pane is a flex column, so the ListPage's flex-1 takes its height; it still scrolls a SettingsPage.
    const detail = page.parentElement!
    expect(detail).toHaveClass("flex", "flex-col", "min-h-0", "overflow-y-auto")
    expect(detail.parentElement).toHaveClass("grid", "min-h-0", "flex-1")
  })

  it("names the tab after the page only: a level-2 template or header adds nothing", () => {
    const { unmount } = render(
      <>
        <PageHeader title="Design system reference" />
        <ListPage level={2} title="Sessions" table={TABLE} />
        <PageHeader level={2} title="Library" />
      </>,
    )
    expect(document.title).toBe(`Design system reference · ${m.prototype_document_title()}`)
    unmount()
    expect(document.title).toBe(m.prototype_document_title())
  })

  it("renders `path` as the header breadcrumb before the title, and the tab still names the title alone", async () => {
    const node: ReactNode = (
      <ListPage
        path={[
          { label: "Projects", link: { to: "/projects" } },
          { label: "Cygnus", link: { to: "/projects/$projectId", params: { projectId: "prj_cygnus" } } },
        ]}
        title="Trash"
        table={TABLE}
      />
    )
    // The path's links go through the router.
    const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ["/"] }) })
    render(<RouterProvider router={router} />)
    const header = (await screen.findByRole("heading", { level: 1, name: "Trash" })).closest("header")!
    const crumbs = within(header).getByRole("navigation", { name: m.ui_breadcrumb() })
    expect(within(crumbs).getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects")
    expect(within(crumbs).getByRole("link", { name: "Cygnus" })).toHaveAttribute("href", "/projects/prj_cygnus")
    expect(document.title).toBe(`Trash · ${m.prototype_document_title()}`)
  })
})