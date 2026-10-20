import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { closeSheet } from "@/app/ui-state"
import { PROJECT_TABS } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ProjectPage } from "./project"

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderProject(projectId: string, search = "") {
  const root = createRootRoute()
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (s: Record<string, unknown>) => s })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${projectId}${search}`] }) })
  render(<RouterProvider router={router} />)
  return router
}

const DEMO_PROJECT_TABS = Object.keys(createSeed("demo").catalog.projects).flatMap((projectId) => PROJECT_TABS.map((tab) => ({ projectId, tab })))

const projects = () => Object.values(store.getState().catalog.projects)

describe("Project page on the F4 model", () => {
  // The dock and the dialogs measure their room; jsdom has no ResizeObserver.
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

  it.each(DEMO_PROJECT_TABS)("renders $projectId on the $tab tab", async ({ projectId, tab }) => {
    const project = projects().find((candidate) => candidate.id === projectId)!
    renderProject(projectId, tab === "sessions" ? "" : `?stage=${tab}`)
    expect(await screen.findByRole("heading", { level: 1, name: project.name })).toBeInTheDocument()
  })

  it("lists a group's held sessions and Duplicate… creates an independent open Project with no View", async () => {
    const source = projects().find((p) => p.state === "open" && p.inputs.length > 0 && p.view !== null)!
    renderProject(source.id)
    expect(await screen.findByRole("table", { name: m.project_groups_of({ name: source.name }) })).toBeInTheDocument()
    // Rows sit under a heading row per group; each session is one data row.
    expect(screen.getByRole("table", { name: m.common_sessions_of({ name: source.name }) }).querySelectorAll("tr[data-row]")).toHaveLength(source.inputs.length)

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: m.project_noun() }))
    await user.click(await screen.findByRole("menuitem", { name: `${m.project_duplicate()}…` }))
    const dialog = await screen.findByRole("dialog", { name: m.common_duplicate_title({ name: source.name }) })
    await user.click(within(dialog).getByRole("button", { name: m.project_duplicate() }))
    await waitFor(() => expect(projects()).toHaveLength(Object.keys(createSeed("demo").catalog.projects).length + 1))
    const copy = projects().find((p) => p.name === m.project_duplicate_name({ name: source.name }))!
    expect(copy.state).toBe("open")
    expect(copy.view).toBeNull()
    expect(copy.inputs.map((i) => i.sessionId)).toEqual(source.inputs.map((i) => i.sessionId))
  })

  it("opens the Apply sheet from the header and records it in slice C", async () => {
    const project = projects().find((p) => p.state === "open")!
    renderProject(project.id)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: `${m.project_apply()}…` }))
    expect(await screen.findByRole("dialog", { name: m.common_apply_named({ name: project.name }) })).toBeInTheDocument()
    expect(store.getState().slices.c.apply[project.id]?.fingerprint).toBeTruthy()
  })

  it("offers no Apply on a Closed Project and keeps Duplicate…", async () => {
    const project = projects().find((p) => p.state !== "open")!
    renderProject(project.id)
    await screen.findByRole("heading", { level: 1, name: project.name })
    expect(screen.queryByRole("button", { name: `${m.project_apply()}…` })).toBeNull()
    expect(screen.getAllByRole("button", { name: `${m.project_duplicate()}…` }).length).toBeGreaterThan(0)
  })

  it("keeps focus on the stage tab Enter or Space activates, on the page that tab opens (WCAG 2.4.3)", async () => {
    const router = renderProject("prj_cygnus")
    const user = userEvent.setup()
    const tabNamed = async (label: string) => (await screen.findAllByRole("tab")).find((tab) => tab.textContent?.startsWith(label))!
    for (const [label, key, stage] of [
      [m.project_tab_calibrate(), "{Enter}", "calibrate"],
      [m.project_tab_view(), " ", "view"],
      [m.wrapup_action(), "{Enter}", "wrap-up"],
    ] as const) {
      ;(await tabNamed(label)).focus()
      await user.keyboard(key)
      await waitFor(() => expect(router.state.location.search).toEqual({ stage }))
      const selected = await tabNamed(label)
      expect(selected).toHaveAttribute("aria-selected", "true")
      expect(document.activeElement).toBe(selected)
    }
  })

  it("shows a Project that is not in the catalogue under the standard page header, its path leading back to Projects", async () => {
    renderProject("prj_gone")
    const heading = await screen.findByRole("heading", { level: 1, name: m.project_missing_title() })
    const header = heading.closest("header")
    expect(header).not.toBeNull()
    expect(within(header!).getByRole("link", { name: m.nav_projects() })).toHaveAttribute("href", "/projects")
    expect(document.title).toContain(m.project_missing_title())
  })
})
