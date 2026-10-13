import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { qualityBarFor } from "@/domain/templates"
import type { GoalTemplate } from "@/domain/types"
import { m } from "@/lib/i18n"
import { saveGoalTemplate } from "@/store/actions/settings"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { GoalTemplatesSettingsPage } from "./settings-goal-templates"

const NAME = "Autumn mosaic"
const CONDITIONS: NonNullable<GoalTemplate["conditions"]> = { panelBalancePct: 20, window: { kind: "finish-by", night: "2026-12-31" } }

beforeEach(() => {
  store.replace({ ...createSeed("empty"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
  saveGoalTemplate({ id: null, name: NAME, values: [{ channel: "Ha", integrationS: 4 * 3600, frameCount: null, qualityBar: qualityBarFor(2.5) }], conditions: CONDITIONS })
})

/** Settings › Goal templates on its own, inside a router (the page reads the search for its return link). */
function renderPage() {
  const router = createRouter({ routeTree: createRootRoute({ component: GoalTemplatesSettingsPage }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

describe("Settings › Goal templates: Duplicate (C7)", () => {
  it("copies the quality bar, the panel balance and the window rule", async () => {
    const user = userEvent.setup()
    renderPage()
    // The row's verb plus its template name, which the button carries as screen-reader text.
    const duplicate = (await screen.findAllByRole("button", { name: new RegExp(`^${m.template_duplicate()}\\s*${NAME}$`) }))[0]!
    await user.click(duplicate)
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))

    const copyName = m.template_copy_name({ name: NAME })
    const copy = Object.values(store.getState().catalog.goalTemplates).find((t) => t.name === copyName)
    expect(copy).toBeDefined()
    expect(copy!.values.map((v) => v.qualityBar)).toEqual([qualityBarFor(2.5)])
    expect(copy!.conditions).toEqual(CONDITIONS)
  })
})
