import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { SimulationControls } from "./simulation-panel"

function renderControls() {
  const root = createRootRoute({ component: SimulationControls })
  render(<RouterProvider router={createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) })} />)
}

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

describe("Simulation panel: the Quick actions switch", () => {
  it("starts at One-click and switches to Open page, kept with the other simulation controls", async () => {
    const user = userEvent.setup()
    renderControls()
    const group = await screen.findByRole("group", { name: m.simulation_quick_actions() })
    const oneClick = screen.getByRole("button", { name: m.simulation_quick_one_click() })
    const openPage = screen.getByRole("button", { name: m.simulation_quick_open_page() })
    expect(group).toContainElement(oneClick)
    expect(oneClick).toHaveAttribute("aria-pressed", "true")
    expect(store.getState().faults.quickActions).toBe("one-click")

    await user.click(openPage)
    expect(store.getState().faults.quickActions).toBe("open-page")
    expect(openPage).toHaveAttribute("aria-pressed", "true")
  })
})
