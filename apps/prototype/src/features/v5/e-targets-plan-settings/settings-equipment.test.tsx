import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
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

/** Opens the page header's Add equipment ▾ and picks a kind. */
async function addFromHeader(user: ReturnType<typeof userEvent.setup>, kind: string) {
  await user.click(await screen.findByRole("button", { name: m.equipment_add_menu() }))
  await user.click(await screen.findByRole("menuitem", { name: `${kind}…` }))
}

describe("Settings › Equipment: one Add equipment ▾ (the owner's answer of 2026-10-23)", () => {
  it("lists Camera, Telescope, Reducer, Filter and Rig in that order, and a section's own Add… shows only in its empty state", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: m.equipment_add_menu() }))
    const items = await screen.findAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual([m.equipment_camera(), m.equipment_telescope(), m.equipment_reducer(), m.equipment_filter(), m.equipment_rig()].map((kind) => `${kind}…`))
    await user.keyboard("{Escape}")
    for (const add of [m.equipment_add_camera(), m.equipment_add_telescope(), m.equipment_add_reducer(), m.equipment_add_filter(), m.project_add_rig()]) {
      for (const button of screen.queryAllByRole("button", { name: `${add}…` })) expect(button.closest("[data-slot=empty]")).not.toBeNull()
    }
    // The demo has cameras and rigs, so neither section offers its own Add…; it has no reducer, so Reducers does.
    expect(screen.queryByRole("button", { name: `${m.equipment_add_camera()}…` })).toBeNull()
    expect(screen.queryByRole("button", { name: `${m.project_add_rig()}…` })).toBeNull()
    expect(Object.keys(store.getState().catalog.reducers)).toHaveLength(0)
    expect(screen.getByRole("button", { name: `${m.equipment_add_reducer()}…` })).toBeInTheDocument()
  })

  it("each kind opens its own add dialog", async () => {
    const user = userEvent.setup()
    renderPage()
    const kinds = [
      { kind: m.equipment_telescope(), title: m.equipment_add_telescope() },
      { kind: m.equipment_reducer(), title: m.equipment_add_reducer() },
      { kind: m.equipment_filter(), title: m.equipment_add_filter() },
      { kind: m.equipment_rig(), title: m.project_add_rig() },
    ]
    for (const { kind, title } of kinds) {
      await addFromHeader(user, kind)
      const dialog = await screen.findByRole("dialog")
      expect(within(dialog).getByRole("heading", { name: title })).toBeInTheDocument()
      await user.click(within(dialog).getByRole("button", { name: m.verb_cancel() }))
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    }
  })
})

describe("Settings › Equipment: cameras (PLAN-EQ-FR-08)", () => {
  it("Add camera… of a model the rigs already hold asks for the other camera's alias too, and Save names both", async () => {
    const user = userEvent.setup()
    renderPage()
    await addFromHeader(user, m.equipment_camera())
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

  it("a camera's disclosure shows its Don't use darks / Don't use bias defaults and the INSTRUME values it matches", async () => {
    const user = userEvent.setup()
    renderPage()
    const table = await screen.findByRole("table", { name: m.equipment_cameras() })
    await user.click(within(table).getByRole("button", { name: m.table_row_details({ name: "ASI2600MM Pro · 2600MM #2" }) }))
    const details = await within(table).findByText(m.equipment_matches_instrume())
    const row = details.closest("tr")!
    expect(within(row).getByText(m.equipment_no_darks())).toBeInTheDocument()
    expect(within(row).getByText("ASI2600MM Pro, ZWO ASI2600MM Pro")).toBeInTheDocument()
  })
})

describe("Settings › Equipment: rig versions (PLAN-EQ-FR-07)", () => {
  it("Edit picks the night a change applies from after the current version, appends a version and lists every version", async () => {
    const user = userEvent.setup()
    renderPage()
    const rig = store.getState().catalog.opticalTrains[ESPRIT]!
    await rowAction(user, rig.name, m.settings_edit())
    const dialog = await screen.findByRole("dialog")
    // The night picker is named and described by its field: the night the current version began.
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
    // Header row plus one row per version, newest first: the current one marked, the first one also covering earlier nights (provisional).
    const rows = within(versions).getAllByRole("row")
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent(m.equipment_version_current({ night: formatNight(after.versionFrom, true) }))
    expect(rows[2]).toHaveTextContent(m.equipment_version_first({ night: formatNight(rig.versionFrom, true) }))
  })
})

describe("Settings › Equipment: empty sections", () => {
  it("names each empty record list once and offers its Add… in the empty state", async () => {
    store.replace({ ...createSeed("empty"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
    const user = userEvent.setup()
    renderPage()
    const sections = [
      { empty: m.equipment_no_cameras(), add: m.equipment_add_camera() },
      { empty: m.equipment_no_telescopes(), add: m.equipment_add_telescope() },
      { empty: m.equipment_no_reducers(), add: m.equipment_add_reducer() },
      { empty: m.tonight_no_filters(), add: m.equipment_add_filter() },
      { empty: m.equipment_no_rigs(), add: m.project_add_rig() },
    ]
    for (const { empty, add } of sections) {
      const state = (await screen.findByText(empty)).closest("[data-slot=empty]") as HTMLElement
      expect(within(state).getAllByRole("button", { name: `${add}…` })).toHaveLength(1)
      expect(screen.getAllByRole("button", { name: `${add}…` })).toHaveLength(1)
    }
    await user.click(screen.getByRole("button", { name: `${m.equipment_add_reducer()}…` }))
    expect(within(await screen.findByRole("dialog")).getByRole("heading", { name: m.equipment_add_reducer() })).toBeInTheDocument()
  })
})
