import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { editSessionDetails } from "@/store/actions/library"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ProjectPage } from "./project"

const CLOSED = "prj_ngc_oiii"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

describe("a Closed Project shows its sessions' current names (owner's answer, 2026-10-20)", () => {
  // The dock measures its room; jsdom has no ResizeObserver.
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

  it("lists a renamed session under its new name while the Project stays as Close froze it", async () => {
    const project = store.getState().catalog.projects[CLOSED]!
    expect(project.state).not.toBe("open")
    const session = store.getState().catalog.sessions[project.inputs[0]!.sessionId]!
    expect(editSessionDetails(session.id, { name: "OIII first light", notes: "" }, session.revision).ok).toBe(true)
    expect(store.getState().catalog.projects[CLOSED]).toEqual(project)

    const root = createRootRoute()
    const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (s: Record<string, unknown>) => s })
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${CLOSED}`] }) })
    render(<RouterProvider router={router} />)
    expect((await screen.findAllByText(/OIII first light/)).length).toBeGreaterThan(0)
  })
})
