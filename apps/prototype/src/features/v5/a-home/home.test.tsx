import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { setLocale } from "@/app/preferences"
import { Toaster } from "@/components/ui/toast"
import { findInput, liveAssetIds } from "@/domain/derive"
import { pendingWork } from "@/domain/home"
import { sessionLongLabel } from "@/domain/membership"
import { createSeed } from "@/domain/seed"
import type { SessionId } from "@/domain/types"
import { formatNight } from "@/lib/format"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { HomePage } from "./home"

const AT = "2026-10-01T09:00:00.000Z"

function demoState(): PrototypeState {
  return { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
}

/** Home at `/`, with the Toaster its Undo toasts appear in. */
function renderHome() {
  const root = createRootRoute({
    component: () => (
      <>
        <HomePage />
        <Toaster />
      </>
    ),
  })
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

/** Trash every frame of the sessions, so no list shows them. */
function trashSessions(state: PrototypeState, sessionIds: SessionId[]) {
  for (const id of sessionIds) {
    for (const assetId of state.catalog.sessions[id]!.assetIds) state.catalog.assets[assetId] = { ...state.catalog.assets[assetId]!, trashed: { at: AT, episodeId: "trash_home_test" } }
  }
}

/**
 * Clear the rows ahead of Ready to add: trash the sessions that need a Target or calibration or sit in no
 * Project, and review every unreviewed frame as Usable. Returns the first Ready to add row.
 */
function onlyReadyToAdd(state: PrototypeState) {
  for (const w of pendingWork(state)) {
    if (w.kind === "needs-target" || w.kind === "needs-calibration" || w.kind === "not-in-project") trashSessions(state, [w.session.id])
    if (w.kind !== "unreviewed") continue
    for (const id of liveAssetIds(state.catalog, w.session)) {
      const asset = state.catalog.assets[id]!
      state.catalog.assets[id] = { ...asset, quality: { value: "usable", decidedAt: AT, basisSha256: asset.sha256 } }
    }
  }
  const ready = pendingWork(state).find((w) => w.kind === "ready-to-add")
  if (ready?.kind !== "ready-to-add") throw new Error("the demo has no session ready to add")
  return ready
}

// The detail page measures its room; jsdom has no ResizeObserver.
const originalResizeObserver = globalThis.ResizeObserver
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver
})

describe("Home: Add to Project with Undo", () => {
  it("adds a ready suggestion to its Project in one click, and Undo takes it out again", async () => {
    const state = demoState()
    const ready = onlyReadyToAdd(state)
    store.replace(state)
    const project = store.getState().catalog.projects[ready.projectId]!
    const label = sessionLongLabel(m, ready.session)
    const holds = () => findInput(store.getState().catalog.projects[project.id]!, ready.session.id) !== undefined
    expect(holds()).toBe(false)
    const user = userEvent.setup()
    renderHome()
    const pending = await screen.findByRole("table", { name: m.home_pending_work() })
    const row = within(pending).getByRole("rowheader", { name: label }).closest("tr")!
    expect(row).toHaveTextContent(m.home_ready_for({ name: project.name }))

    await user.click(within(row).getByRole("button", { name: m.target_add_to_named({ name: project.name }) }))
    const toast = await screen.findByText(m.session_added_to_project({ session: label, project: project.name }))
    expect(holds()).toBe(true)
    await waitFor(() => expect(within(pending).queryByRole("rowheader", { name: label })).toBeNull())

    await user.click(within(toast.closest<HTMLElement>("[data-slot=toast]")!).getByRole("button", { name: m.wrapup_undo() }))
    await waitFor(() => expect(within(pending).getByRole("rowheader", { name: label })).toBeInTheDocument())
    expect(holds()).toBe(false)
  })
})

describe("Home: the empty line of each section", () => {
  /**
   * The demo library with nothing to do: its Captures locations hold nothing new once the
   * never-scanned NAS one is retired, no jobs, every listed session trashed, and the open
   * Projects' goals removed. The default site stays.
   */
  function emptyHome(): PrototypeState {
    const state = { ...demoState(), operations: {} }
    state.catalog.locations.loc_nas = { ...state.catalog.locations.loc_nas!, retiredAt: AT }
    trashSessions(state, pendingWork(state).map((w) => w.session.id))
    for (const project of Object.values(state.catalog.projects)) project.goals = []
    return state
  }

  /** The demo library at a fixed clock, with one unfinished goal (M 31 L) whose target is moved to `ra`, `dec`. */
  function oneGoalAt(ra: number, dec: number): PrototypeState {
    const state = demoState()
    state.faults = { ...state.faults, clockOffsetMs: Date.parse("2026-10-13T12:00:00.000Z") - Date.now() }
    for (const project of Object.values(state.catalog.projects)) if (project.id !== "prj_m31") project.goals = []
    const target = Object.values(state.catalog.targets).find((t) => t.name === "M 31")!
    state.catalog.targets[target.id] = { ...target, ra, dec }
    return state
  }

  afterEach(() => {
    setLocale(DEFAULT_LOCALE)
  })

  it("says so in en-GB: everything imported, nothing to sort, no unfinished goals with Add a Goal, nothing running", async () => {
    store.replace(emptyHome())
    renderHome()
    expect(await screen.findByText(m.home_everything_imported())).toBeInTheDocument()
    expect(screen.getByText(m.home_nothing_to_sort())).toBeInTheDocument()
    expect(screen.getByText(m.home_no_unfinished_goals())).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.home_add_a_goal() })).toBeInTheDocument()
    expect(screen.getByText(m.home_nothing_running())).toBeInTheDocument()
  })

  it("names the next good night when no goal suits tonight", async () => {
    // At RA 165°, Dec +30° the goal grades poor on 13 Oct and good from 14 Oct at Backyard.
    store.replace(oneGoalAt(165, 30))
    renderHome()
    expect(await screen.findByText(m.home_no_goals_suit_next({ date: formatNight("2026-10-14") }))).toBeInTheDocument()
  })

  it("names no date when no night in the calendar suits a goal", async () => {
    // Dec −80° never rises at Backyard (latitude 52° N).
    store.replace(oneGoalAt(0, -80))
    renderHome()
    expect(await screen.findByText(m.home_no_goals_suit())).toBeInTheDocument()
  })

  it("says nothing runs in pt-BR", async () => {
    setLocale("pt-BR")
    store.replace(emptyHome())
    renderHome()
    expect(await screen.findByText(m.home_nothing_running({}, { locale: "pt-BR" }))).toBeInTheDocument()
    expect(screen.queryByText(m.home_nothing_running({}, { locale: "en-GB" }))).toBeNull()
  })
})
