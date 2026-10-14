import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m, say } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ActivityPage, destinationLabel } from "./activity"

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
    const event = store.getState().activity.find((e) => e.href)
    expect(event, "the demo seed records an entry that links to its surface").toBeDefined()
    const user = userEvent.setup()
    renderActivity()

    await user.click(await screen.findByRole("button", { name: m.actions_for({ name: say(m, event!.title) }) }))
    await user.click(await screen.findByRole("menuitem", { name: m.activity_open_destination({ name: destinationLabel(event!.href!) }) }))
    await waitFor(() => expect(window.location.hash).toBe(`#${event!.href}`))
  })
})
