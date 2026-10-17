import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ProjectsPage } from "./projects"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

describe("Projects: no match", () => {
  // The list page measures its room; jsdom has no ResizeObserver.
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

  it("offers Clear filters once, in the filter chip row, and Clear shows the Projects again", async () => {
    const root = createRootRoute()
    const page = createRoute({ getParentRoute: () => root, path: "/projects", component: ProjectsPage })
    render(<RouterProvider router={createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/projects"] }) })} />)
    const user = userEvent.setup()
    await user.type(await screen.findByRole("searchbox", { name: m.projects_search() }), "no such project")
    expect(await screen.findByText(m.projects_no_match())).toBeInTheDocument()
    const clear = screen.getAllByRole("button", { name: m.filters_clear() })
    expect(clear).toHaveLength(1)
    await user.click(clear[0]!)
    expect(screen.queryByText(m.projects_no_match())).toBeNull()
  })
})
