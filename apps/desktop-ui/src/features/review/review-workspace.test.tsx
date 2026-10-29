import "@/test/jsdom-render"
import { QueryClientProvider } from "@tanstack/react-query"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Quality } from "@/api/ipc"
import { createQueryClient } from "@/api/query"
import { setLocale, setSingleKeyShortcuts } from "@/app/preferences"
import { ZOOM_LABEL } from "@/components/domain/plate"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { commandsSent, type ReviewHost, reviewHost, SESSION_ID } from "./__fixtures__/review-host"
import { reloadReviewPrefs, ROWS_DEFAULT_PX, setReviewPrefs } from "./prefs"
import { SessionReview } from "./review-workspace"

// Toasts render in the app's toaster, which a component test does not mount: read what was shown instead.
const toasts = vi.hoisted(() => vi.fn())
vi.mock("@/components/app/feedback", async (actual) => ({ ...(await actual<typeof import("@/components/app/feedback")>()), toast: toasts }))

// The plots fit their tick labels by measuring them; jsdom lays out no SVG text.
;(SVGElement.prototype as unknown as { getComputedTextLength: () => number }).getComputedTextLength ??= () => 24

// The workspace, the plate and the corner grid size themselves from their box: report a 1200 × 800 one.
const original = globalThis.ResizeObserver
beforeAll(() => {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 1200, height: 800 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterAll(() => {
  globalThis.ResizeObserver = original
})

let host: ReviewHost

/** The stand-in library host answers every IPC call of the test. */
function installReviewHost(options?: Parameters<typeof reviewHost>[0]): ReviewHost {
  const installed = reviewHost(options)
  mockIPC(installed.handle)
  return installed
}
beforeEach(() => {
  toasts.mockClear()
  localStorage.clear()
  reloadReviewPrefs()
  setSingleKeyShortcuts(true)
})
afterEach(() => {
  clearMocks()
  setLocale(DEFAULT_LOCALE)
})

const nameOf = (n: number) => `M42_Ha_300s_${String(n).padStart(4, "0")}.fits`

async function renderReview({ count = 6, marked = 0, onFinished = vi.fn() }: { count?: number; marked?: number; onFinished?: () => void } = {}) {
  host = installReviewHost({ count, marked })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionReview sessionId={SESSION_ID} onFinished={onFinished} />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(caption()).toContain(`${nameOf(1)} · ${m.review_frame_position({ index: 1, total: count })}`))
  return { onFinished }
}

/** A keydown where the focus is, as the user types it. */
function press(key: string, init: { shift?: boolean; alt?: boolean; mod?: boolean; code?: string } = {}) {
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, code: init.code, shiftKey: init.shift ?? false, altKey: init.alt ?? false, metaKey: init.mod ?? false })
  })
}

function caption(): string {
  return document.querySelector('[data-workspace-pane="current"]')?.textContent ?? ""
}

/** The current frame's asset id, as the list marks it in every view. */
function currentId(): string | null {
  const list = document.querySelector("[data-workspace-list]")
  const marked = list?.querySelector<HTMLElement>('[data-frame-item][aria-current="true"]') ?? list?.querySelector<HTMLElement>('tbody tr[aria-current="true"]')
  return marked?.dataset.frameId ?? marked?.dataset.row ?? null
}

/** Frame `n` is current in the list, and the stage (when one shows) names it at `position` in the list shown. */
async function expectCurrent(n: number, position = n, total = host.frames.length) {
  await waitFor(() => expect(currentId()).toBe(`asset-${n}`))
  if (document.querySelector('[data-workspace-pane="current"]')) expect(caption()).toContain(`${nameOf(n)} · ${m.review_frame_position({ index: position, total })}`)
}

/** The review's status line: its counts and Finish review. */
function statusLine(): string {
  return screen.getByRole("group", { name: m.review_status_line() }).textContent ?? ""
}

function listHeight(): string | null {
  return document.querySelector("[data-workspace-list]")?.getAttribute("data-workspace-list") ?? null
}

function viewShown(): "table" | "filmstrip" | "grid" {
  const thumbs = document.querySelector("[data-frame-thumbnails]")?.getAttribute("data-frame-thumbnails")
  return thumbs === "grid" ? "grid" : thumbs === "strip" ? "filmstrip" : "table"
}

/** The frames the list shows, by name, in every view. */
function listed(): string[] {
  const list = document.querySelector("[data-workspace-list]")!
  const thumbs = [...list.querySelectorAll<HTMLElement>("[data-frame-item]")].map((b) => b.getAttribute("aria-label")!.split(",")[0]!)
  if (thumbs.length > 0) return thumbs
  return [...list.querySelectorAll("tbody tr[data-row] th")].map((th) => th.textContent ?? "")
}

