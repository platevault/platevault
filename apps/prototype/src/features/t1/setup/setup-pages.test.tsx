import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { registerLocation } from "../lib/locations"
import { SetupIndexingPage, SetupLocationsPage } from "./setup-pages"

beforeEach(() => {
  store.replace({ ...createSeed("empty"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
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

/** The setup steps on their routes, plus Home where setup ends. */
function renderAt(path: string) {
  const root = createRootRoute()
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/setup/locations", component: SetupLocationsPage }),
    createRoute({ getParentRoute: () => root, path: "/setup/indexing", component: SetupIndexingPage }),
    createRoute({ getParentRoute: () => root, path: "/", component: () => null }),
  ]
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: [path] }) })
  render(<RouterProvider router={router} />)
  return router
}

function footerAction(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-step-footer] [data-action="${id}"]`)
}

function addCaptures() {
  act(() => {
    registerLocation({ path: "/Volumes/Astro-T7/Captures", displayName: "Astro-T7 captures", role: "captures" }, "/setup/locations")
  })
}

describe("Setup › Locations", () => {
  it("keeps Continue unavailable until a capture location is registered, then opens Index", async () => {
    const user = userEvent.setup()
    const router = renderAt("/setup/locations")
    await waitFor(() => expect(footerAction("setup-locations-continue")).toBeTruthy())
    expect(footerAction("setup-locations-continue")).toHaveAttribute("aria-disabled", "true")

    addCaptures()

    await waitFor(() => expect(footerAction("setup-locations-continue")).not.toHaveAttribute("aria-disabled", "true"))
    expect(screen.getByRole("table", { name: m.location_role_captures_list() })).toHaveTextContent("Astro-T7 captures")
    await user.click(footerAction("setup-locations-continue")!)
    await waitFor(() => expect(router.state.location.pathname).toBe("/setup/indexing"))
  })
})

describe("Setup › Index", () => {
  it("Start indexing starts one run; Open library then ends setup on Home", async () => {
    addCaptures()
    const user = userEvent.setup()
    const router = renderAt("/setup/indexing")
    await waitFor(() => expect(footerAction("setup-start-indexing")).toBeTruthy())

    await user.click(footerAction("setup-start-indexing")!)

    expect(store.getState().slices.e.setupOperationIds).toHaveLength(1)
    await waitFor(() => expect(footerAction("setup-open-library")).toBeTruthy())
    expect(footerAction("setup-index-later")).toBeNull()
    expect(store.getState().settings.onboarding.completedAt).toBeNull()
    await user.click(footerAction("setup-open-library")!)
    await waitFor(() => expect(router.state.location.pathname).toBe("/"))
    expect(store.getState().settings.onboarding.completedAt).not.toBeNull()
  })
})
