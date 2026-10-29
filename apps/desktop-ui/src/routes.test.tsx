/**
 * The registered session route hosts the real review workspace on intake's
 * Review step: the router injects `SessionReview` (features/review) into the
 * Library area's intake (`SessionIntakeProps`), so neither feature imports
 * the other. The library host is mocked: the review fixture answers the
 * workspace, and the session reads answer intake.
 */
import "@/test/jsdom-render"
import { createMemoryHistory } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { createQueryClient } from "@/api/query"
import { setLocale } from "@/app/preferences"
import { AppRoot } from "@/app/root"
import { commandsSent, type ReviewHost, reviewHost, SESSION_ID } from "@/features/review/__fixtures__/review-host"
import { DEFAULT_LOCALE, LOCALES, m } from "@/lib/i18n"
import { createAppRouter } from "@/routes"

const TEST_MS = 20_000

// The plots fit their tick labels by measuring them; jsdom lays out no SVG text.
;(SVGElement.prototype as unknown as { getComputedTextLength: () => number }).getComputedTextLength ??= () => 24

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
// Unmount first: the listeners detach through the mocked host, which clearMocks removes.
afterEach(() => {
  cleanup()
  clearMocks()
  setLocale(DEFAULT_LOCALE)
})

const KEY = "capture-v1|type=light|night=2026-09-12@date-loc-noon|filter=Ha|exposure_s=300"

function librarySession() {
  const session = { id: SESSION_ID, key: KEY, groupingRevision: 4, decisionRevision: 7, assetIds: [], provisional: [], dateBasis: "date-loc-noon" }
  return {
    detail: { summary: { session, locationIds: [], assetCount: 6, captureCount: 6, availability: "available", lastObservedAt: null, provisional: false, successors: [] }, assets: [], members: [], associations: [], lineage: [] },
    targetAssessments: [],
  }
}

type Readiness = "needs_target" | "needs_review" | "ready"

function admission(readiness: Readiness) {
  const unresolved = { state: "unresolved" }
  const targetConfirmed = readiness !== "needs_target"
  return {
    intake: { sessionId: SESSION_ID, groupingRevision: 4, superseded: false, targetConfirmed, rigId: targetConfirmed ? "rig-1" : null, reviewFinished: readiness === "ready", unreviewedFrames: 0, changedFrames: 0 },
    calibration: { sessionId: SESSION_ID, generation: 0, matchingPending: false, dark: unresolved, flat: unresolved, bias: unresolved },
    health: { bias: "intact", dark: "intact", flat: "intact" },
    blockers: readiness === "ready" ? [] : [{ blocker: "not_ready", readiness }],
  }
}

/** The library host: the review fixture answers the workspace, `readiness()` the intake admission as it stands. */
function installHost(review: ReviewHost, readiness: () => Readiness) {
  mockIPC((command, payload) => {
    if (command === "plugin:event|listen") return (payload as { handler?: unknown } | undefined)?.handler
    if (command === "plugin:event|unlisten") return null
    if (command === "library_session") return librarySession()
    if (command === "pix_session_intake") return admission(readiness())
    if (command === "library_issues") return { issues: [], dismissed: [], counts: { danger: 0, warning: 0, info: 0 }, pages: [] }
    if (command === "library_list_locations") return []
    if (command === "rig_filters_get") return null
    if (command.startsWith("pix_")) return review.handle(command, payload)
    return null
  })
}

function openReviewStep() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [`/sessions/${SESSION_ID}?step=review`] }))
  render(<AppRoot router={router} client={createQueryClient()} />)
  return router
}

const caption = () => document.querySelector('[data-workspace-pane="current"]')?.textContent ?? ""
const frameName = (n: number) => `M42_Ha_300s_000${n}.fits`

/** A keydown where the focus is, as the user types it. */
function press(key: string, init: { shift?: boolean; mod?: boolean } = {}) {
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, shiftKey: init.shift ?? false, metaKey: init.mod ?? false })
  })
}

