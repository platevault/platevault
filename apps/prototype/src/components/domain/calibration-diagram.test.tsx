import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { calibrationSources, candidatesFor, NO_KIND_NAME, noChoice, pickChoice } from "@/domain/calibration"
import { createSeed } from "@/domain/seed"
import type { PinKind, SessionId } from "@/domain/types"
import { m, say } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { CalibrationDiagram, calibrationDiagram } from "./calibration-diagram"

const NOW = Date.parse("2026-10-13T12:00:00Z")
const CYGNUS = "prj_cygnus"
const M31 = "prj_m31"
const CLOSED = "prj_ngc_oiii"

let seed: PrototypeState
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  seed = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
afterAll(() => {
  vi.useRealTimers()
})

function inRouter(node: ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  return render(<RouterProvider router={router} />)
}

/** The seed with one session pinning a given master version for a kind, by the user. */
function pinning(state: PrototypeState, sessionId: SessionId, kind: PinKind, versionId: string): PrototypeState {
  const catalog = structuredClone(state.catalog)
  const session = catalog.sessions[sessionId]!
  const candidate = candidatesFor(catalog, state.settings, session, kind, calibrationSources(catalog, state.disk)).find((c) => c.source.source.type === "master" && c.source.source.versionId === versionId)
  if (!candidate) throw new Error(`${versionId} is not offered for ${sessionId}`)
  session.calibration![kind] = pickChoice(candidate, "2026-10-10T12:00:00.000Z")
  return { ...state, catalog }
}

describe("calibrationDiagram", () => {
  it("projects each group, its night folders and each light set with its flat, dark and bias, from the View plan", () => {
    const groups = calibrationDiagram(seed, seed.catalog.projects[CYGNUS]!, NOW)
    expect(groups.map((g) => g.folder)).toEqual(["GROUP_RedCat-51-ASI2600MM", "GROUP_RedCat-51-ASI2600MM-Framing-2", "GROUP_Esprit-100-ASI533MC"])
    expect(groups[0]!.nights.map((n) => n.folder)).toEqual(["NIGHT_2026-09-18", "NIGHT_2026-09-24", "NIGHT_2026-09-30"])
    const lights = groups[0]!.nights[0]!.lights[0]!
    expect(lights.frames).toBe(52)
    expect(lights.calibration.map((c) => c.kind)).toEqual(["flat", "dark", "bias"])
    // A raw flat set links to its calibration session; a master to the Calibration library, with its dated version.
    expect(lights.calibration[0]).toMatchObject({ choice: { state: "pinned" }, link: { to: "/sessions/$sessionId" }, master: null })
    expect(lights.calibration[1]).toMatchObject({ link: { to: "/calibration" }, master: { version: { id: "mv_1ximucz" } }, mixed: false })
    expect(groups.every((g) => g.mixed.length === 0)).toBe(true)
  })

  it("one group: no group folder", () => {
    const [group] = calibrationDiagram(seed, seed.catalog.projects[M31]!, NOW)
    expect(group!.folder).toBeNull()
    expect(group!.nights.map((n) => n.folder)).toEqual(["NIGHT_2026-09-02", "NIGHT_2026-09-03"])
  })

  it("mixed dark versions with the same settings: every dark of that scope sits in the nights, none stays shared", () => {
    const mixed = pinning(seed, "ses_1xf1wax", "dark", "mv_49epv6")
    const [redcat] = calibrationDiagram(mixed, mixed.catalog.projects[CYGNUS]!, NOW)
    expect(redcat!.mixed).toEqual(["dark"])
    const darks = redcat!.nights.flatMap((n) => n.lights.map((l) => l.calibration.find((c) => c.kind === "dark")!))
    expect(darks.every((d) => d.mixed)).toBe(true)
    expect(new Set(darks.map((d) => d.master?.version.id))).toEqual(new Set(["mv_49epv6", "mv_1ximucz"]))
    // Bias versions do not mix, so the bias stays shared.
    expect(redcat!.nights.flatMap((n) => n.lights.map((l) => l.calibration.find((c) => c.kind === "bias")!.mixed))).not.toContain(true)
  })

  it("a second flat set for the same group, night and filter gets its own NIGHT_…-2 folder", () => {
    const moved = structuredClone(seed)
    moved.catalog.projects[CYGNUS]!.inputs = moved.catalog.projects[CYGNUS]!.inputs.map((i) => (i.sessionId === "ses_tcxqb9" ? { ...i, groupId: "grp_cyg_redcat" } : i))
    const two = pinning(moved, "ses_tcxqb9", "flat", "mv_bmjp84")
    const [redcat] = calibrationDiagram(two, two.catalog.projects[CYGNUS]!, NOW)
    expect(redcat!.nights.map((n) => n.folder)).toEqual(["NIGHT_2026-09-18", "NIGHT_2026-09-24", "NIGHT_2026-09-24-2", "NIGHT_2026-09-30"])
  })

  it("a Closed Project reads its frozen calibration, not a later reassignment", () => {
    const before = calibrationDiagram(seed, seed.catalog.projects[CLOSED]!, NOW)
    const later = structuredClone(seed)
    // A reassignment writes a new calibration record on the session, as the session actions do.
    const session = later.catalog.sessions.ses_k30zg8!
    session.calibration = { ...session.calibration!, flat: noChoice("2026-10-12T12:00:00.000Z") }
    const after = calibrationDiagram(later, later.catalog.projects[CLOSED]!, NOW)
    expect(after).toEqual(before)
    expect(after[0]!.nights[0]!.lights[0]!.calibration[0]!.choice.state).toBe("pinned")
  })
})

