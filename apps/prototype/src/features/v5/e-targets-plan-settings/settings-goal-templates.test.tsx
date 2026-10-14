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

/** Settings › Goal templates on its own, inside a router (row actions and previews render links). */
function renderPage() {
  const router = createRouter({ routeTree: createRootRoute({ component: GoalTemplatesSettingsPage }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

/** Opens a row's ⋯ and picks an item by its label. */
async function rowAction(user: ReturnType<typeof userEvent.setup>, row: string, item: string) {
  const [trigger] = await screen.findAllByRole("button", { name: m.actions_for({ name: row }) })
  await user.click(trigger!)
  await user.click(await screen.findByRole("menuitem", { name: new RegExp(`^${item}`) }))
}

describe("Settings › Goal templates (C7)", () => {
  it("Duplicate copies the quality bar, the panel balance and the window rule", async () => {
    const user = userEvent.setup()
    renderPage()
    await rowAction(user, NAME, m.template_duplicate())
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))

    const copyName = m.template_copy_name({ name: NAME })
    const copy = Object.values(store.getState().catalog.goalTemplates).find((t) => t.name === copyName)
    expect(copy).toBeDefined()
    expect(copy!.values.map((v) => v.qualityBar)).toEqual([qualityBarFor(2.5)])
    expect(copy!.conditions).toEqual(CONDITIONS)
  })

  it("Edit saves the panel balance and a season window the template now carries", async () => {
    const user = userEvent.setup()
    renderPage()
    await rowAction(user, NAME, m.settings_edit())
    const dialog = await screen.findByRole("dialog")
    const balance = within(dialog).getByRole("spinbutton", { name: m.fields_label_unit({ label: m.project_col_panel_balance(), unit: m.template_balance_unit() }) })
    await user.clear(balance)
    await user.type(balance, "15")
    await user.click(within(dialog).getByRole("combobox", { name: m.project_col_window() }))
    await user.click(await screen.findByRole("option", { name: m.domain_window_rule_season() }))
    await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))

    const saved = Object.values(store.getState().catalog.goalTemplates).find((t) => t.name === NAME)
    expect(saved!.conditions).toEqual({ panelBalancePct: 15, window: { kind: "season" } })
  })
})
