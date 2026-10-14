import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Toaster } from "@/components/ui/toast"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { setFault } from "@/store/simulation"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ProjectTrashPage } from "./trash"

// The demo library's Cygnus Project holds "NGC 7000 Ha quick look" in its Trash.
const PROJECT = "prj_cygnus"
const RUN = "run_ngc_test"

const run = () => store.getState().catalog.runs[RUN]!

function renderTrash() {
  const root = createRootRoute({
    component: () => (
      <>
        <ProjectTrashPage />
        <Toaster />
      </>
    ),
  })
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId/trash" })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${PROJECT}/trash`] }) })
  render(<RouterProvider router={router} />)
}

/** Opens the run's ⋯ menu and returns its Restore item. */
async function restoreItem(user: ReturnType<typeof userEvent.setup>, label: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table", { name: m.trash_of_project({ name: store.getState().catalog.projects[PROJECT]!.name }) })
  await user.click(within(table).getByRole("button", { name: m.actions_for({ name: run().name }) }))
  return screen.findByRole("menuitem", { name: label })
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

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

describe("Project Trash: Restore run under the Quick actions switch (A1)", () => {
  it("One-click restores at once with an Undo notice, and Undo moves the run back to Trash", async () => {
    const user = userEvent.setup()
    renderTrash()
    expect(run().trashedAt).not.toBeNull()

    await user.click(await restoreItem(user, m.trash_restore_run()))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(run().trashedAt).toBeNull()

    const notice = (await screen.findByText(m.trash_run_restored({ name: run().name }))).closest<HTMLElement>("[data-slot=toast]")!
    await user.click(within(notice).getByRole("button", { name: m.wrapup_undo() }))
    expect(run().trashedAt).not.toBeNull()
    expect(await screen.findByRole("rowheader", { name: run().name })).toBeInTheDocument()
  })

  it("Open page keeps the confirm, and restores with no Undo notice", async () => {
    setFault("quickActions", "open-page")
    const user = userEvent.setup()
    renderTrash()

    await user.click(await restoreItem(user, `${m.trash_restore_run()}…`))
    const dialog = await screen.findByRole("alertdialog", { name: m.trash_restore_title({ name: run().name }) })
    expect(run().trashedAt).not.toBeNull()
    await user.click(within(dialog).getByRole("button", { name: m.trash_restore_run() }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(run().trashedAt).toBeNull()
    expect(screen.queryByText(m.trash_run_restored({ name: run().name }))).toBeNull()
  })
})