/** The revision each mark named, in order. */
function revisionsSent(): { assetId: string; decisionRevision: number; quality: Quality }[] {
  return commandsSent(host, "pix_session_review_mark").map((c) => {
    const mark = c.args.mark as { asset: { assetId: string; decisionRevision: number }; quality: Quality }
    return { assetId: mark.asset.assetId, decisionRevision: mark.asset.decisionRevision, quality: mark.quality }
  })
}

function marksSent(): { assetId: string; quality: Quality }[] {
  return commandsSent(host, "pix_session_review_mark").map((c) => {
    const mark = c.args.mark as { asset: { assetId: string }; quality: Quality }
    return { assetId: mark.asset.assetId, quality: mark.quality }
  })
}

async function chooseView(view: "table" | "filmstrip" | "grid") {
  if (viewShown() === view) return
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: m.review_display() }))
  const label = view === "table" ? m.review_view_table() : view === "filmstrip" ? m.review_view_filmstrip() : m.review_view_grid()
  await user.click(await screen.findByRole("menuitemradio", { name: label }))
  await waitFor(() => expect(viewShown()).toBe(view))
  // Keys go to the page, as after a click on the frames.
  act(() => (document.activeElement as HTMLElement | null)?.blur())
}

describe("Review list heights (PIX-FR-10, PIX-AC-15)", () => {
  it("cycles about 8 rows, the one-line strip and full height with T, back to the last dragged height", async () => {
    setReviewPrefs({ rowsHeightPx: 300 })
    await renderReview()
    expect(listHeight()).toBe("rows")
    press("t")
    expect(listHeight()).toBe("strip")
    // The strip shows the current frame alone.
    expect(listed()).toEqual([nameOf(1)])
    press("t")
    expect(listHeight()).toBe("full")
    press("t")
    expect(listHeight()).toBe("rows")
    expect(document.querySelector<HTMLElement>("[data-workspace-list]")!.style.getPropertyValue("--workspace-list-h")).toBe("300px")
  })

  it("cycles the same way from the toolbar control", async () => {
    await renderReview()
    const control = screen.getByRole("button", { name: m.review_cmd_height() })
    const user = userEvent.setup()
    await user.click(control)
    expect(listHeight()).toBe("strip")
    await user.click(control)
    expect(listHeight()).toBe("full")
    await user.click(control)
    expect(listHeight()).toBe("rows")
  })

  it("remembers the rows height the separator sets", async () => {
    await renderReview()
    const handle = screen.getByRole("separator")
    act(() => handle.focus())
    fireEvent.keyDown(handle, { key: "ArrowDown" })
    await waitFor(() => expect(JSON.parse(localStorage.getItem("platevault.review")!).rowsHeightPx).toBeGreaterThan(ROWS_DEFAULT_PX))
  })
})

describe("Review filters (D-W14)", () => {
  it("filters to All, Picked, Rejected and Unreviewed with ⌥1 to ⌥4, and the filter reads its choice", async () => {
    await renderReview({ marked: 2 })
    // Frame 3 reads Rejected.
    press("j")
    press("j")
    press("x", { shift: true })
    await waitFor(() => expect(marksSent()).toEqual([{ assetId: "asset-3", quality: "unusable" }]))

    press("3", { alt: true, code: "Digit3" })
    await waitFor(() => expect(listed()).toEqual([nameOf(3)]))
    expect(screen.getByRole("button", { name: new RegExp(m.review_rejected()) })).toBeInTheDocument()
    press("2", { alt: true, code: "Digit2" })
    await waitFor(() => expect(listed()).toEqual([nameOf(1), nameOf(2)]))
    press("4", { alt: true, code: "Digit4" })
    await waitFor(() => expect(listed()).toEqual([nameOf(4), nameOf(5), nameOf(6)]))
    press("1", { alt: true, code: "Digit1" })
    await waitFor(() => expect(listed()).toHaveLength(6))
  })
})

