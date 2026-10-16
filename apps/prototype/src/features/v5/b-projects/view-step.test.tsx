import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { closeSheet } from "@/app/ui-state"
import { filesUnder, volumeForPath } from "@/domain/disk"
import { applyPlan, projectPaths } from "@/domain/project-view"
import { createSeed, PROFILE_IDS } from "@/domain/seed"
import type { Project } from "@/domain/types"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { isSettled } from "@/store/operations"
import { PROJECT_VIEW_HANDLERS, startApply } from "@/store/actions/project-view"
import { setWindowsWithoutDeveloperMode } from "@/store/simulation"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ProjectPage } from "./project"
import { appliedFootprint, footprintText, plannedFootprint, toolNotes } from "./view-step"

const CYGNUS = "prj_cygnus"
const MOSAIC = "prj_ic5070"
const apply = PROJECT_VIEW_HANDLERS.find((h) => h.kind === "apply")!

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

const project = (id: string): Project => store.getState().catalog.projects[id]!
const setProject = (id: string, patch: Partial<Project>) => store.setState((s) => ({ ...s, catalog: { ...s.catalog, projects: { ...s.catalog.projects, [id]: { ...s.catalog.projects[id]!, ...patch } } } }))

function renderView(projectId: string) {
  const root = createRootRoute()
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (s: Record<string, unknown>) => s })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${projectId}?stage=view`] }) })
  render(<RouterProvider router={router} />)
}

/** Run one Apply to its end, one handler step at a time. */
function applyToEnd(id: string) {
  const plan = applyPlan(store.getState(), project(id))
  const { result, operationId } = startApply(id, { fingerprint: plan.fingerprint, tickedUnplaced: plan.drift.unplaced.map((f) => f.path) })
  expect(result.ok).toBe(true)
  for (let i = 0; i < 200 && !isSettled(store.getState().operations[operationId!]!.status); i++) store.setState((s) => apply.step(s, s.operations[operationId!]!))
  expect(store.getState().operations[operationId!]!.status).toBe("succeeded")
}

describe("footprint (PREP-AC-25, astro-plan-9onxj)", () => {
  it("counts calibration and every independent copy, and says (cloned) for copies on the originals' volume", () => {
    const mosaic = project(MOSAIC)
    const fp = appliedFootprint(store.getState().disk, mosaic.view!.entries, mosaic.view!.folderPath)
    expect(fp.calibration).toBeGreaterThan(0)
    expect(fp.copies).toBe(mosaic.view!.entries.length)
    expect(fp.bytes).toBe(mosaic.view!.entries.reduce((n, e) => n + e.sizeBytes, 0))
    // A clone needs the original on the View's own volume; the rest are full copies, and the footprint says how many are clones.
    const disk = store.getState().disk
    const sameVolume = mosaic.view!.entries.filter((e) => volumeForPath(disk, e.originalPath) === volumeForPath(disk, mosaic.view!.folderPath)).length
    expect(fp.cloned).toBe(sameVolume)
    expect(fp.cloned).toBeGreaterThan(0)
    expect(footprintText(m, fp)).toContain(fp.cloned === fp.copies ? m.view_footprint_cloned() : m.view_footprint_some_cloned({ count: fp.cloned, n: String(fp.cloned) }))
  })

  it("never hard-links: every copy in a Copies View is its own file", () => {
    const view = project(MOSAIC).view!
    const copies = filesUnder(store.getState().disk, view.folderPath).filter((f) => !f.linkTarget)
    expect(new Set(copies.map((f) => f.inode)).size).toBe(copies.length)
  })

  it("reads Linked · 0 B for a Symlinks View, and the plan's bytes are every copy entry in full", () => {
    const cygnus = project(CYGNUS)
    expect(footprintText(m, appliedFootprint(store.getState().disk, cygnus.view!.entries, cygnus.view!.folderPath))).toBe(m.view_footprint_links_only())
    setProject(CYGNUS, { settings: { ...cygnus.settings, mode: "copy" } })
    const plan = applyPlan(store.getState(), project(CYGNUS))
    expect(plan.space.neededBytes).toBe(plan.plan.entries.reduce((n, e) => n + e.sizeBytes, 0))
    expect(plannedFootprint(store.getState().disk, plan).copies).toBe(plan.plan.entries.length)
  })
})

describe("the Apply sheet (VSEL-AC-30/34, PREP-AC-29)", () => {
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

  it("lists View (previous)/ first for review and keeps Apply unavailable until each file is reviewed", async () => {
    renderView(MOSAIC)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: `${m.project_apply()}…` }))
    const dialog = await screen.findByRole("dialog", { name: m.common_apply_named({ name: project(MOSAIC).name }) })
    expect(within(dialog).getByRole("heading", { name: m.view_review_previous_first() })).toBeInTheDocument()
    expect(within(dialog).getByRole("table", { name: m.view_review_previous_first() })).toBeInTheDocument()
    expect(within(dialog).getByRole("tree", { name: m.view_tree_of({ name: project(MOSAIC).name }) })).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: m.project_apply() })).toHaveAttribute("aria-disabled", "true")
  })

  it("WBPP notes for a grouped Project: NIGHT for Pre, GROUP for Pre and Post, auto by GROUP and Processing/WBPP/", () => {
    const plan = applyPlan(store.getState(), project(CYGNUS))
    const notes = toolNotes(m, "pixinsight-wbpp", "PixInsight / WBPP", plan, "GROUP")
    expect(notes).toEqual(expect.arrayContaining([m.view_note_wbpp_pre({ keyword: "NIGHT" }), m.view_note_wbpp_group({ keyword: "GROUP" }), m.view_note_wbpp_reference({ keyword: "GROUP" }), m.view_note_wbpp_output({ path: "Processing/WBPP/" })]))
  })
})

describe("Windows Developer Mode and Siril (PREP-FR-15, PREP-FR-17; provisional)", () => {
  it("refuses a Symlinks Apply, and a Siril Project in Copies too, with no fallback", () => {
    setWindowsWithoutDeveloperMode(true)
    expect(applyPlan(store.getState(), project(CYGNUS)).refusals.map((r) => r.kind)).toContain("developer-mode")
    setProject(CYGNUS, { settings: { ...project(CYGNUS).settings, mode: "copy", profileId: PROFILE_IDS.siril } })
    expect(applyPlan(store.getState(), project(CYGNUS)).refusals.map((r) => r.kind)).toContain("developer-mode")
    setProject(CYGNUS, { settings: { ...project(CYGNUS).settings, profileId: PROFILE_IDS.pixinsight } })
    expect(applyPlan(store.getState(), project(CYGNUS)).refusals.map((r) => r.kind)).not.toContain("developer-mode")
  })

  it("links one Siril set per group and light folder into View once Apply swaps (PREP-AC-37)", () => {
    setProject(CYGNUS, { settings: { ...project(CYGNUS).settings, profileId: PROFILE_IDS.siril } })
    const sets = applyPlan(store.getState(), project(CYGNUS)).siril!
    expect(sets.length).toBeGreaterThan(1)
    applyToEnd(CYGNUS)
    const paths = projectPaths(store.getState(), project(CYGNUS))!
    const links = filesUnder(store.getState().disk, `${paths.processing}/Siril`)
    expect(links.length).toBe(sets.reduce((n, s) => n + s.links.length, 0))
    expect(links.every((l) => l.linkTarget?.startsWith(`${paths.view}/`))).toBe(true)
    expect(new Set(links.map((l) => l.path.split("/").at(-2)))).toEqual(new Set(["lights", "flats", "darks", "biases"].filter((f) => links.some((l) => l.path.includes(`/${f}/`)))))
  })
})
