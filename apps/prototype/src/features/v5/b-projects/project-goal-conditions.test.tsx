import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
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

function renderProject(projectId: string) {
  const root = createRootRoute()
  const project = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (search: Record<string, unknown>) => search })
  const router = createRouter({ routeTree: root.addChildren([project]), history: createMemoryHistory({ initialEntries: [`/projects/${projectId}`] }) })
  render(<RouterProvider router={router} />)
}

/** The text of the first row of the table named `table` with a cell reading `cell` exactly, or whose text matches it. */
async function rowText(table: string, cell: string | RegExp): Promise<string> {
  const grid = await screen.findByRole("table", { name: table })
  const rows = within(grid).getAllByRole("row")
  const row = rows.find((r) => (typeof cell === "string" ? [...r.querySelectorAll("td, th")].some((c) => c.textContent === cell) : cell.test(r.textContent ?? "")))
  if (!row) throw new Error(`no row ${String(cell)} in ${table}`)
  return row.textContent ?? ""
}

describe("Project page: goal conditions read from subjectProgress (C7)", () => {
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

  it("shows the mosaic's weakest panel and its out-of-balance panel, and NGC 7000's nights left to its Finish by", async () => {
    const project = store.getState().catalog.projects.prj_cygnus!
    renderProject(project.id)
    const table = m.project_subjects_of({ name: project.name })

    const mosaic = await rowText(table, /IC 5070/)
    expect(mosaic).toMatch(/weakest Panel 3/)
    expect(mosaic).toMatch(/Panel 3 \d+% below average · limit ±\d+%/)
    expect(await rowText(table, /NGC 7000/)).toMatch(/\d+ nights? left/)
  })

  it("shows M 31 L's time below its quality bar", async () => {
    const project = store.getState().catalog.projects.prj_m31!
    renderProject(project.id)
    expect(await rowText(m.project_goals_of({ name: project.name }), "L")).toMatch(/below bar/)
  })
})
