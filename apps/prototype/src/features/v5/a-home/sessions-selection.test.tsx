import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sessionLabel } from "@/domain/membership"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { SessionsPage } from "./sessions"
import { openHolder, type SessionRow, sessionRows } from "./session-model"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

// The status bar and the dock measure their room; jsdom has no ResizeObserver.
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

function renderSessions() {
  const root = createRootRoute()
  const route = createRoute({ getParentRoute: () => root, path: "/sessions", component: () => <SessionsPage />, validateSearch: (s: Record<string, unknown>) => s })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ["/sessions"] }) })
  render(<RouterProvider router={router} />)
  return userEvent.setup()
}

function rows(): SessionRow[] {
  return sessionRows(store.getState()).filter((r) => !r.trashed)
}

function shownRows(): number {
  return document.querySelectorAll("tbody tr[data-row]").length
}

async function select(user: ReturnType<typeof userEvent.setup>, row: SessionRow) {
  await user.click(screen.getByRole("checkbox", { name: m.table_select_row({ name: sessionLabel(m, row.session) }) }))
}

describe("Sessions filters (astro-plan-je4af)", () => {
  it("Needs review and Not in any Project narrow the table to their sessions", async () => {
    const user = renderSessions()
    await screen.findByRole("table")
    const all = shownRows()
    for (const [label, count] of [
      [m.status_needs_review(), rows().filter((r) => r.queued).length],
      [m.sessions_filter_not_in_project(), rows().filter((r) => r.notInProject).length],
    ] as const) {
      expect(count, `the demo holds sessions under ${label}`).toBeGreaterThan(0)
      expect(count).toBeLessThan(all)
      await user.click(screen.getByRole("button", { name: new RegExp(`^${m.sessions_facet_status()}`) }))
      await user.click(await screen.findByRole("menuitemradio", { name: new RegExp(`^${label}`) }))
      await waitFor(() => expect(shownRows()).toBe(count))
    }
  })
})

describe("Sessions selection (astro-plan-je4af)", () => {
  it("replaces the toolbar row and offers every session action", async () => {
    const user = renderSessions()
    await screen.findByRole("table")
    await select(user, rows()[0]!)
    const bar = await screen.findByRole("region", { name: m.selection_region() })
    // The bar takes the toolbar row's place: the search is gone while rows are selected.
    expect(screen.queryByRole("searchbox", { name: m.sessions_search() })).toBeNull()
    for (const label of [m.session_review_frames(), `${m.wrapup_archive_title()}…`, `${m.sessions_confirm_suggestions()}…`]) expect(within(bar).getByRole("button", { name: label })).toBeInTheDocument()
    await user.click(within(bar).getByRole("button", { name: m.common_more() }))
    const menu = await screen.findByRole("menu")
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.getAttribute("aria-label") ?? item.textContent)
    for (const label of [m.session_choose_target(), m.session_choose_rig(), m.session_add_to_project()]) expect(items.some((item) => item?.startsWith(label))).toBe(true)
  })

  it("Archive… is unavailable for a session an open Project holds and previews it as a Session · Project table", async () => {
    const held = rows().find((r) => openHolder(r) !== undefined)
    expect(held, "the demo holds a session in an open Project").toBeDefined()
    const project = openHolder(held!)!
    const user = renderSessions()
    await screen.findByRole("table")
    await select(user, held!)
    const archive = within(await screen.findByRole("region", { name: m.selection_region() })).getByRole("button", { name: `${m.wrapup_archive_title()}…` })
    expect(archive).toHaveAttribute("aria-disabled", "true")
    act(() => archive.focus())
    const card = await waitFor(() => {
      const element = document.querySelector<HTMLElement>("[data-preview]")
      if (!element) throw new Error("no card yet")
      return element
    })
    const table = within(card).getByRole("table")
    expect(within(table).getByRole("columnheader", { name: new RegExp(m.project_noun()) })).toBeInTheDocument()
    expect(within(table).getByRole("rowheader", { name: sessionLabel(m, held!.session) })).toBeInTheDocument()
    expect(within(table).getByRole("link", { name: project.name })).toHaveAttribute("href", `/projects/${project.id}`)
  })
})
