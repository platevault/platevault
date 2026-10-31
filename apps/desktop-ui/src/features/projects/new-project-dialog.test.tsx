/**
 * New Project (065 PRJ-FR-01/02) against the library IPC as the webview
 * sees it: the saved rigs come from `library_list_equipment`, the subject
 * from `targets_search`, and the picked ones go out with `project_create`,
 * which refuses a Project without a subject or a rig.
 */
import { QueryClientProvider } from "@tanstack/react-query"
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Equipment, TargetsSearchResult, TargetsSearchResults } from "@/api/ipc"
import { createQueryClient } from "@/api/query"
import { setLocale } from "@/app/preferences"
import { LOCALES, m } from "@/lib/i18n"
import { NewProjectDialog } from "./new-project-dialog"

const rig = (id: string, name: string): Equipment => ({
  id,
  name,
  camera: null,
  telescope: null,
  focalLengthMm: null,
  pixelSizeUm: null,
  sensorWidthPx: null,
  sensorHeightPx: null,
  colorKind: null,
  decisionRevision: 1,
  state: "confirmed",
  provenance: { source: "user" },
})
const RIGS = [rig("rig-esprit", "Esprit 100"), rig("rig-redcat", "RedCat 51")]

/** The dialog at `/`, with `/settings/equipment` registered only when `withEquipmentSettings`. */
function renderDialog({ withEquipmentSettings = false } = {}) {
  const root = createRootRoute()
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: () => <NewProjectDialog open onOpenChange={() => undefined} /> }),
    createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: () => <h1>project page</h1> }),
    ...(withEquipmentSettings ? [createRoute({ getParentRoute: () => root, path: "/settings/equipment", component: () => <h1>equipment</h1> })] : []),
  ]
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, user: userEvent.setup() }
}

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
afterEach(() => {
  cleanup()
  clearMocks()
  act(() => setLocale("en-GB"))
})

const NGC7000 = { id: "t-ngc7000", designation: "NGC 7000", aliases: [], commonName: "North America Nebula", objectType: "HII", coordinates: null, provenance: { source: "user" as const }, providerId: null }
const SEARCH: TargetsSearchResults = { results: [{ target: NGC7000 as TargetsSearchResult["target"], source: "my_targets", favourite: false, inMyTargets: true, matchedAlias: null }], simbad: { state: "searched" } }
const UNSAVED = { code: "persistence_failure", identity: null, scope: null, retry: "retry", currentRevision: null, successors: [], window: null, correction: null }

/** The library's answers: `rigs` from `library_list_equipment`, one My targets hit for any search, and `project_create` recorded. */
function host(rigs: () => Equipment[] = () => RIGS) {
  const created: unknown[] = []
  mockIPC((command, args) => {
    if (command === "library_list_equipment") return rigs()
    if (command === "targets_search") return SEARCH
    if (command === "project_create") {
      created.push(args)
      return { id: "p-new" }
    }
    return null
  })
  return created
}

type User = ReturnType<typeof userEvent.setup>

async function nameIt(user: User) {
  await user.type(await screen.findByRole("textbox", { name: new RegExp(m.newproject_field_name()) }), "Cygnus HOO")
}

async function pickSubject(user: User) {
  await user.type(screen.getByRole("combobox", { name: m.project_subjects() }), "NGC")
  await user.click(await screen.findByRole("option", { name: /NGC 7000/ }))
  expect(await screen.findByRole("rowheader", { name: "NGC 7000" })).toBeInTheDocument()
}

const createButton = () => screen.getByRole("button", { name: m.newproject_create() })

describe("New Project", () => {
  it("creates the Project with its picked subject and rigs", async () => {
    const created = host()
    const { user, router } = renderDialog()
    await nameIt(user)
    await pickSubject(user)
    await user.click(await screen.findByRole("checkbox", { name: "RedCat 51" }))
    expect(screen.getByRole("checkbox", { name: "Esprit 100" })).not.toBeChecked()
    await user.click(createButton())
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]).toEqual({ name: "Cygnus HOO", notes: null, subjects: [{ targetId: "t-ngc7000" }], rigIds: ["rig-redcat"], goals: [] })
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects/p-new"))
  })

  it("keeps Create unavailable until a subject is picked", async () => {
    const created = host()
    const { user } = renderDialog()
    await nameIt(user)
    await user.click(await screen.findByRole("checkbox", { name: "RedCat 51" }))
    expect(createButton()).toHaveAttribute("aria-disabled", "true")
    expect(createButton()).toHaveAccessibleDescription(expect.stringContaining(m.project_subject_required()))
    await user.click(createButton())
    expect(created).toEqual([])
  })

  it("keeps Create unavailable while no rig is ticked", async () => {
    const created = host()
    const { user } = renderDialog()
    await nameIt(user)
    await pickSubject(user)
    expect(await screen.findByRole("checkbox", { name: "RedCat 51" })).not.toBeChecked()
    expect(createButton()).toHaveAttribute("aria-disabled", "true")
    expect(createButton()).toHaveAccessibleDescription(expect.stringContaining(m.project_rig_required()))
    await user.click(createButton())
    expect(created).toEqual([])
  })

  it.each(LOCALES)("says where rigs are added when none is saved, as text while Settings › Equipment is not registered, and creates nothing (%s)", async (locale) => {
    act(() => setLocale(locale))
    const created = host(() => [])
    const { user } = renderDialog()
    expect(await screen.findByText(m.rigs_none_saved())).toBeInTheDocument()
    expect(screen.getByText(m.rigs_add_in_settings())).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: m.rigs_add_in_settings() })).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
    await nameIt(user)
    await pickSubject(user)
    expect(createButton()).toHaveAttribute("aria-disabled", "true")
    await user.click(createButton())
    expect(created).toEqual([])
  })

  it("links to Settings › Equipment once that route is registered", async () => {
    host(() => [])
    renderDialog({ withEquipmentSettings: true })
    expect(await screen.findByRole("link", { name: m.rigs_add_in_settings() })).toHaveAttribute("href", "/settings/equipment")
  })

  it("words a failed rig read with Retry, and offers the rigs once a retry reads them", async () => {
    let reads = 0
    host(() => {
      reads += 1
      if (reads === 1) throw UNSAVED
      return RIGS
    })
    const { user } = renderDialog()
    expect(await screen.findByText(m.action_failure_persistence_failure())).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).toBeNull()
    await user.click(screen.getByRole("button", { name: m.verb_retry() }))
    expect(await screen.findByRole("checkbox", { name: "Esprit 100" })).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "RedCat 51" })).toBeInTheDocument()
    expect(screen.queryByText(m.action_failure_persistence_failure())).toBeNull()
  })
})
