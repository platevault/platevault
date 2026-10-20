import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { statusMeta } from "@/components/app/status"
import { sessionLabel } from "@/domain/membership"
import { createSeed } from "@/domain/seed"
import type { CalibrationMaster, Session } from "@/domain/types"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { CalibrationPage } from "./calibration"

// Hide, Restore and Move to Trash on the Calibration library (CAL-FR-16, CAL-FR-17): each panel offers only the verb that
// applies, both are refused while a Project uses the master, Move to Trash lists the sessions it is pinned on and names
// each version's file with its SHA-256. Raw sets and generated-master candidates are listed beside the masters
// (CAL-FR-01, CAL-AC-12).
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

/**
 * The demo's 600 s dark: in the library and pinned on no session, so it can be hidden. The seed writes it 91 days before
 * the demo loads, and a master's id hashes its path, which names that night, so its id changes every day: it is found by
 * kind and exposure.
 */
const UNUSED = { name: "Dark 600 s · 2600MM #1" }
/** The demo's bias that one open Project uses through its sessions. */
const USED = { id: "mst_d1zwvk", name: "Bias · 2600MM #2" }

const masterOf = (id: string): CalibrationMaster => store.getState().catalog.masters[id]!
const unusedMaster = (): CalibrationMaster => Object.values(store.getState().catalog.masters).find((master) => master.kind === "dark" && master.exposureS === 600)!

/** A light session no Project holds: it pins `master`'s only version for darks, as Reassign would. */
function pinOutsideProjects(master: CalibrationMaster): Session {
  const { catalog } = store.getState()
  const held = new Set(Object.values(catalog.projects).flatMap((p) => [...p.inputs.map((i) => i.sessionId), ...Object.keys(p.snapshot?.calibration ?? {})]))
  const session = Object.values(catalog.sessions).find((s) => s.imageType === "light" && !s.supersededBy && s.calibration && !held.has(s.id))!
  const version = master.versions[0]!
  const dark = { state: "pinned" as const, source: { type: "master" as const, masterId: master.id, versionId: version.id }, evidence: { capturedAt: version.capturedAt, apart: 0, rotationDeltaDeg: null, criteria: [], files: [] }, at: "2026-10-12T09:00:00.000Z", by: "user" as const }
  store.setState((s) => ({ ...s, catalog: { ...s.catalog, sessions: { ...s.catalog.sessions, [session.id]: { ...session, calibration: { ...session.calibration!, dark } } } } }))
  return store.getState().catalog.sessions[session.id]!
}

async function detailOf(name: string) {
  return within(await screen.findByRole("complementary", { name }))
}

describe("Calibration library: Hide, Restore and Move to Trash", () => {
  it("hides a master into Hidden and restores it to Masters, the panel offering only the valid verb", async () => {
    const user = userEvent.setup()
    const master = unusedMaster()
    const name = UNUSED.name
    renderPage()

    await user.click(await screen.findByRole("rowheader", { name }))
    let panel = await detailOf(name)
    expect(panel.queryByRole("button", { name: m.calibration_restore_master() })).toBeNull()
    await user.click(panel.getByRole("button", { name: m.calibration_hide_master() }))
    expect(store.getState().catalog.masters[master.id]!.hiddenAt).toBeDefined()

    await user.click(screen.getByRole("tab", { name: new RegExp(`^${m.calibration_hidden()}`) }))
    await user.click(await screen.findByRole("rowheader", { name }))
    panel = await detailOf(name)
    expect(panel.queryByRole("button", { name: m.calibration_hide_master() })).toBeNull()
    expect(panel.queryByRole("button", { name: m.common_move_to_trash() })).toBeNull()
    await user.click(panel.getByRole("button", { name: m.calibration_restore_master() }))
    expect(store.getState().catalog.masters[master.id]!.hiddenAt).toBeUndefined()

    await user.click(screen.getByRole("tab", { name: new RegExp(`^${m.calibration_masters()}`) }))
    expect(await screen.findByRole("rowheader", { name })).toBeDefined()
  })

  it("refuses Hide and Move to Trash while a Project uses the master, and runs neither", async () => {
    const user = userEvent.setup()
    const master = masterOf(USED.id)
    const name = USED.name
    renderPage()

    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByRole("rowheader", { name }))!
    await user.click(within(row).getByRole("button", { name: m.actions_for({ name }) }))
    const menu = await screen.findByRole("menu")
    // Both confirm before they run, so their menu items read "…".
    for (const label of [m.calibration_hide_master(), m.common_move_to_trash()]) {
      const item = within(menu).getByRole("menuitem", { name: `${label}…` })
      expect(item.getAttribute("aria-disabled")).toBe("true")
      expect(item.textContent).toContain(m.equipment_used_by_projects({ count: 1 }))
      await user.click(item)
    }
    expect(store.getState().catalog.masters[master.id]).toEqual(master)
  })

  it("lists the sessions a master is pinned on and each file's SHA-256 before Move to Trash; the sessions then need calibration again", async () => {
    const user = userEvent.setup()
    const master = unusedMaster()
    const session = pinOutsideProjects(master)
    const name = UNUSED.name
    renderPage()

    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByRole("rowheader", { name }))!
    await user.click(within(row).getByRole("button", { name: m.actions_for({ name }) }))
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: `${m.common_move_to_trash()}…` }))
    const dialog = within(await screen.findByRole("alertdialog", { name: m.common_trash_named_title({ name }) }))
    expect(dialog.getByText(m.calibration_sessions_need_again({ count: 1, sessions: sessionLabel(m, session) }))).toBeDefined()
    expect(dialog.getByRole("columnheader", { name: new RegExp(m.storage_sha256()) })).toBeDefined()
    for (const version of master.versions) expect(dialog.getByText(version.adoption?.verifiedSha256 ?? version.sha256)).toBeDefined()
    await user.click(dialog.getByRole("button", { name: m.common_move_to_trash() }))

    expect(store.getState().catalog.masters[master.id]).toBeUndefined()
    expect(store.getState().catalog.sessions[session.id]!.calibration!.dark).toEqual({ state: "waiting" })
  })
})

