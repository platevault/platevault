/**
 * Settings and first-run setup over a stateful mocked library host
 * (`__fixtures__/settings-host.ts`): what each section reads and sends, a
 * save that survives a remount, a failed save that keeps the user's edits, a
 * stale revision that is read again, refusals shown beside their control,
 * the native folder picker's Cancel and pick, and the Index step's planning
 * criteria (LIB-FR-31, LIB-AC-47) in both locales.
 */
import { createMemoryHistory } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createQueryClient } from "@/api/query"
import { setLocale } from "@/app/preferences"
import { AppRoot } from "@/app/root"
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
      // One density: no density control anywhere in Appearance.
      expect(screen.getByRole("combobox", { name: m.shell_language() })).toBeInTheDocument()
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
      expect(await screen.findByText(`120 ${m.calibration_unit_days()}`)).toBeInTheDocument()
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
    const args = ["-r", "{view}", "My Script.js", ""]
    expect(parseArgs(argsText(args))).toEqual(args)
  })
})
