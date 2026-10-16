import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Column } from "@/components/app/contracts"
import { ListPage, type ListPageTable } from "@/components/templates/list-page"
import { SettingsPage } from "@/components/templates/settings-page"
import { SettingsLayout } from "./settings-layout"

interface Row {
  id: string
  name: string
}

const COLUMNS: Column<Row>[] = [{ id: "name", header: "Name", cell: (row) => row.name, rowHeader: true }]
const TABLE: ListPageTable<Row> = { label: "Locations", rows: [{ id: "a", name: "Astro-T7" }], columns: COLUMNS, getRowId: (row) => row.id, toolbar: { search: { label: "Search locations", value: "", onChange: () => {} } } }

/** SettingsLayout at `/settings/section`, with `section` as the open section. */
function renderSection(section: () => ReactNode) {
  const root = createRootRoute()
  const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: SettingsLayout })
  const child = createRoute({ getParentRoute: () => settings, path: "section", component: section })
  const router = createRouter({ routeTree: root.addChildren([settings.addChildren([child])]), history: createMemoryHistory({ initialEntries: ["/settings/section"] }) })
  render(<RouterProvider router={router} />)
}

/** The open section's template element and the detail pane that holds it. */
async function sectionIn(template: "list" | "settings", title: string) {
  const heading = await screen.findByRole("heading", { level: 2, name: title })
  const page = heading.closest<HTMLElement>(`[data-template='${template}']`)!
  return { page, pane: page.parentElement! }
}

describe("SettingsLayout: the detail pane", () => {
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

  it("is a shrinkable flex column a level-2 ListPage fills, so its table scrolls and the pane does not", async () => {
    renderSection(() => <ListPage level={2} title="Locations" table={TABLE} />)
    const { page, pane } = await sectionIn("list", "Locations")
    // The section is the pane's own child: no wrapper between the Outlet and the pane breaks the flex chain.
    expect(pane).toHaveClass("flex", "flex-col", "min-h-0", "overflow-y-auto")
    expect(pane.parentElement).toHaveClass("grid", "min-h-0", "flex-1")
    expect(page).toHaveClass("flex", "flex-col", "min-h-0", "flex-1")
  })

  it("scrolls a SettingsPage as one column: the page keeps its content height", async () => {
    renderSection(() => (
      <SettingsPage title="Appearance">
        <p>Theme</p>
      </SettingsPage>
    ))
    const { page, pane } = await sectionIn("settings", "Appearance")
    expect(pane).toHaveClass("overflow-y-auto")
    expect(page).not.toHaveClass("flex-1")
    expect(page).not.toHaveClass("min-h-0")
  })
})
