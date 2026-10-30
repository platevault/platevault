/**
 * Settings and first-run setup over a stateful mocked library host
 * (`__fixtures__/settings-host.ts`): what each section reads and sends, a
 * save that survives a remount, a failed save that keeps the user's edits, a
 * stale revision that is read again, refusals shown beside their control,
 * the native folder picker's Cancel and pick (Add location… and Remap…), a
 * rig's filter list, and the Index step's planning criteria (LIB-FR-31,
 * LIB-AC-47) in both locales.
 */
import { createMemoryHistory } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createQueryClient } from "@/api/query"
import { setLocale } from "@/app/preferences"
import { AppRoot } from "@/app/root"
import { formatCount, formatList } from "@/lib/format"
import { DEFAULT_LOCALE, LOCALES, m } from "@/lib/i18n"
import { createAppRouter } from "@/routes"
import { CRITERIA, catalog, location, nativePath, scan, settingsHost } from "./__fixtures__/settings-host"
import { argsText, parseArgs } from "./applications-page"
import { endWalk, walkStops } from "./walk"

const TEST_MS = 30_000

function serve(...args: Parameters<typeof settingsHost>) {
  const host = settingsHost(...args)
  mockIPC(host.handler)
  return host
}

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] })
  render(<AppRoot router={createAppRouter(history)} client={createQueryClient()} />)
  return { history, user: userEvent.setup() }
}

const original = { resizeObserver: globalThis.ResizeObserver, scrollIntoView: Element.prototype.scrollIntoView }
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = () => {}
})
afterAll(() => {
  globalThis.ResizeObserver = original.resizeObserver
  Element.prototype.scrollIntoView = original.scrollIntoView
})
afterEach(() => {
  vi.restoreAllMocks()
  act(endWalk)
  cleanup()
  clearMocks()
  act(() => setLocale(DEFAULT_LOCALE))
})

