import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { closeSheet } from "@/app/ui-state"
import { projectSuggestions } from "@/domain/derive"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { removeSessions } from "@/store/actions/projects"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ProjectPage } from "./project"

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderProject(projectId: string) {
  const root = createRootRoute()
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (s: Record<string, unknown>) => s })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${projectId}`] }) })
  render(<RouterProvider router={router} />)
}

describe("A Project's empty Sessions text (F4)", () => {
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

  it("points to Add sessions… when there are no suggestions either", async () => {
    const heart = store.getState().catalog.projects.prj_heart!
    expect(heart.inputs).toHaveLength(0)
    expect(projectSuggestions(store.getState().catalog, heart)).toHaveLength(0)
    renderProject(heart.id)
    expect(await screen.findByText(m.project_no_sessions_add())).toBeInTheDocument()
    expect(screen.queryByText(m.project_no_sessions())).toBeNull()
  })

  it("points to the suggestions while there are some", async () => {
    const cygnus = store.getState().catalog.projects.prj_cygnus!
    expect(removeSessions(cygnus.id, cygnus.inputs.map((i) => i.sessionId)).ok).toBe(true)
    const emptied = store.getState().catalog.projects.prj_cygnus!
    expect(emptied.inputs).toHaveLength(0)
    expect(projectSuggestions(store.getState().catalog, emptied).length).toBeGreaterThan(0)
    renderProject(emptied.id)
    expect(await screen.findByText(m.project_no_sessions())).toBeInTheDocument()
    expect(screen.queryByText(m.project_no_sessions_add())).toBeNull()
  })
})
