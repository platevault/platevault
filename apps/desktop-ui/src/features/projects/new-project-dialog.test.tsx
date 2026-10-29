/**
 * New Project's rigs (065 PRJ-FR-01/02) against the library IPC as the
 * webview sees it: the saved rigs come from `library_list_equipment` and
 * the picked ones go out with `project_create`.
 */
import { QueryClientProvider } from "@tanstack/react-query"
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Equipment } from "@/api/ipc"
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

describe("New Project rigs", () => {
  it("offers every saved rig and creates the Project with the picked ones", async () => {
    const created: unknown[] = []
    mockIPC((command, args) => {
      if (command === "library_list_equipment") return RIGS
      if (command === "project_create") {
        created.push(args)
        return { id: "p-new" }
      }
      return null
    })
    const { user, router } = renderDialog()
    await user.type(await screen.findByRole("textbox", { name: new RegExp(m.newproject_field_name()) }), "Cygnus HOO")
    await user.click(await screen.findByRole("checkbox", { name: "RedCat 51" }))
    expect(screen.getByRole("checkbox", { name: "Esprit 100" })).not.toBeChecked()
    await user.click(screen.getByRole("button", { name: m.newproject_create() }))
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]).toEqual({ name: "Cygnus HOO", notes: null, subjects: [], rigIds: ["rig-redcat"], goals: [] })
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects/p-new"))
  })

  it.each(LOCALES)("says where rigs are added when none is saved, as text while Settings › Equipment is not registered (%s)", async (locale) => {
    act(() => setLocale(locale))
    mockIPC((command) => (command === "library_list_equipment" ? [] : null))
    renderDialog()
    expect(await screen.findByText(m.rigs_none_saved())).toBeInTheDocument()
    expect(screen.getByText(m.rigs_add_in_settings())).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: m.rigs_add_in_settings() })).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("links to Settings › Equipment once that route is registered", async () => {
    mockIPC((command) => (command === "library_list_equipment" ? [] : null))
    renderDialog({ withEquipmentSettings: true })
    expect(await screen.findByRole("link", { name: m.rigs_add_in_settings() })).toHaveAttribute("href", "/settings/equipment")
  })
})
