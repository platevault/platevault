import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { setSingleKeyShortcuts } from "@/app/preferences"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { SessionReview } from "./review"

// M 31 L on 2 Sep in the demo library: 60 frames.
const SESSION = "ses_573cbz"
type User = ReturnType<typeof userEvent.setup>

function renderReview() {
  const root = createRootRoute({ component: () => <Outlet /> })
  const route = createRoute({ getParentRoute: () => root, path: "/sessions/$sessionId", component: () => <SessionReview sessionId={SESSION} /> })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/sessions/${SESSION}?step=review`] }) })
  render(<RouterProvider router={router} />)
}

const list = () => screen.findByRole("table", { name: m.review_frames_in_review() })
const frameRows = (table: HTMLElement) => Array.from(table.querySelectorAll<HTMLElement>(":scope > tbody > tr[data-row]"))
const currentRow = (table: HTMLElement) => table.querySelector<HTMLElement>(":scope > tbody > tr[aria-current=true]")

/** Tabs on until `element` has focus. */
async function tabTo(user: User, element: HTMLElement) {
  for (let i = 0; i < 80 && document.activeElement !== element; i++) await user.tab()
  expect(element).toHaveFocus()
}

// The workspace measures its panes and keeps the current row in view; jsdom has neither ResizeObserver nor scrollIntoView.
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

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

// P-KBD1 in Review: the frame list's current row is the current frame, and focus moves with it.
describe("Review frame list keyboard (P-KBD1)", () => {
  it("Tab enters on the current frame; ↓, End and Home move the current frame and focus together", async () => {
    const user = userEvent.setup({ delay: null })
    renderReview()
    const table = await list()
    const rows = frameRows(table)
    await tabTo(user, currentRow(table)!)
    expect(currentRow(table)).toBe(rows[0])

    await user.keyboard("{ArrowDown}")
    await waitFor(() => expect(currentRow(table)).toBe(rows[1]))
    expect(rows[1]).toHaveFocus()
    await user.keyboard("{End}")
    await waitFor(() => expect(currentRow(table)).toBe(rows.at(-1)))
    expect(rows.at(-1)).toHaveFocus()
    await user.keyboard("{Home}")
    await waitFor(() => expect(currentRow(table)).toBe(rows[0]))
    expect(rows[0]).toHaveFocus()
  })

  it("Tab from the list leaves after the current row's checkbox and ⋯", async () => {
    const user = userEvent.setup({ delay: null })
    renderReview()
    const table = await list()
    await tabTo(user, currentRow(table)!)
    await user.keyboard("{ArrowDown}")
    const row = await waitFor(() => {
      const current = currentRow(table)
      expect(current).toHaveFocus()
      return current!
    })
    await user.tab()
    expect(within(row).getByRole("checkbox")).toHaveFocus()
    await user.tab()
    expect(row.querySelector("[data-row-actions]")).toHaveFocus()
    await user.tab()
    expect(table).not.toContainElement(document.activeElement as HTMLElement)
  })

  it("Space ticks the current frame with single-key shortcuts on; with them off only its checkbox takes Space", async () => {
    const user = userEvent.setup({ delay: null })
    renderReview()
    const table = await list()
    const row = currentRow(table)!
    const checkbox = within(row).getByRole("checkbox")
    await tabTo(user, row)
    await user.keyboard(" ")
    await waitFor(() => expect(checkbox).toBeChecked())
    await user.keyboard(" ")
    await waitFor(() => expect(checkbox).not.toBeChecked())

    setSingleKeyShortcuts(false)
    try {
      await user.keyboard(" ")
      expect(checkbox).not.toBeChecked()
      await user.tab()
      expect(checkbox).toHaveFocus()
      await user.keyboard(" ")
      await waitFor(() => expect(checkbox).toBeChecked())
    } finally {
      setSingleKeyShortcuts(true)
    }
  })
})