describe("CalibrationDiagram", () => {
  it("holds no control: names are links, No reads as a word, and each group and night is a heading", async () => {
    const state = structuredClone(seed)
    state.catalog.sessions.ses_1oeln5l!.calibration!.bias = noChoice("2026-10-12T12:00:00.000Z")
    inRouter(<CalibrationDiagram groups={calibrationDiagram(state, state.catalog.projects[CYGNUS]!, NOW)} />)
    expect(await screen.findByRole("heading", { level: 3, name: "RedCat 51 / ASI2600MM" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 4, name: /NIGHT_2026-09-18/ })).toBeInTheDocument()
    expect(screen.getByText(say(m, NO_KIND_NAME.bias))).toBeInTheDocument()
    expect(screen.queryAllByRole("button")).toEqual([])
    expect(screen.queryAllByRole("checkbox")).toEqual([])
    expect(screen.getAllByRole("link").length).toBeGreaterThan(5)
  })

  it("marks mixed versions on the group and in each night", async () => {
    const mixed = pinning(seed, "ses_1xf1wax", "dark", "mv_49epv6")
    inRouter(<CalibrationDiagram groups={calibrationDiagram(mixed, mixed.catalog.projects[CYGNUS]!, NOW)} />)
    expect(await screen.findByText(m.calibration_diagram_mixed_darks())).toBeInTheDocument()
    expect(screen.getAllByText(m.calibration_diagram_in_night()).length).toBe(3)
  })

  it("previews a master's own version on keyboard focus", async () => {
    const user = userEvent.setup()
    inRouter(<CalibrationDiagram groups={calibrationDiagram(seed, seed.catalog.projects[M31]!, NOW)} />)
    const first = (await screen.findAllByRole("link"))[0]!
    for (let i = 0; i < 10 && !document.activeElement?.closest("[data-diagram-kind]"); i++) await user.tab()
    expect(document.activeElement).not.toBe(first)
    const card = await within(document.body).findByText(m.calibration_version())
    expect(card).toBeInTheDocument()
  })

  it("shows its loading, empty and error states", async () => {
    const onRetry = vi.fn()
    const { unmount } = inRouter(<CalibrationDiagram groups={[]} />)
    expect(await screen.findByText(m.calibration_diagram_empty())).toBeInTheDocument()
    unmount()
    const loading = inRouter(<CalibrationDiagram groups={[]} loading />)
    expect(await screen.findByRole("status")).toHaveTextContent(m.calibration_diagram_loading())
    loading.unmount()
    inRouter(<CalibrationDiagram groups={[]} error={{ message: "Can't read the plan", onRetry }} />)
    await userEvent.setup().click(await screen.findByRole("button", { name: m.verb_retry() }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