describe("session intake with the registered review", { timeout: TEST_MS }, () => {
  it("renders the real review workspace on Review and opens the session once Finish review succeeds", async () => {
    const review = reviewHost({ marked: 6 })
    installHost(review, () => (commandsSent(review, "pix_finish_review").length > 0 ? "ready" : "needs_review"))
    const router = openReviewStep()
    // The workspace's own frame list and caption: the real body, not a stand-in.
    await waitFor(() => expect(caption()).toContain(frameName(1)), { timeout: TEST_MS })
    press("Enter", { mod: true })
    await waitFor(() => expect(commandsSent(review, "pix_finish_review").map((c) => c.args)).toEqual([{ sessionId: SESSION_ID, expectedGroupingRevision: 4 }]), { timeout: TEST_MS })
    await waitFor(() => expect(router.state.location.search).toEqual({}), { timeout: TEST_MS })
    expect(await screen.findByRole("heading", { level: 1 }, { timeout: TEST_MS })).toHaveTextContent("12 Sep · Ha")
  })

  // astro-plan-ocyuc.11: Review stays read-only until Target and rig are confirmed.
  it.each(LOCALES)("%s: on the locked Review step, P, X, U and ⌘↩ send nothing, and the step to confirm first is named", async (locale) => {
    setLocale(locale)
    const review = reviewHost({ marked: 6 })
    installHost(review, () => "needs_target")
    openReviewStep()
    await waitFor(() => expect(caption()).toContain(frameName(1)), { timeout: TEST_MS })
    for (const key of ["p", "x", "u"]) press(key)
    press("p", { shift: true })
    press("Enter", { mod: true })
    // Viewing still works: J moves to the next frame.
    press("j")
    await waitFor(() => expect(caption()).toContain(frameName(2)), { timeout: TEST_MS })
    expect(commandsSent(review, "pix_session_review_mark")).toEqual([])
    expect(commandsSent(review, "pix_finish_review")).toEqual([])
    const reason = m.stepflow_finish_first({ step: m.sessions_column_target() })
    // "Read-only · <reason>": the gap is the layout's, so the text runs together.
    expect(document.querySelector("[data-step-locked]")).toHaveTextContent(`${m.stepflow_read_only()}·${reason}`)
    const finish = m.stepflow_finish_review()
    expect(screen.getByRole("button", { name: finish })).toHaveAccessibleDescription(`${finish} · ${reason}`)
  })

  it.each(LOCALES)("%s: on the current Review step, U, P and X mark and ⌘↩ finishes", async (locale) => {
    setLocale(locale)
    const review = reviewHost({ marked: 6 })
    installHost(review, () => "needs_review")
    openReviewStep()
    await waitFor(() => expect(caption()).toContain(frameName(1)), { timeout: TEST_MS })
    // Each mark advances (auto-advance is on): U on frame 1, back with K, then P on 1 and X on 2.
    const quality = () => commandsSent(review, "pix_session_review_mark").map((c) => (c.args.mark as { quality: string }).quality)
    press("u")
    await waitFor(() => expect(caption()).toContain(frameName(2)), { timeout: TEST_MS })
    press("k")
    await waitFor(() => expect(caption()).toContain(frameName(1)), { timeout: TEST_MS })
    press("p")
    await waitFor(() => expect(caption()).toContain(frameName(2)), { timeout: TEST_MS })
    press("x")
    await waitFor(() => expect(caption()).toContain(frameName(3)), { timeout: TEST_MS })
    expect(quality()).toEqual(["unreviewed", "usable", "unusable"])
    // Finish review is available again once no frame is Unreviewed.
    const finish = screen.getByRole("button", { name: m.stepflow_finish_review() })
    await waitFor(() => expect(finish).not.toHaveAttribute("aria-describedby"), { timeout: TEST_MS })
    press("Enter", { mod: true })
    await waitFor(() => expect(commandsSent(review, "pix_finish_review")).toHaveLength(1), { timeout: TEST_MS })
  })
})
