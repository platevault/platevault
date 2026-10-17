import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Toaster } from "@/components/ui/toast"
import { createSeed } from "@/domain/seed"
import { formatCount } from "@/lib/format"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { setFault } from "@/store/simulation"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { type ReviewBucket, reviewScope } from "./model"
import { SessionReview } from "./review"

// M 31 L on 2 Sep in the demo library: 60 frames, most Usable, a few Unusable, and one whose decision no longer applies (Unreviewed).
const SESSION = "ses_573cbz"
const CONTEXT = { kind: "session", sessionId: SESSION } as const

const frames = () => reviewScope(store.getState(), CONTEXT)!.frames
const buckets = (): Record<string, ReviewBucket> => Object.fromEntries(frames().map((f) => [f.asset.id, f.bucket]))
const count = (bucket: ReviewBucket) => frames().filter((f) => f.bucket === bucket).length
const frameCount = (n: number) => ({ count: n, n: formatCount(n) })

function renderReview() {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <Toaster />
      </>
    ),
  })
  const route = createRoute({ getParentRoute: () => root, path: "/sessions/$sessionId", component: () => <SessionReview sessionId={SESSION} /> })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/sessions/${SESSION}?step=review`] }) })
  render(<RouterProvider router={router} />)
}

/** The Undo of the toast that reads `message`. */
async function undoOf(message: string): Promise<HTMLElement> {
  const notice = (await screen.findByText(message)).closest<HTMLElement>("[data-slot=toast]")!
  return within(notice).getByRole("button", { name: m.wrapup_undo() })
}

/** Selects every frame and returns the batch bar. */
async function selectAll(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const table = await screen.findByRole("table", { name: m.review_frames_in_review() })
  await user.click(within(table).getByRole("checkbox", { name: m.table_select_all({ count: frames().length }) }))
  return screen.findByRole("region", { name: m.selection_region() })
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

describe("Review: a mark on more than 20 frames under the Quick actions switch (A3)", () => {
  it("One-click marks at once with an Undo notice, and Undo puts every frame back in its bucket", async () => {
    const before = buckets()
    expect(count("picked")).toBeGreaterThan(0)
    expect(count("rejected")).toBeGreaterThan(0)
    expect(count("unreviewed")).toBeGreaterThan(0)
    const user = userEvent.setup()
    renderReview()

    await user.click(within(await selectAll(user)).getByRole("button", { name: m.status_unusable() }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(count("rejected")).toBe(frames().length)

    await user.click(await undoOf(m.store_saved_frames_marked({ ...frameCount(frames().length), quality: m.status_unusable() })))
    expect(buckets()).toEqual(before)
  })

  it("Open page keeps the confirm, and marks with no Undo notice", async () => {
    setFault("quickActions", "open-page")
    const before = buckets()
    const user = userEvent.setup()
    renderReview()

    await user.click(within(await selectAll(user)).getByRole("button", { name: `${m.status_unusable()}…` }))
    const total = frames().length
    const dialog = await screen.findByRole("alertdialog", { name: m.review_bulk_mark_title({ ...frameCount(total), quality: m.status_unusable() }) })
    expect(buckets()).toEqual(before)
    await user.click(within(dialog).getByRole("button", { name: m.store_label_mark_frames({ ...frameCount(total), quality: m.status_unusable() }) }))
    await waitFor(() => expect(count("rejected")).toBe(total))
    expect(screen.queryByText(m.store_saved_frames_marked({ ...frameCount(total), quality: m.status_unusable() }))).toBeNull()
  })
})

describe("Review: Mark rest usable under the Quick actions switch (A4)", () => {
  it("One-click marks at once with an Undo notice, and Undo sets those frames back to Unreviewed", async () => {
    const before = buckets()
    const rest = count("unreviewed")
    const user = userEvent.setup()
    renderReview()

    await user.click(await screen.findByRole("button", { name: m.review_mark_rest_usable() }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(count("unreviewed")).toBe(0)

    await user.click(await undoOf(m.store_saved_frames_marked({ ...frameCount(rest), quality: m.status_usable() })))
    expect(buckets()).toEqual(before)
  })

  it("Open page keeps the confirm, worded as every bulk mark's, and marks with no Undo notice", async () => {
    setFault("quickActions", "open-page")
    const rest = count("unreviewed")
    const user = userEvent.setup()
    renderReview()

    await user.click(await screen.findByRole("button", { name: `${m.review_mark_rest_usable()}…` }))
    const dialog = await screen.findByRole("alertdialog", { name: m.review_bulk_mark_title({ ...frameCount(rest), quality: m.status_usable() }) })
    expect(count("unreviewed")).toBe(rest)
    await user.click(within(dialog).getByRole("button", { name: m.store_label_mark_frames({ ...frameCount(rest), quality: m.status_usable() }) }))
    await waitFor(() => expect(count("unreviewed")).toBe(0))
    expect(screen.queryByText(m.store_saved_frames_marked({ ...frameCount(rest), quality: m.status_usable() }))).toBeNull()
  })
})
