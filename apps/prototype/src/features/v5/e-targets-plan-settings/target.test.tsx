import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { TargetPage } from "./target"

// DetailDock and the pinned first column measure their room; jsdom has no ResizeObserver.
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
beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderTarget(targetId: string) {
  const root = createRootRoute()
  const page = createRoute({ getParentRoute: () => root, path: "/targets/$targetId", component: TargetPage, validateSearch: (search: Record<string, unknown>) => search })
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [`/targets/${targetId}`] }) })
  render(<RouterProvider router={router} />)
}

describe("Target detail: the chosen night at the planning site", () => {
  it("shows the Dark and Moon lines under one Night term, and no term repeats at the start of its value", async () => {
    const target = Object.values(store.getState().catalog.targets).find((t) => t.ra !== null && t.dec !== null)!
    renderTarget(target.id)
    const tonight = within(await screen.findByRole("region", { name: m.target_tonight() }))
    const terms = tonight.getAllByRole("term")
    const night = terms.find((term) => term.textContent === m.tonight_night())
    expect(night, "a Night term").toBeDefined()
    const value = night!.nextElementSibling!.textContent!
    expect(value.startsWith(`${m.plan_dark()} `)).toBe(true)
    expect(value).toContain(`${m.tonight_moon()} `)
    for (const term of terms) expect(term.nextElementSibling!.textContent!.startsWith(term.textContent!)).toBe(false)
  })
})
