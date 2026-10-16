import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { closeSheet } from "@/app/ui-state"
import { trashOffers, viewCleanupOffer } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ProjectPage } from "./project"

const M31 = "prj_m31"
const MOSAIC = "prj_ic5070"

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderWrapUp(projectId: string, step: string) {
  const root = createRootRoute()
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (s: Record<string, unknown>) => s })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${projectId}?stage=wrap-up&step=${step}`] }) })
  render(<RouterProvider router={router} />)
}

describe("Wrap up: Clean up → Trash → Archive and Close (PRJ-FR-14, F1, astro-plan-lz898)", () => {
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

  it("Clean up ticks the View's copies and keeps its links unticked, and never offers Output (F1)", () => {
    const state = store.getState()
    const cygnus = state.catalog.projects.prj_cygnus!
    const offer = viewCleanupOffer(state, cygnus)
    expect(offer.entries.length).toBeGreaterThan(0)
    for (const entry of offer.entries) expect(entry.preselected).toBe(entry.detail !== m.wrapup_cleanup_link())
    const all = [...offer.entries, ...Object.values(trashOffers(state, cygnus)).flatMap((o) => o.entries)]
    expect(all.some((e) => e.path.includes("/Output/"))).toBe(false)
  })

  it("folds out the exact files each Trash row moves", async () => {
    renderWrapUp(M31, "trash")
    const user = userEvent.setup()
    const table = await screen.findByRole("table", { name: m.trash_title() })
    const toggle = within(table).getAllByRole("button", { name: /details/i })[0]!
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByRole("table", { name: /^Files of / })).toBeInTheDocument()
  })

  it("reviews the exact files per group on Proceed, each copy with its SHA-256, and a row that stays reads its reason in a word (astro-plan-6bh3p)", async () => {
    renderWrapUp(M31, "trash")
    const user = userEvent.setup()
    const table = await screen.findByRole("table", { name: m.trash_title() })
    expect(within(table).getAllByText(m.domain_trash_read_only()).length).toBeGreaterThan(0)
    await user.click(screen.getByRole("button", { name: new RegExp(`^${m.stepflow_proceed()}`) }))
    const review = within(await screen.findByRole("alertdialog"))
    await user.click(review.getByRole("button", { name: new RegExp(`^${m.wrapup_offer_rejects()} · `) }))
    const files = review.getByRole("table", { name: m.wrapup_offer_rejects() })
    expect(within(files).getByRole("columnheader", { name: new RegExp(m.storage_sha256()) })).toBeInTheDocument()
    const state = store.getState()
    const offer = trashOffers(state, state.catalog.projects[M31]!)["rejected-frames"]
    expect(within(files).getAllByRole("row")).toHaveLength(offer.items.length + 1)
    const first = offer.items[0]!
    expect(within(files).getByText(state.catalog.assets[first.assetId!]!.copies.find((c) => c.path === first.path)!.sha256)).toBeInTheDocument()
  })

  it("says up front that Close project is for good", async () => {
    renderWrapUp(MOSAIC, "archive")
    expect(await screen.findByText(m.wrapup_close_for_good())).toBeInTheDocument()
  })
})
