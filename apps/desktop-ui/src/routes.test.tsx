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
import { AppRoot } from "@/app/root"
import { commandsSent, reviewHost, SESSION_ID } from "@/features/review/__fixtures__/review-host"
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
})

const KEY = "capture-v1|type=light|night=2026-09-12@date-loc-noon|filter=Ha|exposure_s=300"

function librarySession() {
  const session = { id: SESSION_ID, key: KEY, groupingRevision: 4, decisionRevision: 7, assetIds: [], provisional: [], dateBasis: "date-loc-noon" }
  return {
    detail: { summary: { session, locationIds: [], assetCount: 6, captureCount: 6, availability: "available", lastObservedAt: null, provisional: false, successors: [] }, assets: [], members: [], associations: [], lineage: [] },
    targetAssessments: [],
  }
}

function admission(reviewFinished: boolean) {
  const unresolved = { state: "unresolved" }
  return {
    intake: { sessionId: SESSION_ID, groupingRevision: 4, superseded: false, targetConfirmed: true, rigId: "rig-1", reviewFinished, unreviewedFrames: 0, changedFrames: 0 },
    calibration: { sessionId: SESSION_ID, generation: 0, matchingPending: false, dark: unresolved, flat: unresolved, bias: unresolved },
    health: { bias: "intact", dark: "intact", flat: "intact" },
    blockers: reviewFinished ? [] : [{ blocker: "not_ready", readiness: "needs_review" }],
  }
}

describe("session intake with the registered review", { timeout: TEST_MS }, () => {
  it("renders the real review workspace on Review and opens the session once Finish review succeeds", async () => {
    const review = reviewHost({ marked: 6 })
    let finished = false
    mockIPC((command, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>
      if (command === "plugin:event|listen") return args.handler
      if (command === "plugin:event|unlisten") return null
      if (command === "library_session") return librarySession()
      if (command === "pix_session_intake") return admission(finished)
      if (command === "library_issues") return { issues: [], dismissed: [], counts: { danger: 0, warning: 0, info: 0 }, pages: [] }
      if (command === "library_list_locations") return []
      if (command === "rig_filters_get") return null
      if (command.startsWith("pix_")) {
        if (command === "pix_finish_review") finished = true
        return review.handle(command, payload)
      }
      return null
    })
    const router = createAppRouter(createMemoryHistory({ initialEntries: [`/sessions/${SESSION_ID}?step=review`] }))
    render(<AppRoot router={router} client={createQueryClient()} />)
    // The workspace's own frame list and caption: the real body, not a stand-in.
    await waitFor(() => expect(document.querySelector('[data-workspace-pane="current"]')?.textContent ?? "").toContain("M42_Ha_300s_0001.fits"), { timeout: TEST_MS })
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter", metaKey: true })
    })
    await waitFor(() => expect(commandsSent(review, "pix_finish_review").map((c) => c.args)).toEqual([{ sessionId: SESSION_ID, expectedGroupingRevision: 4 }]), { timeout: TEST_MS })
    await waitFor(() => expect(router.state.location.search).toEqual({}), { timeout: TEST_MS })
    expect(await screen.findByRole("heading", { level: 1 }, { timeout: TEST_MS })).toHaveTextContent("12 Sep · Ha")
  })
})
