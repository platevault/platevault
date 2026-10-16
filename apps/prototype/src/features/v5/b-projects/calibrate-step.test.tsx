import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { closeSheet } from "@/app/ui-state"
import { createSeed } from "@/domain/seed"
import type { CalibrationChoice } from "@/domain/types"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { calibrationProblems } from "./calibrate-step"
import { ProjectPage } from "./project"

const CYGNUS = "prj_cygnus"

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderCalibrate(projectId: string) {
  const root = createRootRoute()
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (s: Record<string, unknown>) => s })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${projectId}?stage=calibrate`] }) })
  render(<RouterProvider router={router} />)
}

describe("the Calibrate check (decision record §6)", () => {
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

  it("draws the read-only diagram by group and night, with the mixed GAIN_ folder parts named and no assignment control", async () => {
    renderCalibrate(CYGNUS)
    expect(await screen.findByRole("heading", { name: m.calibrate_check_title() })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 3, name: "RedCat 51 / ASI2600MM" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: m.calibrate_layout_title() })).toBeInTheDocument()
    expect(screen.getByText("GAIN_")).toBeInTheDocument()
    // A check, not an assignment: the diagram offers no Confirm, Choose or No.
    expect(screen.queryByRole("button", { name: /^(Confirm|Choose|No )/ })).toBeNull()
  })

  it("lists a held session whose kind is no longer settled, linked to the session", () => {
    const sessionId = store.getState().catalog.projects[CYGNUS]!.inputs[0]!.sessionId
    expect(calibrationProblems(m, store.getState(), store.getState().catalog.projects[CYGNUS]!)).toEqual([])
    store.setState((s) => {
      const session = s.catalog.sessions[sessionId]!
      const waiting: CalibrationChoice = { state: "waiting" }
      return { ...s, catalog: { ...s.catalog, sessions: { ...s.catalog.sessions, [sessionId]: { ...session, calibration: { ...session.calibration!, flat: waiting } } } } }
    })
    const rows = calibrationProblems(m, store.getState(), store.getState().catalog.projects[CYGNUS]!)
    expect(rows.map((r) => r.session.id)).toEqual([sessionId])
  })
})