describe.each(["table", "filmstrip", "grid"] as const)("Review hotkeys in the %s (PIX-FR-13)", (view) => {
  beforeEach(async () => {
    await renderReview()
    await chooseView(view)
  })

  it("steps with J, K and the arrows", async () => {
    press("j")
    await expectCurrent(2)
    press("k")
    await expectCurrent(1)
    press("ArrowRight")
    await expectCurrent(2)
    press("ArrowLeft")
    await expectCurrent(1)
    // ↓ steps a grid row (7 columns fit 1200 px), held at the end; elsewhere one frame.
    press("ArrowDown")
    await expectCurrent(view === "grid" ? 6 : 2)
  })

  it("marks with P, X and U and advances after each while auto-advance is on", async () => {
    press("p")
    await expectCurrent(2)
    press("x")
    await expectCurrent(3)
    press("u")
    await expectCurrent(4)
    expect(marksSent()).toEqual([
      { assetId: "asset-1", quality: "usable" },
      { assetId: "asset-2", quality: "unusable" },
      { assetId: "asset-3", quality: "unreviewed" },
    ])
    expect(viewShown()).toBe(view)
  })

  it("advances on Shift+P and Shift+X even with auto-advance off, and stays on P and X", async () => {
    act(() => setReviewPrefs({ autoAdvance: false }))
    press("p")
    await waitFor(() => expect(marksSent()).toHaveLength(1))
    await expectCurrent(1)
    press("x")
    await waitFor(() => expect(marksSent()).toHaveLength(2))
    await expectCurrent(1)
    press("P", { shift: true })
    await expectCurrent(2)
    press("X", { shift: true })
    await expectCurrent(3)
    expect(marksSent().map((s) => s.quality)).toEqual(["usable", "unusable", "usable", "unusable"])
  })

  it("toggles zoom, fullscreen, compare and the corner inspector", async () => {
    // The grid fills the workspace, so its stage is the fullscreen one.
    if (view === "grid") {
      press("f")
      await screen.findByRole("dialog", { name: m.review_cmd_fullscreen() })
    }
    const plate = () => document.querySelector("[data-workspace-pane='current'] [data-plate]")
    await waitFor(() => expect(plate()).not.toBeNull())
    press("z")
    await waitFor(() => expect(plate()?.getAttribute("aria-label")).toContain(ZOOM_LABEL["1"]))
    press("z")
    await waitFor(() => expect(plate()?.getAttribute("aria-label")).toContain(ZOOM_LABEL.fit))

    press("c")
    await waitFor(() => expect(document.querySelector("[data-workspace-pane='reference']")).not.toBeNull())
    press("c")
    await waitFor(() => expect(document.querySelector("[data-workspace-pane='reference']")).toBeNull())

    press("i", { mod: true })
    expect(await screen.findByRole("group", { name: m.review_corners_group({ label: nameOf(1) }) })).toBeInTheDocument()
    press("i", { mod: true })
    await waitFor(() => expect(screen.queryByRole("group", { name: m.review_corners_group({ label: nameOf(1) }) })).toBeNull())

    if (view !== "grid") {
      press("f")
      expect(await screen.findByRole("dialog", { name: m.review_cmd_fullscreen() })).toBeInTheDocument()
    }
    press("f")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.review_cmd_fullscreen() })).toBeNull())
    expect(viewShown()).toBe(view)
  })

  it("toggles the current frame with Space, selects all shown with ⌘A, and asks before marking that selection", async () => {
    press(" ")
    expect(statusLine()).toContain(m.status_bar_selected({ count: 1 }))
    press("Escape")
    await waitFor(() => expect(statusLine()).not.toContain(m.status_bar_selected({ count: 1 })))

    press("a", { mod: true })
    expect(statusLine()).toContain(m.status_bar_selected({ count: 6 }))
    press("x")
    const said = { count: 6, n: 6, quality: m.status_unusable() }
    const dialog = await screen.findByRole("alertdialog", { name: m.review_bulk_mark_title(said) })
    expect(marksSent()).toEqual([])
    await userEvent.setup().click(within(dialog).getByRole("button", { name: m.store_label_mark_frames(said) }))
    await waitFor(() => expect(marksSent()).toHaveLength(6))
    expect(new Set(marksSent().map((s) => s.quality))).toEqual(new Set(["unusable"]))
  })

  it("filters with ⌥4 and keeps the view", async () => {
    press("p")
    await expectCurrent(2)
    press("4", { alt: true, code: "Digit4" })
    await waitFor(() => expect(listed()).not.toContain(nameOf(1)))
    expect(viewShown()).toBe(view)
  })
})

