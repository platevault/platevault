import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { closeSheet, openSheet } from "@/app/ui-state"
import { createSeed } from "@/domain/seed"
import { DEFAULT_SUBJECT_CONDITIONS, subjectConditions } from "@/domain/templates"
import type { Project } from "@/domain/types"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { NewProjectDialog } from "./new-project"

const TEMPLATE = "gtpl_user_hoo_mosaic"

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

/** New Project on its own, inside a router (Create opens the new Project), prefilled with one Target as its subject. */
async function openNewProject() {
  const router = createRouter({ routeTree: createRootRoute({ component: NewProjectDialog }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
  const known = new Set(Object.keys(store.getState().catalog.projects))
  const target = Object.values(store.getState().catalog.targets)[0]!
  act(() => openSheet({ kind: "new-project", targetId: target.id }))
  const dialog = await screen.findByRole("dialog", { name: m.newproject_title() })
  const rig = Object.values(store.getState().catalog.opticalTrains)[0]!
  // Base UI submenus animate open; the item is reachable before its pointer-events settle.
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  await user.click(within(dialog).getByRole("checkbox", { name: new RegExp(rig.name) }))
  return { dialog, user, created: (): Project => Object.values(store.getState().catalog.projects).find((p) => !known.has(p.id))! }
}

describe("New Project: template conditions (C7, astro-plan-0qzxe)", () => {
  it("gives every subject the conditions of the template the goals came from", async () => {
    const { dialog, user, created } = await openNewProject()
    await user.click(within(dialog).getByRole("button", { name: m.goal_add() }))
    await user.click(await screen.findByRole("menuitem", { name: m.goal_from_template() }))
    const template = store.getState().catalog.goalTemplates[TEMPLATE]!
    // The submenu item is pressed while the submenu still animates open, so it is clicked directly.
    fireEvent.click(await screen.findByRole("menuitem", { name: m.newproject_template_yours({ name: template.name }) }))
    expect(await within(dialog).findByRole("group", { name: m.goal_channel_goal({ channel: "Ha" }) })).toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: m.newproject_create() }))
    const project = created()
    expect(project.subjects).toHaveLength(1)
    // The template's panel balance and its window rule: a Season rule, pre-filled from the subject's visibility.
    const conditions = subjectConditions(project.subjects[0]!)
    expect(conditions.panelBalancePct).toBe(template.conditions!.panelBalancePct)
    expect(template.conditions!.window).toEqual({ kind: "season" })
    expect(conditions.window).toMatchObject({ kind: "season", from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(project.goals.map((g) => g.channel).sort()).toEqual(["Ha", "OIII"])
  })

  it("keeps the default conditions when the goals were typed without a template", async () => {
    const { dialog, user, created } = await openNewProject()
    await user.click(within(dialog).getByRole("button", { name: m.goal_add() }))
    await user.click(await screen.findByRole("menuitem", { name: "Ha" }))

    await user.click(within(dialog).getByRole("button", { name: m.newproject_create() }))
    const project = created()
    expect(subjectConditions(project.subjects[0]!)).toEqual(DEFAULT_SUBJECT_CONDITIONS)
    expect(project.goals.map((g) => g.channel)).toEqual(["Ha"])
  })
})
