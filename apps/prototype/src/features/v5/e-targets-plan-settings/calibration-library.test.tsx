import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import type { CalibrationMaster } from "@/domain/types"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { masterLabel } from "./calibration-model"
import { CalibrationPage } from "./calibration"

// Hide and Show on the Calibration library (P-CAL2, C2): each panel offers only the verb that applies.
let demo: PrototypeState
// DetailDock measures its room; jsdom has no ResizeObserver and lays nothing out.
const original = globalThis.ResizeObserver
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
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
  store.replace(structuredClone(demo))
})

function renderPage() {
  const root = createRootRoute()
  const calibration = createRoute({ getParentRoute: () => root, path: "/calibration", component: CalibrationPage, validateSearch: (search: Record<string, unknown>) => search })
  const router = createRouter({ routeTree: root.addChildren([calibration]), history: createMemoryHistory({ initialEntries: ["/calibration"] }) })
  render(<RouterProvider router={router} />)
}

/** The 600 s dark: in the library and handed off by no run, so it can be hidden. */
function unusedMaster(): CalibrationMaster {
  return Object.values(store.getState().catalog.masters).find((x) => x.exposureS === 600)!
}

async function panelOf(name: string) {
  return within(await screen.findByRole("complementary", { name }))
}

describe("Calibration library: Hide and Show", () => {
  it("hides a master into Hidden and shows it back in Masters, the panel offering only the valid verb", async () => {
    const user = userEvent.setup()
    const master = unusedMaster()
    const name = masterLabel(m, master)
    renderPage()

    await user.click(await screen.findByRole("rowheader", { name }))
    let panel = await panelOf(name)
    expect(panel.queryByRole("button", { name: m.calibration_show_master() })).toBeNull()
    await user.click(panel.getByRole("button", { name: m.calibration_hide_master() }))
    expect(store.getState().catalog.masters[master.id]!.dismissedAt).toBeDefined()

    await user.click(screen.getByRole("tab", { name: new RegExp(`^${m.calibration_hidden()}`) }))
    await user.click(await screen.findByRole("rowheader", { name }))
    panel = await panelOf(name)
    expect(panel.queryByRole("button", { name: m.calibration_hide_master() })).toBeNull()
    await user.click(panel.getByRole("button", { name: m.calibration_show_master() }))
    expect(store.getState().catalog.masters[master.id]!.dismissedAt).toBeUndefined()

    await user.click(screen.getByRole("tab", { name: new RegExp(`^${m.calibration_masters()}`) }))
    expect(await screen.findByRole("rowheader", { name })).toBeDefined()
  })

  it("offers Restore offer, never Hide, for a dismissed offer in Hidden", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("tab", { name: new RegExp(`^${m.calibration_hidden()}`) }))
    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText(m.calibration_offer_dismissed()))!
    const name = within(row).getByRole("rowheader").textContent!
    await user.click(within(row).getByRole("rowheader"))
    const panel = await panelOf(name)
    expect(panel.getByRole("button", { name: m.store_cal_restore_offer() })).toBeDefined()
    expect(panel.queryByRole("button", { name: m.calibration_hide_master() })).toBeNull()

    await user.click(within(row).getByRole("button", { name: m.actions_for({ name }) }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).queryByRole("menuitem", { name: m.calibration_hide_master() })).toBeNull()
    expect(within(menu).getByRole("menuitem", { name: m.store_cal_restore_offer() })).toBeDefined()
  })
})
