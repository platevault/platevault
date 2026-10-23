import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { OctagonX } from "lucide-react"
import { describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { StatusCounter, type StatusCounterPage } from "./status-bar"

const LOCATIONS: StatusCounterPage = { id: "locations", label: m.status_bar_issue_page({ page: m.common_locations(), count: "1" }), link: { to: "/settings/locations" } }
const CALIBRATION: StatusCounterPage = { id: "calibration", label: m.status_bar_issue_page({ page: m.nav_calibration(), count: "2" }), link: { to: "/calibration" } }

function renderCounter(pages: StatusCounterPage[], count: number) {
  const history = createMemoryHistory({ initialEntries: ["/"] })
  const label = m.status_bar_errors({ count })
  const router = createRouter({ routeTree: createRootRoute({ component: () => <StatusCounter label={label} icon={OctagonX} tone="danger" count={count} pages={pages} /> }), history })
  render(<RouterProvider router={router} />)
  return { history, label }
}

describe("StatusCounter (F7, R11)", () => {
  it("opens the page menu for one issue, as it does for several", async () => {
    const user = userEvent.setup()
    const { history, label } = renderCounter([LOCATIONS], 1)
    await user.click(await screen.findByRole("button", { name: label }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([LOCATIONS.label])
    expect(history.location.pathname).toBe("/")
    await user.click(within(menu).getByRole("menuitem", { name: LOCATIONS.label }))
    await waitFor(() => expect(history.location.pathname).toBe("/settings/locations"))
  })

  it("names every page in the menu with several", async () => {
    const user = userEvent.setup()
    const { label } = renderCounter([LOCATIONS, CALIBRATION], 3)
    await user.click(await screen.findByRole("button", { name: label }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([LOCATIONS.label, CALIBRATION.label])
  })
})
