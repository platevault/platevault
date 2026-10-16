import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { StatusBar } from "@/app/status-bar"
import { issueCopy } from "@/components/app/issue-copy"
import { deriveIssues, type Issue } from "@/domain/issues"
import { sessionLabel } from "@/domain/membership"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { SessionsPage } from "./sessions"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

/** Sessions with the app's status bar under it, so a dismissal shows in the counters (F7). */
function renderSessions() {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <StatusBar />
      </>
    ),
  })
  const route = createRoute({ getParentRoute: () => root, path: "/sessions", component: SessionsPage, validateSearch: (s: Record<string, unknown>) => s })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ["/sessions"] }) })
  render(<RouterProvider router={router} />)
  return userEvent.setup()
}

/** The demo's one session issue: frames of a session that changed after review. */
function sessionIssue(): Issue {
  return deriveIssues(store.getState()).find((i) => i.owner.kind === "session")!
}

function warnings(): number {
  return Number(document.querySelector('[data-status-counter="warning"]')?.getAttribute("data-count") ?? 0)
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, issue: Issue) {
  const session = store.getState().catalog.sessions[issue.about!]!
  const row = document.querySelector<HTMLElement>(`tr[data-row="${issue.about}"]`)!
  await user.click(within(row).getByRole("button", { name: new RegExp(sessionLabel(m, session)) }))
}

describe("Dismiss, Show dismissed and Restore on Sessions (F7, P-ISS1)", () => {
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

  it("dismisses a row's issue from its menu, lists it under Show dismissed and restores it, the counters following", async () => {
    const issue = sessionIssue()
    expect(issue.severity).toBe("warning")
    const text = issueCopy(m, issue).text
    const user = renderSessions()
    await screen.findByRole("table")
    const before = warnings()
    expect(before).toBeGreaterThan(0)

    await openRowMenu(user, issue)
    await user.click(await screen.findByRole("menuitem", { name: m.issue_row_dismiss({ issue: text }) }))
    await waitFor(() => expect(warnings()).toBe(before - 1))
    // The row stays: dismissing hides the issue, not the session.
    expect(document.querySelector(`tr[data-row="${issue.about}"]`)).not.toBeNull()

    await user.click(screen.getByRole("button", { name: m.issues_title() }))
    await user.click(await screen.findByRole("menuitemradio", { name: new RegExp(`^${m.issues_filter_dismissed()}`) }))
    await waitFor(() => expect(document.querySelectorAll("tbody tr[data-row]")).toHaveLength(1))
    expect(document.querySelector(`tr[data-row="${issue.about}"]`)).not.toBeNull()

    await openRowMenu(user, issue)
    await user.click(await screen.findByRole("menuitem", { name: m.issue_row_restore({ issue: text }) }))
    await waitFor(() => expect(warnings()).toBe(before))
    expect(await screen.findByText(m.issues_filter_none_dismissed())).toBeInTheDocument()
    // The last row left the view: focus goes to the toolbar row, not to nothing.
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: m.sessions_search() }))
  })

  it("dismisses and restores a Library count from the Sessions menu", async () => {
    const queue = deriveIssues(store.getState()).find((i) => i.kind === "needs-target")!
    const text = issueCopy(m, queue).text
    const user = renderSessions()
    await screen.findByRole("table")
    const before = warnings()

    await user.click(screen.getByRole("button", { name: m.nav_sessions() }))
    await user.click(await screen.findByRole("menuitem", { name: m.issue_row_dismiss({ issue: text }) }))
    await waitFor(() => expect(warnings()).toBe(before - 1))

    await user.click(screen.getByRole("button", { name: m.nav_sessions() }))
    await user.click(await screen.findByRole("menuitem", { name: m.issue_row_restore({ issue: text }) }))
    await waitFor(() => expect(warnings()).toBe(before))
  })
})
