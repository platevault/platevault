import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { AboutPage } from "./about-page"

beforeEach(() => {
  store.replace({ ...createSeed("empty"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderPage() {
  const router = createRouter({ routeTree: createRootRoute({ component: AboutPage }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

/** The value beside the Date and time term. */
async function dateAndTime(): Promise<string> {
  const term = await screen.findByText(m.about_clock(), { selector: "dt" })
  return term.nextElementSibling?.textContent ?? ""
}

describe("Settings › About: Date and time (R11)", () => {
  it("names this computer's clock while no simulated date is set", async () => {
    renderPage()
    expect(await dateAndTime()).toBe(m.about_clock_system())
  })

  it("shows the simulated date, marked simulated, once the Simulation panel sets one", async () => {
    store.setState((s) => ({ ...s, faults: { ...s.faults, clockOffsetMs: 86_400_000 } }))
    renderPage()
    expect(await dateAndTime()).toContain(m.prototype_about_clock({ date: "" }).trim())
  })
})
