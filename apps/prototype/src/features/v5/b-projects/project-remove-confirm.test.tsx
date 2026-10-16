import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { closeSheet } from "@/app/ui-state"
import { rigName, subjectName } from "@/domain/derive"
import { createSeed } from "@/domain/seed"
import type { Project } from "@/domain/types"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ProjectPage } from "./project"

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

/** One row action that removes something from a Project, and how to tell it is still there. */
interface Removal {
  projectId: string
  table: string
  row: string
  /** The menu item's label, "…" included: a confirmation follows. */
  item: string
  title: string
  present: () => boolean
}

const catalog = () => store.getState().catalog
const project = (id: string): Project => catalog().projects[id]!
/** A menu adds "…" to an item a confirmation follows (`actionLabel`). */
const asked = (label: string) => `${label}…`

/** A goal of a whole subject (no panel group), so its row reads "subject · channel". */
function goal(): Removal {
  const p = Object.values(catalog().projects).find((c) => c.state === "open" && c.goals.some((g) => g.groupId === null))!
  const { id, channel, subjectId } = p.goals.find((g) => g.groupId === null)!
  const subject = subjectName(m, catalog(), p.subjects.find((s) => s.id === subjectId)!)
  return {
    projectId: p.id,
    table: m.project_goals_of({ name: p.name }),
    row: `${subject} · ${channel}`,
    item: asked(m.goal_remove_goal({ channel })),
    title: m.goal_remove_title({ channel, subject }),
    present: () => project(p.id).goals.some((g) => g.id === id),
  }
}

/** A subject of an open Project: removing it changes suggestions only, so it is never refused. */
function subject(): Removal {
  const p = Object.values(catalog().projects).find((c) => c.state === "open" && c.subjects.length > 0)!
  const free = p.subjects[0]!
  const { id } = free
  const name = subjectName(m, catalog(), free)
  return {
    projectId: p.id,
    table: m.project_subjects_of({ name: p.name }),
    row: name,
    item: asked(m.project_remove()),
    title: m.project_remove_from_title({ name, project: p.name }),
    present: () => project(p.id).subjects.some((s) => s.id === id),
  }
}

/** A rig of an open Project: removing it changes suggestions only, so its Remove is available. */
function rig(): Removal {
  const p = Object.values(catalog().projects).find((c) => c.state === "open" && c.rigIds.length > 0)!
  const rigId = p.rigIds[0]!
  const name = rigName(m, catalog(), rigId)
  return {
    projectId: p.id,
    table: m.project_rigs_of({ name: p.name }),
    row: name,
    item: asked(m.project_remove()),
    title: m.project_remove_from_title({ name, project: p.name }),
    present: () => project(p.id).rigIds.includes(rigId),
  }
}

/** Renders the Project page and returns a step that chooses the removal from its row's ⋯ menu and returns the confirmation it opens. */
async function renderRemoval(removal: Removal) {
  const root = createRootRoute()
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (search: Record<string, unknown>) => search })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${removal.projectId}`] }) })
  render(<RouterProvider router={router} />)
  const user = userEvent.setup()
  const box = await screen.findByRole("table", { name: removal.table })
  const choose = async () => {
    await user.click(within(box).getByRole("button", { name: m.actions_for({ name: removal.row }) }))
    await user.click(await screen.findByRole("menuitem", { name: removal.item }))
    return screen.findByRole("alertdialog", { name: removal.title })
  }
  return { user, choose }
}

const closed = () => waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

describe("Project page: removing a goal, a subject or a rig asks first", () => {
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

  describe.each([
    ["goal", goal],
    ["subject", subject],
    ["rig", rig],
  ])("Remove %s", (_, fixture) => {
    it("removes it on Remove in the confirmation, and not before", async () => {
      const removal = fixture()
      const { user, choose } = await renderRemoval(removal)
      const dialog = await choose()
      expect(removal.present()).toBe(true)
      await user.click(within(dialog).getByRole("button", { name: m.project_remove() }))
      await closed()
      expect(removal.present()).toBe(false)
    })

    it("keeps it on Cancel and on Escape", async () => {
      const removal = fixture()
      const { user, choose } = await renderRemoval(removal)
      await user.click(within(await choose()).getByRole("button", { name: m.verb_cancel() }))
      await closed()
      expect(removal.present()).toBe(true)
      await choose()
      await user.keyboard("{Escape}")
      await closed()
      expect(removal.present()).toBe(true)
    })
  })
})