describe("Review views share one list (PIX-FR-11, PIX-AC-16)", () => {
  it("keeps the selection, current frame, filter and sort across the table, filmstrip and grid", async () => {
    await renderReview()
    press("j")
    press(" ")
    press("j")
    press(" ")
    expect(statusLine()).toContain(m.status_bar_selected({ count: 2 }))
    // Sort by Frame, descending: the list's order in every view.
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: new RegExp(`^${m.review_col_frame()}`) }))
    await user.click(screen.getByRole("button", { name: new RegExp(`^${m.review_col_frame()}`) }))
    const order = listed()
    expect(order[0]).toBe(nameOf(6))

    press("g")
    await waitFor(() => expect(viewShown()).toBe("grid"))
    expect(listed()).toEqual(order)
    // Frame 3 is fourth in the descending order.
    await expectCurrent(3, 4)
    expect(document.querySelector('[data-frame-id="asset-2"]')).toHaveAttribute("aria-pressed", "true")
    expect(document.querySelector('[data-frame-id="asset-3"]')).toHaveAttribute("aria-pressed", "true")
    expect(document.querySelector('[data-frame-id="asset-3"]')).toHaveAttribute("aria-current", "true")

    // A mark on the two selected frames, from the grid.
    press("x")
    await waitFor(() =>
      expect(marksSent()).toEqual([
        { assetId: "asset-2", quality: "unusable" },
        { assetId: "asset-3", quality: "unusable" },
      ]),
    )

    await chooseView("filmstrip")
    expect(listed()).toEqual(order)
    expect(document.querySelector('[data-frame-id="asset-2"]')).toHaveAttribute("aria-pressed", "true")
    press("g")
    press("g")
    await chooseView("table")
    expect(listed()).toEqual(order)
    expect(statusLine()).toContain(m.status_bar_selected({ count: 2 }))
  })
})

describe("Review refusals and sources", () => {
  it("keeps the current frame and says why when the library refuses a stale mark", async () => {
    await renderReview()
    // Another window marked frame 1 since this list was read.
    host.frames[0] = { ...host.frames[0]!, asset: { ...host.frames[0]!.asset, decisionRevision: 7 } }
    const reads = commandsSent(host, "pix_session_review_list").length
    press("p")
    expect(await screen.findByText(m.action_failure_conflict())).toBeInTheDocument()
    await expectCurrent(1)
    // The list is read again, so the next mark names the current revision.
    await waitFor(() => expect(commandsSent(host, "pix_session_review_list").length).toBeGreaterThan(reads))
    press("p")
    await expectCurrent(2)
  })

  it("names an offline frame's reason on the stage and on its thumbnail", async () => {
    host = installReviewHost()
    const offline = host.frames[0]!
    host.frames[0] = { ...offline, asset: { ...offline.asset, availability: "offline" }, state: { ...offline.state, availability: "offline" } }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionReview sessionId={SESSION_ID} onFinished={vi.fn()} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(caption()).toContain(nameOf(1)))
    expect(within(document.querySelector<HTMLElement>("[data-workspace-pane='current']")!).getByText(m.status_offline(), { exact: false })).toBeInTheDocument()
    expect(commandsSent(host, "pix_open_frame")).toEqual([])
    press("g")
    expect(await screen.findByRole("button", { name: `${nameOf(1)}, ${m.status_unreviewed()}, ${m.status_offline()}` })).toBeInTheDocument()
  })

  it("words the review in Portuguese", async () => {
    setLocale("pt-BR")
    await renderReview()
    // The toolbar names its controls from the pt-BR catalogue.
    expect(screen.getByRole("button", { name: "Alternar altura da tabela" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.review_display() })).toBeInTheDocument()
  })
})

describe("Finish review (409cm.6)", () => {
  it("is unavailable while a frame is Unreviewed, and ⌘↩ sends nothing then", async () => {
    const { onFinished } = await renderReview({ marked: 5 })
    press("Enter", { mod: true })
    expect(commandsSent(host, "pix_finish_review")).toEqual([])
    expect(onFinished).not.toHaveBeenCalled()
  })

  it("runs only the Review step's own action at the read grouping revision, then hands over", async () => {
    const { onFinished } = await renderReview({ marked: 6 })
    press("Enter", { mod: true })
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1))
    expect(commandsSent(host, "pix_finish_review").map((c) => c.args)).toEqual([{ sessionId: SESSION_ID, expectedGroupingRevision: 4 }])
    // Nothing of another step: no Target or Rig confirmation, no other write.
    expect(new Set(host.calls.map((c) => c.command))).toEqual(new Set(["pix_session_review_list", "pix_open_frame", "pix_preview_tile", "pix_finish_review"]))
  })

  it("does not hand over when the grouping changed since the list was read", async () => {
    const { onFinished } = await renderReview({ marked: 6 })
    host.groupingRevision = 5
    press("Enter", { mod: true })
    expect(await screen.findByText(m.action_failure_conflict())).toBeInTheDocument()
    expect(onFinished).not.toHaveBeenCalled()
  })
})

