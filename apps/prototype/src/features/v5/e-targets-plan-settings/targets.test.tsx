import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { TargetsPage } from "./targets"
import { allRows, myTargetRows } from "./targets-model"

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

/** The demo library with no favourite but the first My targets row. */
let favourite = ""
let others: string[] = []
beforeEach(() => {
  const seed = createSeed("demo")
  for (const target of Object.values(seed.catalog.targets)) seed.catalog.targets[target.id] = { ...target, favourite: false }
  const mine = myTargetRows(allRows(seed.catalog)).filter((r) => r.target)
  const chosen = mine[0]!.target!
  seed.catalog.targets[chosen.id] = { ...chosen, favourite: true }
  favourite = mine[0]!.designation
  others = mine.slice(1).map((r) => r.designation)
  store.replace({ ...seed, schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderTargets(url: string) {
  const root = createRootRoute()
  const page = createRoute({ getParentRoute: () => root, path: "/targets", component: TargetsPage, validateSearch: (search: Record<string, unknown>) => search })
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [url] }) })
  render(<RouterProvider router={router} />)
}

/** The shown rows by designation, and each row's Favourite cell. */
async function rows() {
  const table = await screen.findByRole("table")
  return within(table)
    .getAllByRole("rowheader")
    .map((header) => ({ name: header.textContent ?? "", row: header.closest("tr")! }))
}

describe("Targets: the Favourite column and filter", () => {
  it("lists a Favourite column, with a star named Favourite on the favourite row only", async () => {
    expect(others.length).toBeGreaterThan(0)
    renderTargets("/targets")
    expect(await screen.findByRole("columnheader", { name: m.targets_favourite() })).toBeInTheDocument()
    const shown = await rows()
    expect(shown.map((r) => r.name)).toContain(favourite)
    for (const { name, row } of shown) {
      const stars = within(row).queryAllByRole("img", { name: m.targets_favourite() })
      expect(stars, name).toHaveLength(name === favourite ? 1 : 0)
    }
  })

  it("filters to favourites with ?fav=yes and to the rest with ?fav=no, and the facet names the choice", async () => {
    renderTargets("/targets?fav=yes")
    expect(await screen.findByRole("button", { name: m.filter_bar_facet_value({ label: m.targets_favourite(), value: m.targets_favourite_yes() }) })).toBeInTheDocument()
    expect((await rows()).map((r) => r.name)).toEqual([favourite])
  })

  it("shows every My targets row but the favourite with ?fav=no", async () => {
    renderTargets("/targets?fav=no")
    const names = (await rows()).map((r) => r.name)
    expect(names).not.toContain(favourite)
    expect(names.sort()).toEqual([...others].sort())
  })
})
