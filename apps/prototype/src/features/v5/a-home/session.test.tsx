import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { calibrationSources, candidatesFor, sourceKey } from "@/domain/calibration"
import { canJoinProject, findInput, isLocked, joinBlocker, sessionReadiness } from "@/domain/derive"
import { pendingChanges } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import { m, say } from "@/lib/i18n"
import { pickCalibration } from "@/store/actions/calibration"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import type { Action } from "@/components/app/contracts"
import { addToProjectItems } from "./parts"
import { SessionPage } from "./session"

let demo: PrototypeState
const originalResizeObserver = globalThis.ResizeObserver
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

function lights() {
  return Object.values(store.getState().catalog.sessions).filter((s) => s.imageType === "light" && !s.supersededBy)
}

describe("Add to Project from any entry: only Ready and settled sessions (PRJ-FR-08)", () => {
  it("offers each Project unavailable with the join blocker for a session that can't join, and available for one that can", () => {
    const { catalog } = store.getState()
    const blocked = lights().find((s) => sessionReadiness(catalog, s) === "ready" && !canJoinProject(catalog, s))
    expect(blocked, "the demo holds a Ready session whose calibration is not settled").toBeDefined()
    const items = addToProjectItems(m, catalog, [blocked!.id])[0] as { items: Array<{ unavailable?: { reason: string } }> }
    const projectItems = items.items.filter((i) => "unavailable" in i)
    expect(projectItems.length).toBeGreaterThan(0)
    for (const item of projectItems) expect(item.unavailable?.reason).toBe(say(m, joinBlocker(catalog, blocked!)!))
    const ready = lights().find((s) => canJoinProject(catalog, s))
    if (ready) {
      const open = (addToProjectItems(m, catalog, [ready.id])[0] as { items: Array<{ id?: string; unavailable?: unknown }> }).items.filter((i) => i.id?.startsWith("add-to-"))
      for (const item of open) expect(item.unavailable).toBeUndefined()
    }
  })

  it("adds a selection to a Project in one confirmed action, and is unavailable while one of them can't join", async () => {
    const { catalog } = store.getState()
    const free = lights().filter((s) => canJoinProject(catalog, s))
    const project = Object.values(catalog.projects).find((p) => p.state === "open" && free.filter((s) => !findInput(p, s.id)).length >= 2)
    expect(project, "the demo holds an open Project two settled sessions are not in").toBeDefined()
    const ids = free.filter((s) => !findInput(project!, s.id)).slice(0, 2).map((s) => s.id)
    const menu = addToProjectItems(m, catalog, ids)
    // A selection gets the Projects only: New Project… prefills from one session.
    expect(menu).toHaveLength(1)
    const add = (menu[0] as { items: Action[] }).items.find((i) => i.id === `add-to-${project!.id}`)!
    expect(add.unavailable).toBeUndefined()
    expect(add.confirm?.summary).toContain(m.sessions_join_project({ count: 2 }))
    await add.run()
    for (const id of ids) expect(findInput(store.getState().catalog.projects[project!.id]!, id)).toBeDefined()

    // Before the add: one settled session and one that can't join yet, neither in the Project.
    const blocked = lights().find((s) => !canJoinProject(catalog, s) && !findInput(project!, s.id))!
    const mixed = (addToProjectItems(m, catalog, [ids[0]!, blocked.id])[0] as { items: Action[] }).items.find((i) => i.id === `add-to-${project!.id}`)!
    expect(mixed.unavailable?.reason).toBe(m.sessions_cant_join_count({ count: 1 }))
  })
})

function renderSession(sessionId: string) {
  const root = createRootRoute()
  const page = createRoute({ getParentRoute: () => root, path: "/sessions/$sessionId", component: SessionPage })
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [`/sessions/${sessionId}`] }) })
  render(<RouterProvider router={router} />)
}

describe("Reassigning calibration (LIB-AC-30)", () => {
  it("gives an applied open Project holding the session a pending change and leaves a Closed one's snapshot alone", async () => {
    const state = store.getState()
    const holder = Object.values(state.catalog.projects).find((p) => !isLocked(p) && p.view && p.inputs.some((i) => state.catalog.sessions[i.sessionId]?.calibration?.dark.state === "pinned"))
    expect(holder, "the demo holds an applied open Project with a pinned dark").toBeDefined()
    const input = holder!.inputs.find((i) => state.catalog.sessions[i.sessionId]?.calibration?.dark.state === "pinned")!
    const session = state.catalog.sessions[input.sessionId]!
    const pinned = session.calibration!.dark
    const pinnedKey = pinned.state === "pinned" ? sourceKey(pinned.source) : ""
    const other = candidatesFor(state.catalog, state.settings, session, "dark", calibrationSources(state.catalog, state.disk)).find((c) => c.source.key !== pinnedKey)
    expect(other, "another dark version is offered to the session").toBeDefined()
    const closed = Object.values(state.catalog.projects).filter((p) => isLocked(p) && findInput(p, session.id))
    const snapshots = closed.map((p) => structuredClone(p.snapshot))
    expect(pendingChanges(state, holder!).some((c) => c.kind === "calibration-changed" && c.sessionId === session.id)).toBe(false)
    expect(pickCalibration(session.id, "dark", other!.source.source, session.revision).ok).toBe(true)
    const after = store.getState()
    expect(pendingChanges(after, after.catalog.projects[holder!.id]!).some((c) => c.kind === "calibration-changed" && c.sessionId === session.id && c.source === "calibration")).toBe(true)
    closed.forEach((p, i) => expect(after.catalog.projects[p.id]!.snapshot).toEqual(snapshots[i]))

    renderSession(session.id)
    const table = await screen.findByRole("table", { name: m.nav_projects() })
    const row = within(table).getByRole("rowheader", { name: holder!.name }).closest("tr")!
    const count = pendingChanges(after, after.catalog.projects[holder!.id]!).filter((c) => "sessionId" in c && c.sessionId === session.id).length
    await waitFor(() => expect(row).toHaveTextContent(m.session_project_pending({ count })))
    for (const p of closed) expect(within(table).getByRole("rowheader", { name: p.name }).closest("tr")!).toHaveTextContent(m.session_project_snapshot_kept())
  })
})
