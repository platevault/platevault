import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, waitFor } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ImportPage } from "./import"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

describe("Import: ?location= (Home's Import and Retry)", () => {
  // The step page measures its room; jsdom has no ResizeObserver.
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

  it("takes the location's folder as the source and its Captures location as the destination, then drops the param", async () => {
    const location = Object.values(store.getState().catalog.locations).find((l) => l.role === "captures" && !l.retiredAt)!
    const root = createRootRoute()
    const page = createRoute({ getParentRoute: () => root, path: "/import", component: ImportPage, validateSearch: (search: Record<string, unknown>) => search })
    const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [`/import?step=source&location=${location.id}`] }) })
    render(<RouterProvider router={router} />)
    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).location).toBeUndefined())
    const draft = store.getState().slices.a.importDraft
    const saved = Object.values(store.getState().catalog.importSources).find((s) => s.path === location.path)
    expect(draft.source).toEqual(saved ? { kind: "saved", id: saved.id } : { kind: "folder", path: location.path })
    expect(draft.capturesLocationId).toBe(location.id)
    expect((router.state.location.search as Record<string, unknown>).step).toBe("source")
  })
})