const label = (name: string, unit: string) => m.fields_label_unit({ label: name, unit })
/** An action's accessible name: its label, with the "…" a dialog-opening action adds. */
const named = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}…?$`)

async function choose(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement, field: string, option: string) {
  await user.click(within(scope).getByRole("combobox", { name: field }))
  await user.click(await screen.findByRole("option", { name: option }))
}

describe.each(LOCALES)("Settings in %s", (locale) => {
  beforeEach(() => {
    act(() => setLocale(locale))
  })

  it(
    "opens bare /settings on Appearance, with every section in the section list",
    async () => {
      serve()
      const { history } = renderAt("/settings")
      expect(await screen.findByRole("heading", { level: 2, name: m.settings_appearance() })).toBeInTheDocument()
      await waitFor(() => expect(history.location.pathname).toBe("/settings/appearance"))
      const sections = screen.getByRole("navigation", { name: m.settings_sections() })
      for (const name of [m.settings_help(), m.common_locations(), m.settings_equipment(), m.settings_matching(), m.settings_naming(), m.settings_sites(), m.settings_goal_templates(), m.settings_applications(), m.settings_about()]) {
        expect(within(sections).getByRole("link", { name })).toBeInTheDocument()
      }
      // One density: Appearance offers the theme and the language, and no density control at all.
      expect(screen.getByRole("combobox", { name: m.shell_language() })).toBeInTheDocument()
      const main = screen.getByRole("main")
      expect(within(main).queryByText(/densit/i)).toBeNull()
      const controls = [...within(main).queryAllByRole("combobox"), ...within(main).queryAllByRole("radiogroup"), ...within(main).queryAllByRole("slider"), ...within(main).queryAllByRole("switch")]
      expect(controls.map((control) => control.getAttribute("aria-label") ?? control.textContent ?? "").filter((name) => /densit/i.test(name))).toEqual([])
    },
    TEST_MS,
  )

  it(
    "registers a location only from a picked folder: Cancel answers null and registers nothing, a pick sends the NativePath",
    async () => {
      const host = serve()
      const { user } = renderAt("/settings/locations")
      await user.click(await screen.findByRole("button", { name: named(m.storage_add_location()) }))
      const dialog = await screen.findByRole("dialog")
      // Cancel in the native picker: nothing is chosen and Register stays unavailable.
      await user.click(within(dialog).getByRole("button", { name: m.import_choose_a_folder() }))
      await waitFor(() => expect(host.sent("library_pick_folder")).toHaveLength(1))
      expect(within(dialog).getByText(m.status_not_set())).toBeInTheDocument()
      const register = within(dialog).getByRole("button", { name: m.storage_add_location() })
      expect(register).toHaveAttribute("aria-disabled", "true")

      host.state.picked = nativePath("/Volumes/Astro/Lights")
      await user.click(within(dialog).getByRole("button", { name: m.import_choose_a_folder() }))
      expect(await within(dialog).findByText("/Volumes/Astro/Lights")).toBeInTheDocument()
      expect(within(dialog).getByRole("textbox", { name: m.location_display_name() })).toHaveValue("Lights")
      await user.click(within(dialog).getByRole("button", { name: m.storage_add_location() }))
      await waitFor(() => expect(host.sent("library_register_location")).toEqual([{ path: nativePath("/Volumes/Astro/Lights"), displayName: "Lights", role: "captures" }]))
      expect(await screen.findByRole("rowheader", { name: "Lights" })).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "shows the library's refusal beside a rig it won't delete, and keeps the rig",
    async () => {
      const host = serve()
      const { user } = renderAt("/settings/equipment")
      const row = (await screen.findByRole("rowheader", { name: "RedCat 51" })).closest("tr") as HTMLElement
      host.fail("library_delete_equipment", "invalid_input", "none")
      await user.click(within(row).getByRole("button", { name: new RegExp("RedCat 51") }))
      await user.click(await screen.findByRole("menuitem", { name: new RegExp(m.settings_remove()) }))
      const confirm = await screen.findByRole("alertdialog")
      await user.click(within(confirm).getByRole("button", { name: m.settings_remove() }))
      expect(await screen.findByText(m.action_failure_invalid_input())).toBeInTheDocument()
      expect(host.sent("library_delete_equipment")).toEqual([{ equipmentId: "rig-1", expectedRevision: 4 }])
      expect(screen.getByRole("rowheader", { name: "RedCat 51" })).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "keeps a rig's edits through a stale revision and saves them over the revision read again",
    async () => {
      const host = serve()
      const { user } = renderAt("/settings/equipment")
      const row = (await screen.findByRole("rowheader", { name: "RedCat 51" })).closest("tr") as HTMLElement
      await user.click(within(row).getByRole("button", { name: new RegExp("RedCat 51") }))
      await user.click(await screen.findByRole("menuitem", { name: named(m.settings_edit()) }))
      const dialog = await screen.findByRole("dialog")
      // Someone else saved the rig since the page read it.
      const [rig] = host.state.rigs
      if (rig) host.state.rigs = [{ ...rig, equipment: { ...rig.equipment, decisionRevision: 7 } }]
      const telescope = within(dialog).getByRole("textbox", { name: m.equipment_telescope() })
      await user.clear(telescope)
      await user.type(telescope, "Esprit 100")
      await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
      expect(await within(dialog).findByText(m.action_failure_conflict())).toBeInTheDocument()
      await waitFor(() => expect(host.sent("library_list_rig_filters").length).toBeGreaterThan(1))
      expect(within(dialog).getByRole("textbox", { name: m.equipment_telescope() })).toHaveValue("Esprit 100")
      await user.click(within(dialog).getByRole("button", { name: new RegExp(`^(${m.settings_save()}|${m.verb_retry()})$`) }))
      await waitFor(() => expect(host.sent("library_save_equipment").map((args) => args.expectedRevision)).toEqual([4, 7]))
      expect(host.state.rigs[0]?.equipment.telescope).toBe("Esprit 100")
    },
    TEST_MS,
  )

  async function openRigFilters(user: ReturnType<typeof userEvent.setup>) {
    const row = (await screen.findByRole("rowheader", { name: "RedCat 51" })).closest("tr") as HTMLElement
    await user.click(within(row).getByRole("button", { name: new RegExp("RedCat 51") }))
    await user.click(await screen.findByRole("menuitem", { name: named(m.equipment_edit_filters()) }))
    return screen.findByRole("dialog", { name: m.equipment_filters_title({ name: "RedCat 51" }) })
  }

  it(
    "saves a rig's filter list over its revision, and the saved list shows after a remount",
    async () => {
      const host = serve()
      const first = renderAt("/settings/equipment")
      const dialog = await openRigFilters(first.user)
      await first.user.click(within(dialog).getByRole("button", { name: m.equipment_add_filter() }))
      const added = within(dialog).getByRole("group", { name: m.equipment_filter_numbered({ n: "2" }) })
      await first.user.type(within(added).getByRole("textbox", { name: m.equipment_name() }), "OIII 3nm")
      await first.user.type(within(added).getByRole("textbox", { name: m.equipment_matches_filter() }), "OIII, O3")
      // Save stays unavailable until the new filter passes a band.
      expect(within(dialog).getByRole("button", { name: m.settings_save() })).toHaveAttribute("aria-disabled", "true")
      await first.user.click(within(added).getByRole("checkbox", { name: "OIII" }))
      await first.user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(host.sent("rig_filters_save")).toEqual([
        {
          equipmentId: "rig-1",
          filters: [
            { id: "f-ha", name: "Ha", matchValues: ["Ha"], bands: ["Ha"] },
            { id: null, name: "OIII 3nm", matchValues: ["OIII", "O3"], bands: ["OIII"] },
          ],
          expectedRevision: 2,
        },
      ])

      cleanup()
      mockIPC(host.handler)
      renderAt("/settings/equipment")
      const row = (await screen.findByRole("rowheader", { name: "RedCat 51" })).closest("tr") as HTMLElement
      expect(await within(row).findByText(formatList(["Ha", "OIII 3nm"]))).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "keeps a rig's filter edits through a stale revision and saves them over the revision read again",
    async () => {
      const host = serve()
      const { user } = renderAt("/settings/equipment")
      const dialog = await openRigFilters(user)
      // Someone else saved the list since the page read it.
      const [rig] = host.state.rigs
      if (rig) host.state.rigs = [{ ...rig, filters: { ...rig.filters, revision: 5 } }]
      const name = within(within(dialog).getByRole("group", { name: m.equipment_filter_numbered({ n: "1" }) })).getByRole("textbox", { name: m.equipment_name() })
      await user.clear(name)
      await user.type(name, "H-alpha")
      await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
      expect(await within(dialog).findByText(m.action_failure_conflict())).toBeInTheDocument()
      await waitFor(() => expect(host.sent("library_list_rig_filters").length).toBeGreaterThan(1))
      expect(name).toHaveValue("H-alpha")
      await user.click(within(dialog).getByRole("button", { name: new RegExp(`^(${m.settings_save()}|${m.verb_retry()})$`) }))
      await waitFor(() => expect(host.sent("rig_filters_save").map((args) => args.expectedRevision)).toEqual([2, 5]))
      expect(host.state.rigs[0]?.filters.filters.map((f) => f.name)).toEqual(["H-alpha"])
    },
    TEST_MS,
  )

  async function chooseRemap(user: ReturnType<typeof userEvent.setup>) {
    const row = (await screen.findByRole("rowheader", { name: "Lights" })).closest("tr") as HTMLElement
    await user.click(within(row).getByRole("button", { name: new RegExp("Lights") }))
    await user.click(await screen.findByRole("menuitem", { name: named(m.location_remap()) }))
    return row
  }
  // Read in the locale the test runs in, not when the suite is collected.
  const remapTitle = () => m.location_remap_title({ name: "Lights", path: "/Volumes/Cold-1/Lights" })

  it(
    "remaps a location only to a picked folder: Cancel sends nothing, a pick sends the path and the row reads the new folder",
    async () => {
      const host = serve(catalog({ locations: [location("loc-1", "Lights", "captures")] }))
      const { user } = renderAt("/settings/locations")
      // Cancel in the native picker: no review, no remap, no dialog.
      await chooseRemap(user)
      await waitFor(() => expect(host.sent("library_pick_folder")).toHaveLength(1))
      expect(host.sent("library_review_remap")).toEqual([])
      expect(screen.queryByRole("dialog")).toBeNull()

      host.state.picked = nativePath("/Volumes/Cold-1/Lights")
      const row = await chooseRemap(user)
      const dialog = await screen.findByRole("dialog", { name: remapTitle() })
      expect(host.sent("library_review_remap")).toEqual([{ locationId: "loc-1", proposedPath: nativePath("/Volumes/Cold-1/Lights") }])
      await user.click(within(dialog).getByRole("button", { name: m.location_remap_confirm({ count: 1, frames: formatCount(1) }) }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(host.sent("library_apply_remap")).toEqual([{ reviewId: host.state.reviews[0]?.id, expectedRevision: 1 }])
      expect(await within(row).findByText("/Volumes/Cold-1/Lights")).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "shows the library's refusal of a remap's review and of the remap, and keeps the location's folder",
    async () => {
      const host = serve(catalog({ locations: [location("loc-1", "Lights", "captures")], picked: nativePath("/Volumes/Cold-1/Lights") }))
      const { user } = renderAt("/settings/locations")
      host.fail("library_review_remap", "access_denied", "none")
      const row = await chooseRemap(user)
      expect(await screen.findByText(m.action_failure_access_denied())).toBeInTheDocument()
      expect(screen.queryByRole("dialog")).toBeNull()

      host.fail("library_apply_remap", "identity_conflict", "none")
      await chooseRemap(user)
      const dialog = await screen.findByRole("dialog", { name: remapTitle() })
      await user.click(within(dialog).getByRole("button", { name: m.location_remap_confirm({ count: 1, frames: formatCount(1) }) }))
      expect(await within(dialog).findByText(m.action_failure_identity_conflict())).toBeInTheDocument()
      expect(host.state.locations[0]?.location.path.display).toBe("/Astro/Lights")
      expect(within(row).getByText("/Astro/Lights")).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "keeps Remap unavailable when the review blocks frames, and names what blocks them",
    async () => {
      const host = serve(catalog({ locations: [location("loc-1", "Lights", "captures")], picked: nativePath("/Volumes/Cold-1/Lights") }))
      host.state.remapBlocked = [{ assetId: "asset-2", reason: "mismatch", message: "bytes differ" }]
      const { user } = renderAt("/settings/locations")
      await chooseRemap(user)
      const dialog = await screen.findByRole("dialog", { name: remapTitle() })
      expect(within(dialog).getByText(m.location_remap_differ({ count: 1, frames: formatCount(1) }))).toBeInTheDocument()
      const remap = within(dialog).getByRole("button", { name: m.location_remap_confirm({ count: 1, frames: formatCount(1) }) })
      expect(remap).toHaveAttribute("aria-disabled", "true")
      await user.click(remap)
      expect(host.sent("library_apply_remap")).toEqual([])
    },
    TEST_MS,
  )

  it(
    "narrows Locations to the locations that need attention from the status bar's link, with Show all",
    async () => {
      serve(catalog({ locations: [location("loc-1", "Lights", "captures"), location("loc-2", "NAS", "captures", { availability: "offline" })] }))
      const { user, history } = renderAt("/settings/locations?issues=with-issues")
      expect(await screen.findByRole("rowheader", { name: "NAS" })).toBeInTheDocument()
      expect(screen.queryByRole("rowheader", { name: "Lights" })).toBeNull()
      expect(screen.getByText(m.settings_locations_with_issues())).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: m.plan_show_all() }))
      expect(await screen.findByRole("rowheader", { name: "Lights" })).toBeInTheDocument()
      expect(history.location.search).not.toContain("issues")
    },
    TEST_MS,
  )

  it(
    "keeps the user's edits when a save fails, and shows the saved value after a remount",
    async () => {
      const host = serve()
      const first = renderAt("/settings/matching")
      await first.user.click(await screen.findByRole("button", { name: named(m.settings_edit()) }))
      const dialog = await screen.findByRole("dialog", { name: m.settings_label_matching() })
      const days = within(dialog).getByLabelText(label(m.equipment_matching_window_days(), m.calibration_unit_days()))
      await first.user.clear(days)
      await first.user.type(days, "120")
      host.fail("workflow_settings_save", "persistence_failure")
      await first.user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
      expect(await within(dialog).findByText(m.action_failure_persistence_failure())).toBeInTheDocument()
      // The dialog stays open with what the user typed.
      expect(within(dialog).getByLabelText(label(m.equipment_matching_window_days(), m.calibration_unit_days()))).toHaveValue(120)
      await first.user.click(within(dialog).getByRole("button", { name: m.verb_retry() }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(host.state.workflow.settings.darkBias.windowDays).toBe(120)

      cleanup()
      mockIPC(host.handler)
      renderAt("/settings/matching")
      expect(await screen.findByText(m.settings_value_days({ count: 120, n: "120" }))).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "reads a stale revision again after the library refuses it, and the next save names the current one",
    async () => {
      const host = serve()
      const { user } = renderAt("/settings/naming")
      await user.click(await screen.findByRole("button", { name: named(m.settings_edit()) }))
      const dialog = await screen.findByRole("dialog", { name: m.settings_label_group_keywords() })
      // Someone else saved the settings since the page read them.
      host.state.workflow = { ...host.state.workflow, revision: 9 }
      const group = within(dialog).getByRole("textbox", { name: m.naming_keyword_group() })
      await user.clear(group)
      await user.type(group, "SET")
      await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
      expect(await within(dialog).findByText(m.action_failure_conflict())).toBeInTheDocument()
      expect(host.sent("workflow_settings_save").map((args) => args.expectedRevision)).toEqual([5])
      await waitFor(() => expect(host.sent("workflow_settings_get").length).toBeGreaterThan(1))
      // The dialog keeps the user's text; the next save names the revision read again.
      expect(within(dialog).getByRole("textbox", { name: m.naming_keyword_group() })).toHaveValue("SET")
      await user.click(within(dialog).getByRole("button", { name: new RegExp(`^(${m.settings_save()}|${m.verb_retry()})$`) }))
      await waitFor(() => expect(host.sent("workflow_settings_save").map((args) => args.expectedRevision)).toEqual([5, 9]))
      expect(host.state.workflow.settings.keywords.group).toBe("SET")
    },
    TEST_MS,
  )

  it(
    "names the gaps instead of inventing data: About's data location and Target lookup",
    async () => {
      serve()
      const { user } = renderAt("/settings/about")
      expect(await screen.findByText(m.settings_gap_data_location())).toBeInTheDocument()
      await user.click(screen.getByRole("link", { name: m.settings_target_lookup() }))
      expect(await screen.findByText(m.settings_gap_target_lookup())).toBeInTheDocument()
    },
    TEST_MS,
  )
})

describe.each(LOCALES)("First-run setup in %s", (locale) => {
  beforeEach(() => {
    act(() => setLocale(locale))
  })

  it(
    "keeps Continue on Locations unavailable until a Captures location is registered",
    async () => {
      serve()
      renderAt("/setup/locations")
      const proceed = await screen.findByRole("button", { name: m.setup_continue_short() })
      expect(proceed).toHaveAttribute("aria-disabled", "true")
      cleanup()
      serve(catalog({ locations: [location("loc-1", "Lights", "captures")] }))
      renderAt("/setup/locations")
      await screen.findByRole("rowheader", { name: "Lights" })
      await waitFor(() => expect(screen.getByRole("button", { name: m.setup_continue_short() })).not.toHaveAttribute("aria-disabled", "true"))
    },
    TEST_MS,
  )

  it(
    "adds a Captures location from the native picker on the Locations step, and Cancel adds nothing",
    async () => {
      const host = serve()
      const { user } = renderAt("/setup/locations")
      await user.click(await screen.findByRole("button", { name: named(m.location_role_captures_add()) }))
      const dialog = await screen.findByRole("dialog")
      await user.click(within(dialog).getByRole("button", { name: m.import_choose_a_folder() }))
      await waitFor(() => expect(host.sent("library_pick_folder")).toHaveLength(1))
      expect(within(dialog).getByRole("button", { name: m.storage_add_location() })).toHaveAttribute("aria-disabled", "true")
      host.state.picked = nativePath("/Volumes/Astro/Lights")
      await user.click(within(dialog).getByRole("button", { name: m.import_choose_a_folder() }))
      expect(await within(dialog).findByText("/Volumes/Astro/Lights")).toBeInTheDocument()
      await user.click(within(dialog).getByRole("button", { name: m.storage_add_location() }))
      await waitFor(() => expect(host.sent("library_register_location")).toEqual([{ path: nativePath("/Volumes/Astro/Lights"), displayName: "Lights", role: "captures" }]))
      await waitFor(() => expect(screen.getByRole("button", { name: m.setup_continue_short() })).not.toHaveAttribute("aria-disabled", "true"))
    },
    TEST_MS,
  )

  it(
    "shows no Developer Mode row on macOS or Linux",
    async () => {
      for (const platform of ["MacIntel", "Linux x86_64"]) {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
        const host = serve(catalog({ locations: [location("loc-1", "Lights", "captures")] }))
        renderAt("/setup/locations")
        await screen.findByRole("rowheader", { name: "Lights" })
        expect(screen.queryByRole("heading", { name: m.settings_developer_mode() })).toBeNull()
        expect(host.sent("library_check_symlinks")).toEqual([])
        cleanup()
      }
    },
    TEST_MS,
  )

  it(
    "on Windows checks the processing location by itself, reads Off, offers Check again and names the Windows settings gap",
    async () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32")
      const results = location("loc-2", "Results", "results")
      const host = serve(catalog({ locations: [location("loc-1", "Lights", "captures"), results] }))
      const { user } = renderAt("/setup/locations")
      const row = (await screen.findByRole("heading", { name: m.settings_developer_mode() })).closest("section") as HTMLElement
      expect(await within(row).findByText(m.status_off())).toBeInTheDocument()
      expect(host.sent("library_check_symlinks")).toEqual([{ folder: results.location.path }])
      expect(host.sent("library_pick_folder")).toEqual([])
      expect(within(row).getByRole("button", { name: m.settings_open_windows_settings() })).toHaveAttribute("aria-disabled", "true")
      await user.click(within(row).getByRole("button", { name: m.apps_check_again() }))
      await waitFor(() => expect(host.sent("library_check_symlinks")).toHaveLength(2))
    },
    TEST_MS,
  )

  it(
    "asks for Home's criteria with no value filled in, keeps Start indexing unavailable until they are set, then saves them and scans",
    async () => {
      const host = serve(catalog({ locations: [location("loc-1", "Lights", "captures"), location("loc-2", "Darks", "calibration")] }))
      const { user } = renderAt("/setup/index")
      const start = await screen.findByRole("button", { name: m.setup_start_indexing() })
      expect(start).toHaveAttribute("aria-disabled", "true")
      const criteria = screen.getByRole("region", { name: m.setup_step_index() })
      const altitude = within(criteria).getByLabelText(label(m.criteria_min_altitude(), m.criteria_unit_degrees()))
      expect(altitude).toHaveValue(null)

      await user.type(altitude, "30")
      await choose(user, criteria, m.criteria_darkness(), m.criteria_darkness_astronomical())
      await choose(user, criteria, m.criteria_moon(), m.criteria_moon_below_horizon())
      await user.type(within(criteria).getByLabelText(label(m.criteria_min_duration(), m.criteria_unit_minutes())), "60")
      await waitFor(() => expect(start).not.toHaveAttribute("aria-disabled", "true"))
      await user.click(start)

      await waitFor(() => expect(host.sent("library_start_scan")).toEqual([{ locationId: "loc-1" }, { locationId: "loc-2" }]))
      expect(host.sent("planning_save_home_criteria")).toEqual([{ criteria: CRITERIA, expectedRevision: 0 }])
      expect(await screen.findByRole("button", { name: m.setup_open_library() })).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "keeps Start indexing unavailable without a Captures location, even with the criteria set",
    async () => {
      serve(catalog({ locations: [location("loc-1", "Darks", "calibration")], criteria: { criteria: CRITERIA, revision: 2 } }))
      renderAt("/setup/index")
      const start = await screen.findByRole("button", { name: m.setup_start_indexing() })
      await screen.findByRole("rowheader", { name: "Darks" })
      expect(start).toHaveAttribute("aria-disabled", "true")
    },
    TEST_MS,
  )

  it(
    "leaves the criteria unset when the user picks Index later, and hands over to Home",
    async () => {
      const host = serve(catalog({ locations: [location("loc-1", "Lights", "captures")], scans: [scan("scan-0", "loc-1")] }))
      const { user, history } = renderAt("/setup/index")
      await user.click(await screen.findByRole("button", { name: m.setup_index_later() }))
      await waitFor(() => expect(history.location.pathname).not.toBe("/setup/index"))
      expect(host.sent("planning_save_home_criteria")).toEqual([])
      expect(host.state.criteria.criteria).toBeNull()
    },
    TEST_MS,
  )
})

describe("orientation walk stops (LIB-FR-27)", () => {
  it("visits Projects, Targets, Sessions, Calibration, Import, Activity and Settings, and Home last", () => {
    const steps = walkStops(m, () => true, () => undefined)
    expect(steps.map((s) => s.id)).toEqual(["/projects", "/targets", "/sessions", "/calibration", "/import", "/activity", "/settings", "/"])
  })
  it("passes over a page that is not registered", () => {
    const steps = walkStops(m, (to) => to !== "/calibration", () => undefined)
    expect(steps.map((s) => s.id)).not.toContain("/calibration")
  })
})

describe("launch arguments", () => {
  it("round-trips arguments with spaces through one line", () => {
    const args = ["-r", "{view}", "My Script.js", "", 'say "hi"', "C:\\PixInsight\\bin", "a\\", "C:\\Program Files\\PixInsight\\"]
    expect(parseArgs(argsText(args))).toEqual(args)
  })
  it("writes an ordinary Windows path as typed, unquoted", () => {
    expect(argsText(["C:\\Tools\\run.exe", "{view}"])).toBe("C:\\Tools\\run.exe {view}")
  })
  it("keeps a typed Windows path's backslashes", () => {
    expect(parseArgs("C:\\Tools\\run.exe --input {view}")).toEqual(["C:\\Tools\\run.exe", "--input", "{view}"])
  })
})