describe("Calibration library: raw sets and candidates", () => {
  it("lists every raw dark, flat and bias set with its sessions and stacking state (CAL-FR-01); a set no session pins reads –, not 0 sessions", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("tab", { name: new RegExp(`^${m.calibration_raw_sets()}`) }))
    const table = within(await screen.findByRole("table", { name: m.calibration_raw_sets() }))
    const sets = [
      { name: "Flat OIII · 26 Sep", sessions: 1 },
      { name: "Flat Ha · 18 Sep", sessions: 2 },
      { name: "Bias · 8 Sep", sessions: 0 },
      { name: "Dark 120 s · 8 Sep", sessions: 0 },
    ]
    // Grouped by kind, each group heading with its count, then its sets.
    expect(table.getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["Darks 1", "Dark 120 s · 8 Sep", "Flats 2", "Flat OIII · 26 Sep", "Flat Ha · 18 Sep", "Bias 1", "Bias · 8 Sep"])
    for (const set of sets) {
      const row = within(table.getByRole("rowheader", { name: set.name }).closest("tr")!)
      if (set.sessions > 0) expect(row.getByText(m.session_count({ count: set.sessions }))).toBeDefined()
      else expect(row.queryByText(m.session_count({ count: 0 }))).toBeNull()
    }
  })

  it("keeps a generated master whose Output offer was hidden as a candidate, and adds it to the library from there (CAL-AC-12)", async () => {
    const user = userEvent.setup()
    const declined = store.getState().catalog.projects.prj_m31!.masterOffers.find((o) => o.state === "hidden")!
    const name = declined.path.split("/").pop()!
    renderPage()

    await user.click(await screen.findByRole("tab", { name: new RegExp(`^${m.calibration_candidates()}`) }))
    const row = within((await screen.findByRole("rowheader", { name })).closest("tr")!)
    expect(row.getByText(statusMeta("offer", "hidden").label)).toBeDefined()
    await user.click(row.getByRole("button", { name: new RegExp(`^${m.project_output_adopt()}`) }))
    const dialog = within(await screen.findByRole("alertdialog", { name: m.project_output_adopt_title({ name }) }))
    await user.click(dialog.getByRole("button", { name: m.project_output_adopt() }))

    const adopted = Object.values(store.getState().catalog.masters).find((x) => x.versions.some((v) => v.origin.sourcePath === declined.path))
    expect(adopted?.versions.find((v) => v.origin.sourcePath === declined.path)).toMatchObject({ origin: { kind: "generated", projectId: "prj_m31" }, adoption: { verifiedSha256: declined.sha256 } })
    expect(screen.queryByRole("rowheader", { name })).toBeNull()
  })
})
