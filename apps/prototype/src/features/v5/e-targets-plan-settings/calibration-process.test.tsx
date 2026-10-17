import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { CalibrationProcessPage } from "./calibration-process"

// The missing-record page is a DetailPage, whose dock measures its room; jsdom has no ResizeObserver.
const original = globalThis.ResizeObserver
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterAll(() => {
  globalThis.ResizeObserver = original
})

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderAt(path: string) {
  const root = createRootRoute()
  const library = createRoute({ getParentRoute: () => root, path: "/calibration", component: () => null })
  const process = createRoute({ getParentRoute: () => root, path: "/calibration/processes/$processId/$step", component: CalibrationProcessPage })
  const router = createRouter({ routeTree: root.addChildren([library, process]), history: createMemoryHistory({ initialEntries: [path] }) })
  render(<RouterProvider router={router} />)
}

describe("Calibration process route without a recorded process", () => {
  it("shows the shared missing-record page: its title as the h1 and the document title, and the way back to Calibration", async () => {
    renderAt("/calibration/processes/no-such-process/stack")
    const title = m.calibration_process_missing_title()
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument()
    expect(document.title).toBe(`${title} · ${m.prototype_document_title()}`)
    expect(screen.getByRole("link", { name: m.nav_calibration() })).toHaveAttribute("href", "/calibration")
  })
})
