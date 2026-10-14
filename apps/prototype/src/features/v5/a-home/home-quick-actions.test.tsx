import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Toaster } from "@/components/ui/toast"
import { latestRevision, liveAssetIds } from "@/domain/derive"
import { pendingWork } from "@/domain/home"
import { sessionLongLabel } from "@/domain/membership"
import { createSeed } from "@/domain/seed"
import type { LocationId, Run, SessionId } from "@/domain/types"
import { LocationsPage } from "@/features/t1/settings/locations-page"
import { RunPage } from "@/features/v5/c-runs/run"
import { TargetsPage } from "@/features/v5/e-targets-plan-settings/targets"
import { formatNight } from "@/lib/format"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { setFault } from "@/store/simulation"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { HomePage } from "./home"

const AT = "2026-10-01T09:00:00.000Z"

function demoState(): PrototypeState {
  return { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
}

/** Home at `/`, plus the pages its Open page links lead to, and the Toaster its Undo notices appear in. */
function renderHome() {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <Toaster />
      </>
    ),
  })
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: HomePage }),
    createRoute({ getParentRoute: () => root, path: "/projects/$projectId/runs/$runId/$step", component: RunPage }),
    createRoute({ getParentRoute: () => root, path: "/targets", component: TargetsPage }),
    createRoute({ getParentRoute: () => root, path: "/settings/locations", component: LocationsPage }),
  ]
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
  return router
}

const noUndo = () => expect(screen.queryByRole("button", { name: m.wrapup_undo() })).toBeNull()

// The pages measure their room and keep rows in view; jsdom has neither ResizeObserver nor scrollIntoView.
const original = { resizeObserver: globalThis.ResizeObserver, scrollIntoView: Element.prototype.scrollIntoView }
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = () => {}
})
afterAll(() => {
  globalThis.ResizeObserver = original.resizeObserver
  Element.prototype.scrollIntoView = original.scrollIntoView
})

