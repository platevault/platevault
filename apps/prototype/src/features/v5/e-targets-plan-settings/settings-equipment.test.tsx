import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { rigVersions } from "@/domain/indexing"
import { createSeed } from "@/domain/seed"
import { formatNight } from "@/lib/format"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { EquipmentSettingsPage } from "./settings-equipment"

const ESPRIT = "otr_esprit"
const MODEL = "ASI533MC Pro"

// The pinned first column measures its header; jsdom has no ResizeObserver.
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

/** Settings › Equipment on its own route, so its `?rig=` navigation and the Used by links resolve. */
function renderPage() {
  const root = createRootRoute()
  const page = createRoute({ getParentRoute: () => root, path: "/settings/equipment", component: EquipmentSettingsPage })
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/settings/equipment"] }) })
  render(<RouterProvider router={router} />)
}

/** Opens a row's ⋯ and picks an item by its label. */
async function rowAction(user: ReturnType<typeof userEvent.setup>, row: string, item: string) {
  const [trigger] = await screen.findAllByRole("button", { name: m.actions_for({ name: row }) })
  await user.click(trigger!)
  await user.click(await screen.findByRole("menuitem", { name: new RegExp(`^${item}`) }))
}

const save = (dialog: HTMLElement, label: string) => within(dialog).getByRole("button", { name: label })

describe("Settings › Equipment: cameras (PLAN-EQ-FR-08)", () => {
  it("Add camera… of a model the rigs already hold asks for the other camera's alias too, and Save names both", async () => {
    const user = userEvent.setup()
    renderPage()
    const [add] = await screen.findAllByRole("button", { name: `${m.equipment_add_camera()}…` })
    await user.click(add!)
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByRole("textbox", { name: m.equipment_name() }), MODEL)
    await user.type(within(dialog).getByRole("spinbutton", { name: m.equipment_sensor_width() }), "3008")
    await user.type(within(dialog).getByRole("spinbutton", { name: m.equipment_sensor_height() }), "3008")
    await user.type(within(dialog).getByRole("spinbutton", { name: m.equipment_pixel_size() }), "3.76")

    const twin = within(dialog).getByRole("textbox", { name: m.equipment_twin_alias({ name: MODEL }) })
    expect(save(dialog, m.equipment_add_camera())).toHaveAttribute("aria-disabled", "true")
    // The same alias twice is refused inline before anything is written.
    await user.type(within(dialog).getByRole("textbox", { name: m.equipment_camera_alias() }), "533 A")
    await user.type(twin, "533 A")
    expect(twin).toHaveAttribute("aria-invalid", "true")
    expect(within(dialog).getAllByText(m.equipment_alias_twice()).length).toBeGreaterThan(0)
    await user.clear(twin)
    await user.type(twin, "533 B")
    expect(twin).not.toHaveAttribute("aria-invalid")
    await user.click(save(dialog, m.equipment_add_camera()))

    const cameras = Object.values(store.getState().catalog.cameras).filter((c) => c.name === MODEL)
    expect(cameras.map((c) => c.physicalAlias).sort()).toEqual(["533 A", "533 B"])
    // Each row and its ⋯ read the camera by its alias.
    expect(await screen.findByRole("button", { name: m.actions_for({ name: `${MODEL} · 533 A` }) })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.actions_for({ name: `${MODEL} · 533 B` }) })).toBeInTheDocument()
  })

  it("lists each camera's Don't use darks / Don't use bias defaults", async () => {
    renderPage()
    const table = await screen.findByRole("table", { name: m.equipment_cameras() })
    const row = within(table).getByRole("row", { name: new RegExp(`2600MM #2`) })
    expect(within(row).getByText(m.equipment_no_darks())).toBeInTheDocument()
  })
})

describe("Settings › Equipment: rig versions (PLAN-EQ-FR-07)", () => {
  it("Edit picks the night a change applies from after the current version, appends a version and lists every version", async () => {
    const user = userEvent.setup()
    renderPage()
    const rig = store.getState().catalog.opticalTrains[ESPRIT]!
    await rowAction(user, rig.name, m.settings_edit())
    const dialog = await screen.findByRole("dialog")
    // The night picker is named and described by its field.
    const night = within(dialog).getByRole("group", { name: m.equipment_version_from() })
    expect(night).toHaveAccessibleDescription(m.equipment_version_from_help({ night: formatNight(rig.versionFrom, true) }))
    await user.click(within(dialog).getByRole("switch", { name: m.equipment_rotator() }))
    await user.click(save(dialog, m.settings_save()))

    const after = store.getState().catalog.opticalTrains[ESPRIT]!
    expect(rigVersions(after).map((v) => v.id)).toEqual([...rigVersions(rig).map((v) => v.id), after.versionId])
    expect(after.history.at(-1)).toEqual({ ...rigVersions(rig).at(-1)! })

    const rigs = screen.getByRole("table", { name: m.project_rigs() })
    await user.click(within(rigs).getByRole("button", { name: m.table_row_details({ name: rig.name }) }))
    const versions = await screen.findByRole("table", { name: m.equipment_versions_of({ name: rig.name }) })
    // Header row plus one row per version, newest first, the current one marked.
    const rows = within(versions).getAllByRole("row")
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent(m.equipment_version_current({ night: formatNight(after.versionFrom, true) }))
    expect(screen.getByText(m.equipment_version_rules())).toBeInTheDocument()
  })
})
