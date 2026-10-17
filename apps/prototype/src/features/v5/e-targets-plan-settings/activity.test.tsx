import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ActivityPage, openLabel } from "./activity"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
  window.location.hash = ""
})

// jsdom has no ResizeObserver; the table frame measures its room.
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

function renderActivity() {
  const root = createRootRoute()
  const page = createRoute({ getParentRoute: () => root, path: "/activity", component: ActivityPage })
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/activity"] }) })
  render(<RouterProvider router={router} />)
}

describe("Activity", () => {
  it("opens the surface that owns an entry from the row's ⋯ menu", async () => {
    const user = userEvent.setup()
    renderActivity()

    // The demo's Apply entry links to Cygnus HOO 2026's View tab.
    await user.click(await screen.findByRole("button", { name: m.actions_for({ name: "Apply Cygnus HOO 2026" }) }))
    await user.click(await screen.findByRole("menuitem", { name: "Open View" }))
    await waitFor(() => expect(window.location.hash).toBe("#/projects/prj_cygnus?stage=view"))
  })

  it("names the Open item after the surface it opens, and plain Open for a page with no name", () => {
    expect(openLabel("/settings/equipment")).toBe("Open Equipment")
    expect(openLabel("/sessions/ses_1")).toBe("Open Session")
    expect(openLabel("/no-such-surface")).toBe("Open")
  })
})
