import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { framesInLocation } from "@/features/t1/lib/locations"
import { createSeed } from "@/domain/seed"
import { locationDiskUse } from "@/domain/storage"
import { formatBytes, formatCount } from "@/lib/format"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { LocationsPage } from "./locations-page"

const SPARE = "loc_spare"

// The table frame measures its room; jsdom has no ResizeObserver.
const original = globalThis.ResizeObserver
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterAll(() => {
  globalThis.ResizeObserver = original
})
beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderAt(url: string) {
  const router = createRouter({ routeTree: createRootRoute({ component: LocationsPage }), history: createMemoryHistory({ initialEntries: [url] }) })
  render(<RouterProvider router={router} />)
}

/** The value beside a term of the open details. */
async function fact(label: string): Promise<string> {
  const term = await screen.findByText(label, { selector: "dt" })
  return term.nextElementSibling?.textContent ?? ""
}

describe("Settings › Locations (cmvgf)", () => {
  it("repeats a location's Frames, Size and Disk free in its details, so they read with those columns hidden", async () => {
    const { catalog, disk } = store.getState()
    const use = locationDiskUse(disk, catalog.locations[SPARE]!)!
    renderAt(`/?locationId=${SPARE}`)
    expect(await fact(m.location_col_frames())).toBe(formatCount(framesInLocation(catalog, SPARE)))
    expect(await fact(m.location_col_size())).toBe(formatBytes(use.footprintBytes))
    expect(await fact(m.location_col_free())).toBe(m.location_free_of({ free: formatBytes(use.freeBytes), capacity: formatBytes(use.capacityBytes) }))
  })

  it("holds no Duplicates review: its issue opens Sessions › Duplicates (F5, F7)", async () => {
    renderAt("/?duplicates=review")
    expect(await screen.findByRole("table", { name: m.common_locations() })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: m.duplicates_review_title() })).toBeNull()
  })
})
