import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { STATIC_DESTINATIONS } from "@/app/navigation"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { openLabel } from "./activity"
import { MatchingSettingsPage } from "./settings-matching"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderPage() {
  const root = createRootRoute()
  const page = createRoute({ getParentRoute: () => root, path: "/settings/matching", component: MatchingSettingsPage })
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/settings/matching"] }) })
  render(<RouterProvider router={router} />)
}

/** The table's rows as text, group headers included: "Framing", then "Overlap at least · 90 · %" per threshold. */
function tableRows(): string[] {
  const table = screen.getByRole("table", { name: m.settings_label_matching() })
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => Array.from(row.children, (cell) => cell.textContent?.trim() ?? "").filter(Boolean).join(" · "))
}

async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: `${m.settings_edit()}…` }))
  return screen.findByRole("dialog", { name: m.settings_label_matching() })
}

async function setField(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, value: string) {
  await user.clear(field)
  await user.type(field, value)
}

describe("Settings › Matching (D-W114, the owner's answer of 2026-10-23)", () => {
  it("reads every threshold as setting · value · unit, grouped by framing, flats, darks and bias", async () => {
    renderPage()
    expect(await screen.findByRole("heading", { level: 2, name: m.settings_matching() })).toBeInTheDocument()
    const { framing, flats, darks, bias } = store.getState().settings.matching
    expect(tableRows()).toEqual([
      m.equipment_matching_framing(),
      `${m.equipment_matching_overlap()} · ${framing.overlapPct} · %`,
      `${m.equipment_matching_centre()} · ${framing.centreArcmin} · ′`,
      `${m.equipment_matching_rotation()} · ${framing.rotationDeg} · °`,
      `${m.equipment_matching_panel_min()} · ${framing.panelOverlapMinPct} · %`,
      `${m.equipment_matching_panel_max()} · ${framing.panelOverlapMaxPct} · %`,
      m.calibration_heading_flats(),
      `${m.equipment_matching_flat_fine()} · ${flats.fineDeg} · °`,
      `${m.equipment_matching_flat_warn()} · ${flats.warnDeg} · °`,
      `${m.equipment_matching_window_nights()} · ${flats.windowNights} · ${m.equipment_unit_nights()}`,
      m.calibration_heading_darks(),
      `${m.equipment_matching_window_days()} · ${darks.windowDays} · ${m.calibration_unit_days()}`,
      `${m.equipment_matching_temperature()} · ${darks.temperatureWarnC} · °C`,
      m.calibration_heading_bias(),
      `${m.equipment_matching_window_days()} · ${bias.windowDays} · ${m.calibration_unit_days()}`,
      `${m.equipment_matching_temperature()} · ${bias.temperatureWarnC} · °C`,
    ])
    // One Edit for the whole page.
    expect(screen.getAllByRole("button", { name: `${m.settings_edit()}…` })).toHaveLength(1)
  })

  it("Edit… saves every threshold at once, and the table reads the saved values", async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openEdit(user)
    await setField(user, within(dialog).getByRole("spinbutton", { name: new RegExp(`^${m.equipment_matching_overlap()}`) }), "80")
    await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
    expect(store.getState().settings.matching.framing.overlapPct).toBe(80)
    expect(tableRows()).toContain(`${m.equipment_matching_overlap()} · 80 · %`)
  })

  it("an empty field keeps Save unavailable", async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openEdit(user)
    await user.clear(within(dialog).getByRole("spinbutton", { name: new RegExp(`^${m.equipment_matching_overlap()}`) }))
    expect(within(dialog).getByRole("button", { name: m.settings_save() })).toHaveAttribute("aria-disabled", "true")
  })

  it("refuses a fine flat rotation above its warning level and a lowest panel overlap above the highest, changing nothing", async () => {
    const user = userEvent.setup()
    renderPage()
    const before = store.getState().settings.matching
    const dialog = await openEdit(user)
    await setField(user, within(dialog).getByRole("spinbutton", { name: new RegExp(`^${m.equipment_matching_flat_fine()}`) }), "9")
    await setField(user, within(dialog).getByRole("spinbutton", { name: new RegExp(`^${m.equipment_matching_flat_warn()}`) }), "3")
    await setField(user, within(dialog).getByRole("spinbutton", { name: new RegExp(`^${m.equipment_matching_panel_min()}`) }), "60")
    await setField(user, within(dialog).getByRole("spinbutton", { name: new RegExp(`^${m.equipment_matching_panel_max()}`) }), "20")
    await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
    expect(await within(dialog).findByText(m.settings_matching_flat_rotation_order(), { exact: false })).toBeInTheDocument()
    expect(within(dialog).getByText(m.settings_matching_panel_overlap_order(), { exact: false })).toBeInTheDocument()
    expect(store.getState().settings.matching).toEqual(before)
  })

  it("is a Settings destination of its own, found by its keywords, and Activity opens it by name", () => {
    const destination = STATIC_DESTINATIONS.find((d) => d.to === "/settings/matching")
    expect(destination?.keywords).toContain("thresholds")
    expect(openLabel("/settings/matching")).toBe(m.activity_open_destination({ name: m.settings_matching() }))
  })
})
