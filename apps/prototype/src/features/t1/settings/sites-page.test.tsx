import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { SitesPage } from "./sites-page"

// The table frame measures its room; jsdom has no ResizeObserver.
const original = globalThis.ResizeObserver
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterAll(() => {
  globalThis.ResizeObserver = original
})
beforeEach(() => {
  localStorage.removeItem("platevault.columns.settings.sites")
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderPage() {
  const router = createRouter({ routeTree: createRootRoute({ component: SitesPage }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

describe("Settings › Observing sites (cmvgf)", () => {
  it("shows Name, Default, Coordinates and Time zone, and keeps Elevation, Darkness and Min. altitude in the row details", async () => {
    const user = userEvent.setup()
    renderPage()
    const table = await screen.findByRole("table", { name: m.settings_sites() })
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "")
    for (const shown of [m.site_name(), m.settings_default(), m.site_coordinates_header(), m.site_time_zone()]) expect(headers).toContain(shown)
    for (const hidden of [m.site_elevation(), m.site_darkness(), m.site_min_altitude()]) expect(headers).not.toContain(hidden)

    await user.click(screen.getByRole("button", { name: m.table_row_details({ name: "La Palma" }) }))
    const term = await screen.findByText(m.site_elevation(), { selector: "dt" })
    expect(term.nextElementSibling?.textContent).toBe("2,300 m")
    expect(screen.getByText(m.site_min_altitude(), { selector: "dt" }).nextElementSibling?.textContent).toBe("20°")
  })
})