describe("Home: Add to run under the Quick actions switch, Open page", () => {
  const holds = (run: Run, sessionId: SessionId) => (run.draft ?? latestRevision(run))?.sessions.some((s) => s.sessionId === sessionId) ?? false

  beforeEach(() => {
    // Clear the rows ahead of Ready to add, as home.test.tsx does: trash the sessions without a Target, review the rest as Usable.
    const state = demoState()
    for (const w of pendingWork(state)) {
      if (w.kind === "needs-target") for (const id of state.catalog.sessions[w.session.id]!.assetIds) state.catalog.assets[id] = { ...state.catalog.assets[id]!, trashed: { at: AT, episodeId: "trash_home_test" } }
      if (w.kind !== "unreviewed") continue
      for (const id of liveAssetIds(state.catalog, w.session)) state.catalog.assets[id] = { ...state.catalog.assets[id]!, quality: { value: "usable", decidedAt: AT, basisSha256: state.catalog.assets[id]!.sha256 } }
    }
    store.replace(state)
    setFault("quickActions", "open-page")
  })

  it("adds the session to the draft and opens the run's Select step with its row ticked, with no Undo notice", async () => {
    const run = Object.values(store.getState().catalog.runs).find((r) => r.name === "NGC 7000 OIII deep")!
    const session = store.getState().catalog.sessions.ses_k30zg8!
    const user = userEvent.setup()
    const router = renderHome()
    const pending = await screen.findByRole("table", { name: m.home_pending_work() })
    const row = within(pending).getByRole("rowheader", { name: sessionLongLabel(m, session) }).closest("tr")!

    await user.click(within(row).getByRole("button", { name: m.target_add_to_named({ name: run.name }) }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${run.projectId}/runs/${run.id}/select`))
    expect(holds(store.getState().catalog.runs[run.id]!, session.id)).toBe(true)
    const select = await screen.findByRole("table", { name: m.run_select_sessions_label({ name: run.name }) })
    expect(within(select).getByRole("checkbox", { name: m.table_select_row({ name: `${formatNight(session.night)} ${session.channel}` }) })).toBeChecked()
    noUndo()
  })
})

describe("Home: Add to Plan under the Quick actions switch", () => {
  /** The demo library on 13 Oct, with M 31 L the one unfinished goal, so Tonight lists it with Add to Plan. */
  beforeEach(() => {
    const state = demoState()
    state.faults = { ...state.faults, clockOffsetMs: Date.parse("2026-10-13T12:00:00.000Z") - Date.now() }
    for (const project of Object.values(state.catalog.projects)) if (project.id !== "prj_m31") project.goals = []
    store.replace(state)
  })
  const m31 = () => Object.values(store.getState().catalog.targets).find((t) => t.name === "M 31")!
  const plannedNights = () => Object.values(store.getState().catalog.plans).filter((p) => p.targetId === m31().id).flatMap((p) => p.nights)

  async function addToPlan(user: ReturnType<typeof userEvent.setup>) {
    const tonight = await screen.findByRole("table", { name: m.home_tonight() })
    await user.click(await within(tonight).findByRole("button", { name: m.targets_add_to_plan() }))
  }

  it("One-click adds it to tonight's plan with an Undo notice, and Undo takes it off again", async () => {
    const before = plannedNights()
    const user = userEvent.setup()
    renderHome()
    await addToPlan(user)
    expect(plannedNights()).toHaveLength(before.length + 1)

    const notice = (await screen.findByText(m.home_added_to_plan({ name: m31().name }))).closest<HTMLElement>("[data-slot=toast]")!
    await user.click(within(notice).getByRole("button", { name: m.wrapup_undo() }))
    expect(plannedNights()).toEqual(before)
  })

  it("Open page opens Targets › Planned for tonight with the Target's panel and its Add to Plan, and plans nothing yet", async () => {
    setFault("quickActions", "open-page")
    const before = plannedNights()
    const user = userEvent.setup()
    const router = renderHome()
    await addToPlan(user)

    await waitFor(() => expect(router.state.location.pathname).toBe("/targets"))
    expect(router.state.location.search).toEqual({ view: "planned", open: m31().id })
    expect(plannedNights()).toEqual(before)
    const panel = await screen.findByRole("complementary", { name: m31().name })
    expect(within(panel).getByRole("button", { name: m.targets_add_to_plan() })).toBeInTheDocument()
    noUndo()
  })
})

describe.each([
  // The demo's NAS Captures location was never scanned; Astro-T7 imaging is set to Incomplete here. The demo's running NAS scan is cleared.
  { action: "Scan", locationId: "loc_nas", label: () => m.home_scan(), scope: "never" as const },
  { action: "Rescan", locationId: "loc_imaging", label: () => m.location_rescan(), scope: "incomplete" as const },
])("Home: $action on Pending ingestions under the Quick actions switch (a refresh)", ({ locationId, label, scope }) => {
  const location = () => store.getState().catalog.locations[locationId as LocationId]!
  const scans = () => Object.values(store.getState().operations).filter((op) => op.kind === "index" && op.scope.locationIds?.includes(locationId as LocationId))

  beforeEach(() => {
    const state = { ...demoState(), operations: {} }
    const at = state.catalog.locations[locationId as LocationId]!
    state.catalog.locations[locationId as LocationId] = { ...at, scanScope: scope }
    // Online, so a scan can run.
    state.disk.volumes[at.volumeId] = { ...state.disk.volumes[at.volumeId]!, mounted: true }
    store.replace(state)
  })

  async function press(user: ReturnType<typeof userEvent.setup>) {
    const ingestions = await screen.findByRole("table", { name: m.home_ingestions() })
    const row = within(ingestions).getByRole("rowheader", { name: location().displayName }).closest("tr")!
    await user.click(within(row).getByRole("button", { name: label() }))
  }

  it("One-click scans the location in place, with no Undo notice", async () => {
    const user = userEvent.setup()
    const router = renderHome()
    await press(user)
    expect(scans()).toHaveLength(1)
    expect(router.state.location.pathname).toBe("/")
    noUndo()
  })

  it("Open page opens Settings › Locations with the location's row open, and scans nothing", async () => {
    setFault("quickActions", "open-page")
    const user = userEvent.setup()
    const router = renderHome()
    await press(user)
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/locations"))
    expect(router.state.location.search).toEqual({ locationId })
    expect(scans()).toHaveLength(0)
    expect(await screen.findByRole("button", { name: m.table_row_details({ name: location().displayName }) })).toHaveAttribute("aria-expanded", "true")
  })
})
