import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { closeSheet } from "@/app/ui-state"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ProjectPage } from "./project"

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

/** The Project page at `/projects/$id?add=goal`, as Home's Add a Goal opens it. */
function renderProject(projectId: string) {
  const root = createRootRoute()
  const project = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (search: Record<string, unknown>) => search })
  const router = createRouter({ routeTree: root.addChildren([project]), history: createMemoryHistory({ initialEntries: [`/projects/${projectId}?add=goal`] }) })
  render(<RouterProvider router={router} />)
  return router
}

describe("Project: ?add=goal (Home's Add a Goal)", () => {
  // The dock and the dialogs measure their room; jsdom has no ResizeObserver.
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

  it("opens Add goal, and closing the dialog clears the param", async () => {
    const project = Object.values(store.getState().catalog.projects).find((p) => p.state === "open" && p.subjects.length > 0)!
    const router = renderProject(project.id)
    expect(await screen.findByRole("dialog", { name: m.goal_add() })).toBeInTheDocument()
    await userEvent.setup().keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.goal_add() })).toBeNull())
    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).add).toBeUndefined())
  })
})
