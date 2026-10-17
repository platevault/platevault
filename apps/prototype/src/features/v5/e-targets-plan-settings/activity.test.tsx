import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { setLocale } from "@/app/preferences"
import { createSeed } from "@/domain/seed"
import { DEFAULT_LOCALE, m, msg, say } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ActivityPage, openLabel } from "./activity"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
  window.location.hash = ""
})

// jsdom has no ResizeObserver; the table frame measures its room.
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
afterEach(() => setLocale(DEFAULT_LOCALE))

function renderActivity() {
  const root = createRootRoute()
  const page = createRoute({ getParentRoute: () => root, path: "/activity", component: ActivityPage })
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/activity"] }) })
  render(<RouterProvider router={router} />)
}

describe("Activity", () => {
  it("opens the surface that owns an entry from the row's ⋯ menu", async () => {
    const user = userEvent.setup()
    renderActivity()

    // The demo's Apply entry links to Cygnus HOO 2026's View tab.
    await user.click(await screen.findByRole("button", { name: m.actions_for({ name: "Apply Cygnus HOO 2026" }) }))
    await user.click(await screen.findByRole("menuitem", { name: "Open View" }))
    await waitFor(() => expect(window.location.hash).toBe("#/projects/prj_cygnus?stage=view"))
  })

  it("reformats saved activity and operation titles after a locale switch", async () => {
    store.setState((current) => ({
      ...current,
      activity: [
        { id: "act_locale", at: "2026-10-01T12:00:00.000Z", kind: "saved", title: msg("op_archive_sessions_archived", { count: 1820, n: { count: 1820 } }), detail: null, operationId: null, href: null },
      ],
      operations: { ...current.operations, locale: { id: "locale", kind: "import", title: msg("wrapup_offer_rejected", { count: 1820, n: { count: 1820 }, size: { bytes: 1_200_000_000 } }), status: "running", scope: {}, progress: { done: 0, total: 1820, unit: "frames" }, items: [], summary: null, canPause: false, canCancel: false, payload: {}, createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z", settledAt: null } },
    }))
    renderActivity()
    expect(await screen.findByText(m.op_archive_sessions_archived({ count: 1820, n: "1,820" }))).toBeInTheDocument()

    act(() => setLocale("pt-BR"))
    expect(screen.getByText(m.op_archive_sessions_archived({ count: 1820, n: "1.820" }))).toBeInTheDocument()
    expect(say(m, store.getState().operations.locale!.title)).toBe("Mover 1.820 frames inutilizáveis para a Lixeira (1,2 GB)")
  })

  it("names the Open item after the surface it opens, and plain Open for a page with no name", () => {
    expect(openLabel("/settings/equipment")).toBe("Open Equipment")
    expect(openLabel("/sessions/ses_1")).toBe("Open Session")
    expect(openLabel("/no-such-surface")).toBe("Open")
  })
})