describe("Review marks in flight", () => {
  it("names the revision the first mark recorded when U follows P on one frame at once", async () => {
    await renderReview()
    act(() => setReviewPrefs({ autoAdvance: false }))
    press("p")
    press("u")
    await waitFor(() => expect(revisionsSent()).toHaveLength(2))
    expect(revisionsSent()).toEqual([
      { assetId: "asset-1", decisionRevision: 1, quality: "usable" },
      { assetId: "asset-1", decisionRevision: 2, quality: "unreviewed" },
    ])
    expect(screen.queryByText(m.action_failure_conflict())).toBeNull()
  })

  it("keeps the frame the user moved to while a mark was under way", async () => {
    await renderReview()
    let release!: () => void
    host.hold = new Promise((resolve) => {
      release = resolve
    })
    press("p")
    press("j")
    press("j")
    await expectCurrent(3)
    act(() => release())
    await waitFor(() => expect(marksSent()).toEqual([{ assetId: "asset-1", quality: "usable" }]))
    await waitFor(() => expect(statusLine()).toContain(m.flow_frames_unreviewed({ count: 5 })))
    await expectCurrent(3)
  })

  it("says how many frames a selection mark had marked when the library refused the rest", async () => {
    await renderReview()
    press(" ")
    press("j")
    press(" ")
    // Another window marked frame 2 since this list was read.
    host.frames[1] = { ...host.frames[1]!, asset: { ...host.frames[1]!.asset, decisionRevision: 9 } }
    press("x")
    expect(await screen.findByText(m.action_failure_conflict())).toBeInTheDocument()
    expect(toasts).toHaveBeenCalledWith({ message: m.review_marked_before_refusal({ marked: "1", total: "2" }) })
  })
})

describe("Review keys stay quiet where they do not belong", () => {
  it("marks nothing when the ⌘A confirmation is cancelled, and the keys wait while it is open", async () => {
    await renderReview()
    press("a", { mod: true })
    press("p")
    const dialog = await screen.findByRole("alertdialog")
    press("j")
    expect(currentId()).toBe("asset-1")
    await userEvent.setup().click(within(dialog).getByRole("button", { name: m.verb_cancel() }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(marksSent()).toEqual([])
  })

  it("leaves a text field's keys to it", async () => {
    await renderReview()
    const field = document.createElement("input")
    document.body.append(field)
    act(() => field.focus())
    press("p")
    press("j")
    press("a", { mod: true })
    expect(marksSent()).toEqual([])
    expect(currentId()).toBe("asset-1")
    expect(statusLine()).not.toContain(m.status_bar_selected({ count: 6 }))
    field.remove()
  })

  it("waits while a menu is open", async () => {
    await renderReview()
    await userEvent.setup().click(screen.getByRole("button", { name: m.review_display() }))
    await screen.findByRole("menu")
    press("j")
    press("x")
    expect(currentId()).toBe("asset-1")
    expect(marksSent()).toEqual([])
  })

  it("leaves Space on a row's checkbox to the checkbox instead of ticking the current frame (FR-037)", async () => {
    await renderReview()
    const checkbox = screen.getByRole("checkbox", { name: new RegExp(nameOf(3)) })
    act(() => checkbox.focus())
    act(() => {
      fireEvent.keyDown(checkbox, { key: " " })
      fireEvent.keyUp(checkbox, { key: " " })
    })
    // The current frame (1) is not ticked by Review's Space.
    expect(screen.getByRole("checkbox", { name: new RegExp(nameOf(1)) })).not.toBeChecked()
    expect(currentId()).toBe("asset-1")
  })
})

describe("Review thumbnails", () => {
  it("keeps the thumbnails already read when the filter or sort changes", async () => {
    await renderReview({ marked: 2 })
    press("g")
    await waitFor(() => expect(document.querySelectorAll("[data-frame-item] img")).toHaveLength(6))
    const reads = commandsSent(host, "pix_thumbnails").length
    press("2", { alt: true, code: "Digit2" })
    await waitFor(() => expect(listed()).toEqual([nameOf(1), nameOf(2)]))
    expect(document.querySelectorAll("[data-frame-item] img")).toHaveLength(2)
    expect(commandsSent(host, "pix_thumbnails")).toHaveLength(reads)
  })
})
