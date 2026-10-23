import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { framesInLocation } from "@/features/t1/lib/locations"
import { createSeed } from "@/domain/seed"
import { locationDiskUse } from "@/domain/storage"
import { formatBytes, formatCount, formatDate, formatDateTime } from "@/lib/format"
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
  it("shows every column by default, and the Columns menu still hides one (R11)", async () => {
    const user = userEvent.setup()
    renderAt("/")
    const table = await screen.findByRole("table", { name: m.common_locations() })
    const headers = () => within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers()).toEqual(expect.arrayContaining([m.location_col_frames(), m.location_col_size(), m.location_col_free()]))
    await user.click(screen.getByRole("button", { name: m.display_menu_columns() }))
    const items = within(await screen.findByRole("menu")).getAllByRole("menuitemcheckbox")
    expect(items.map((item) => item.getAttribute("aria-checked"))).not.toContain("false")
    await user.click(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: m.location_col_size() }))
    expect(headers()).not.toContain(m.location_col_size())
  })

  it("reads Indexed as the date, with the date and time for screen readers and on hover (R11)", async () => {
    const indexedAt = store.getState().catalog.locations[SPARE]!.lastIndexedAt!
    renderAt("/")
    const row = (await screen.findByRole("rowheader", { name: "Spare captures" })).closest("tr")!
    const time = within(row).getByText(formatDate(indexedAt)).closest("time")!
    expect(time).toHaveAttribute("datetime", indexedAt)
    expect(within(time).getByText(formatDateTime(indexedAt))).toHaveClass("sr-only")
  })

  it("marks the sides of the frame that hide scrolled columns, for the pinned columns' edge cues (R11)", async () => {
    renderAt("/")
    const frame = (await screen.findByRole("table", { name: m.common_locations() })).parentElement!
    Object.defineProperty(frame, "scrollWidth", { configurable: true, value: 900 })
    Object.defineProperty(frame, "clientWidth", { configurable: true, value: 700 })
    const scrollTo = (left: number) => {
      frame.scrollLeft = left
      fireEvent.scroll(frame)
      return [frame.dataset.scrollStart, frame.dataset.scrollEnd]
    }
    expect(scrollTo(0)).toEqual(["false", "true"])
    expect(scrollTo(100)).toEqual(["true", "true"])
    expect(scrollTo(200)).toEqual(["true", "false"])
  })

  it("repeats a location's Frames, Size and Disk free in its details, so they still read once those columns are hidden", async () => {
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

  it("blocks Retire location in its review while sessions pin calibration there, listing them with their Projects (LIB-FR-15)", async () => {
    const user = userEvent.setup()
    renderAt("/")
    await user.click(await screen.findByRole("button", { name: m.actions_for({ name: "Astro-T7 calibration" }) }))
    await user.click(await screen.findByRole("menuitem", { name: new RegExp(`^${m.location_retire()}`) }))
    const dialog = await screen.findByRole("alertdialog", { name: m.location_retire_title({ name: "Astro-T7 calibration" }) })
    // The review's Projects line counts the Projects holding the pinning sessions, Closed and Archived marked.
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining("NGC 7000 OIII test (Closed)"))
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining("Cygnus HOO 2026"))
    expect(within(dialog).getByRole("button", { name: m.location_retire() })).toHaveAttribute("aria-disabled", "true")
    const table = within(dialog).getByRole("table", { name: `${m.actions_blocked({ action: m.location_retire() })} · ${m.location_retire_pinned({ count: 26, n: "26" })}` })
    expect(within(table).getAllByText("NGC 7000 OIII test (Closed)").length).toBeGreaterThan(0)
    expect(within(table).getAllByText(m.location_retire_pin_no_project()).length).toBeGreaterThan(0)
    await user.click(within(dialog).getByRole("button", { name: m.verb_cancel() }))

    await user.click(screen.getByRole("button", { name: m.actions_for({ name: "Spare captures" }) }))
    await user.click(await screen.findByRole("menuitem", { name: new RegExp(`^${m.location_retire()}`) }))
    const spare = await screen.findByRole("alertdialog", { name: m.location_retire_title({ name: "Spare captures" }) })
    expect(within(spare).getByRole("button", { name: m.location_retire() })).not.toHaveAttribute("aria-disabled", "true")
    expect(within(spare).queryByRole("table")).toBeNull()
  })
})
