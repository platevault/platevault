import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { closeSheet } from "@/app/ui-state"
import { projectSuggestions, subjectName } from "@/domain/derive"
import { pendingChanges } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import type { Project } from "@/domain/types"
import { m, say } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { sessionLine } from "./parts"
import { ProjectPage } from "./project"

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

const project = (id: string): Project => store.getState().catalog.projects[id]!
const cygnus = () => project("prj_cygnus")

function renderProject(projectId: string) {
  const root = createRootRoute()
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (s: Record<string, unknown>) => s })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${projectId}`] }) })
  render(<RouterProvider router={router} />)
  return userEvent.setup()
}

/** The label a held or picker row goes by: "NGC 7000 · 30 Sep · OIII · 300 s". */
function heldLabel(p: Project, sessionId: string): string {
  const catalog = store.getState().catalog
  const session = catalog.sessions[sessionId]!
  const subject = p.subjects.find((s) => s.targetId === session.target.value)!
  return `${subjectName(m, catalog, subject)} · ${sessionLine(m, session)}`
}

describe("Project groups, suggestions, Add sessions and the Closed menu (F4 P)", () => {
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

  it("splits two ticked sessions of one group into a new group named '<Group> · 2', as whole sessions and a pending change (PRJ-AC-44)", async () => {
    const before = cygnus()
    const source = before.groups[0]!
    const ids = before.inputs.filter((i) => i.groupId === source.id).map((i) => i.sessionId).slice(0, 2)
    const user = renderProject(before.id)
    const table = await screen.findByRole("table", { name: m.common_sessions_of({ name: before.name }) })
    for (const id of ids) await user.click(within(table).getByRole("checkbox", { name: m.table_select_row({ name: heldLabel(before, id) }) }))
    await user.click(screen.getByRole("button", { name: `${m.project_split_group()}…` }))
    const dialog = await screen.findByRole("dialog", { name: m.project_split_group() })
    expect(within(dialog).getByRole("textbox", { name: m.newproject_field_name() })).toHaveValue(m.project_group_split_n({ name: source.name, n: 2 }))
    await user.click(within(dialog).getByRole("button", { name: m.project_split_confirm() }))
    await waitFor(() => expect(cygnus().groups).toHaveLength(before.groups.length + 1))
    const created = cygnus().groups.at(-1)!
    expect(created.name).toBe(m.project_group_split_n({ name: source.name, n: 2 }))
    expect(cygnus().inputs.filter((i) => i.groupId === created.id).map((i) => i.sessionId)).toEqual(ids)
    const moved = pendingChanges(store.getState(), cygnus()).filter((c) => c.kind === "session-moved").map((c) => ("sessionId" in c ? c.sessionId : null))
    expect(moved).toEqual(expect.arrayContaining(ids.filter((id) => before.view!.inputs.some((i) => i.sessionId === id))))
  })

  it("lists an unsettled suggestion with 'Choose its flats first' and Add unavailable (PRJ-AC-39)", async () => {
    const p = cygnus()
    const blocked = projectSuggestions(store.getState().catalog, p).find((s) => s.blocked !== null)!
    expect(say(m, blocked.blocked!)).toBe(m.domain_join_choose_flats())
    renderProject(p.id)
    const table = await screen.findByRole("table", { name: m.project_suggestions_of({ name: p.name }) })
    const row = within(table).getByRole("row", { name: new RegExp(sessionLine(m, blocked.session)) })
    expect(within(row).getByText(m.domain_join_choose_flats())).toBeInTheDocument()
  })

  it("words the Suggestions actions as verbs of one to three words (W2), with Choose calibration for the unsettled ones", async () => {
    renderProject(cygnus().id)
    const heading = await screen.findByRole("heading", { name: new RegExp(`^${m.project_suggestions()}`) })
    const labels = within(heading.closest<HTMLElement>("[data-chrome]")!)
      .getAllByRole("button")
      .map((button) => button.textContent!.trim())
    expect(labels).toContain(m.project_suggestions_choose_calibration())
    for (const label of labels) expect(label.split(/\s+/).length, label).toBeLessThanOrEqual(3)
  })

  it("marks a group as a mosaic panel under 'Panel 1', which shows the panel map (PRJ-AC-46)", async () => {
    const p = cygnus()
    const group = p.groups[0]!
    const user = renderProject(p.id)
    const table = await screen.findByRole("table", { name: m.project_groups_of({ name: p.name }) })
    await user.click(within(table).getByRole("button", { name: m.actions_for({ name: group.name }) }))
    await user.click(await screen.findByRole("menuitem", { name: `${m.project_group_mark_panel()}…` }))
    const dialog = await screen.findByRole("dialog", { name: m.project_group_mark_panel_title({ name: group.name }) })
    expect(within(dialog).getByRole("textbox", { name: m.newproject_field_name() })).toHaveValue(m.common_panel_n({ n: 1 }))
    await user.click(within(dialog).getByRole("button", { name: m.project_group_mark_panel() }))
    await waitFor(() => expect(cygnus().groups[0]).toMatchObject({ name: m.common_panel_n({ n: 1 }), panel: true }))
    expect(await screen.findByRole("heading", { name: new RegExp(m.project_panel_map()) })).toBeInTheDocument()
  })

  it("Add sessions… offers suggestions first, keeps an unsettled one unticked, and says what another Target's session also adds (VSEL-FR-03, VSEL-AC-18)", async () => {
    const p = cygnus()
    const user = renderProject(p.id)
    await screen.findByRole("table", { name: m.common_sessions_of({ name: p.name }) })
    await user.click(screen.getByRole("button", { name: `${m.project_add_sessions()}…` }))
    const dialog = await screen.findByRole("dialog", { name: m.project_add_sessions_title({ name: p.name }) })
    const blocked = projectSuggestions(store.getState().catalog, p).find((s) => s.blocked !== null)!
    expect(within(dialog).getByRole("checkbox", { name: m.table_select_row({ name: heldLabel(p, blocked.session.id) }) })).toHaveAttribute("aria-disabled", "true")
    const other = within(dialog)
      .getAllByRole("checkbox", { name: /^Select IC 5070/ })
      .find((c) => c.getAttribute("aria-disabled") !== "true")!
    await user.click(other)
    // The row's Match cell says what it also adds, before saving (PRJ-FR-02).
    const adds = m.session_adds_subject({ name: "IC 5070" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    expect(within(dialog).getAllByText(new RegExp(adds)).length).toBeGreaterThan(0)
    await user.click(within(dialog).getByRole("button", { name: m.project_add_suggested({ count: 1 }) }))
    await waitFor(() => expect(cygnus().inputs).toHaveLength(p.inputs.length + 1))
    expect(cygnus().subjects.map((s) => s.targetId)).toContain(store.getState().catalog.sessions[cygnus().inputs.at(-1)!.sessionId]!.target.value)
  })

  it("keeps New group… open with the error when the catalog write fails, and creates the group on Retry", async () => {
    const p = cygnus()
    const name = m.project_group_split_n({ name: p.groups[0]!.name, n: 2 })
    const user = renderProject(p.id)
    await screen.findByRole("table", { name: m.project_groups_of({ name: p.name }) })
    store.setState((s) => ({ ...s, faults: { ...s.faults, failNextCatalogWrite: true } }))
    await user.click(screen.getByRole("button", { name: `${m.project_group_new()}…` }))
    const dialog = await screen.findByRole("dialog", { name: m.project_group_new() })
    expect(within(dialog).getByRole("textbox", { name: m.newproject_field_name() })).toHaveValue(name)
    await user.click(within(dialog).getByRole("button", { name: m.project_group_new() }))
    expect(await within(dialog).findByText(m.store_not_saved_message({ label: m.project_label_create_group({ name }) }))).toBeInTheDocument()
    expect(cygnus().groups).toHaveLength(p.groups.length)
    await user.click(within(dialog).getByRole("button", { name: /Retry/ }))
    await waitFor(() => expect(cygnus().groups.map((g) => g.name)).toContain(name))
  })

  it("a Closed Project offers no suggestions, no Apply, and Edit… unavailable with a Duplicate blocker (PRJ-AC-34, VSEL-AC-20)", async () => {
    const p = Object.values(store.getState().catalog.projects).find((x) => x.state === "closed")!
    const user = renderProject(p.id)
    await screen.findByRole("heading", { level: 1, name: p.name })
    expect(screen.queryByRole("table", { name: m.project_suggestions_of({ name: p.name }) })).toBeNull()
    expect(screen.queryByRole("button", { name: `${m.project_apply()}…` })).toBeNull()
    expect(screen.queryByRole("button", { name: `${m.project_add_sessions()}…` })).toBeNull()
    await user.click(screen.getByRole("button", { name: m.project_noun() }))
    const menu = await screen.findByRole("menu", { name: m.project_noun() })
    expect(within(menu).getByRole("menuitem", { name: new RegExp(`^${m.project_edit()}…`) })).toHaveAttribute("aria-disabled", "true")
    expect(within(menu).queryByRole("menuitem", { name: /Reopen/ })).toBeNull()
    expect(within(menu).getByRole("menuitem", { name: `${m.project_duplicate()}…` })).toBeInTheDocument()
  })
})
