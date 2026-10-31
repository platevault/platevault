/**
 * The Targets list over a mocked library host: what the user sees without
 * criteria or a planning site, the library's own values in the rows (the
 * graded band strip, the altitude sparkline, the darkness window and the
 * Moon), Suitable filters' clear-time order, and what a search result's
 * click sends when it opens, adds or fails.
 */
import { type AnyRoute, createMemoryHistory, createRoute } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { createQueryClient } from "@/api/query"
import { setLocale } from "@/app/preferences"
import { AppRoot } from "@/app/root"
import { gradeStripLabel } from "@/components/domain/grade-badges"
import { siteTime, siteTimeRange } from "@/components/domain/sky-lines"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { createShellRouter } from "@/routes"
import { candidate, DARKNESS, host as answers, refuse, row, targetsPage } from "./__fixtures__/targets-host"
import { TargetPage } from "./target"
import { TargetsPage } from "./targets"

const TEST_MS = 30_000

/** Serve the Targets host over the mocked IPC. */
function host(...args: Parameters<typeof answers>) {
  const lib = answers(...args)
  mockIPC(lib.handler)
  return lib
}
const M31 = candidate("t-m31", "M 31", { commonName: "Andromeda Galaxy" })
const M33 = candidate("t-m33", "M 33")

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] })
  const pages = (appWindow: AnyRoute): AnyRoute[] => [
    createRoute({ getParentRoute: () => appWindow, path: "/targets", component: TargetsPage }),
    createRoute({ getParentRoute: () => appWindow, path: "/targets/$targetId", component: TargetPage }),
  ]
  render(<AppRoot router={createShellRouter(history, pages)} client={createQueryClient()} />)
  return { history }
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
  cleanup()
  clearMocks()
  setLocale(DEFAULT_LOCALE)
})

describe("Targets list", () => {
  it.each(["en-GB", "pt-BR"] as const)(
    "lists My targets without Home's criteria, says why each planning value is unknown and sends the user to Home, in %s",
    async (locale) => {
      setLocale(locale)
      const lib = host({
        planning_target_rows: () =>
          targetsPage([row(M31, { maxAltitudeDeg: null, imgTimeMinutes: null, lunarSeparationDeg: null, bands: [], altitudeSamplesDeg: [], recommendation: null, unknownReason: "no_criteria" })], {
            basis: null,
            moon: null,
            darkness: null,
            planningUnavailable: "no_criteria",
          }),
      })
      renderAt("/targets")
      expect(await screen.findByText(m.targets_needs_criteria())).toBeInTheDocument()
      expect(screen.getByRole("button", { name: m.shell_not_found_home() })).toBeInTheDocument()
      const table = screen.getByRole("table", { name: m.nav_targets() })
      expect(await within(table).findByText("M 31")).toBeInTheDocument()
      expect(within(table).getAllByText(`${m.status_unknown()} · ${m.targets_reason_no_criteria()}`).length).toBeGreaterThan(0)
      // The library reads Home's stored criteria itself: the request carries none.
      expect(lib.sent("planning_target_rows")[0]?.args.query).not.toHaveProperty("criteria")
    },
    TEST_MS,
  )

  it.each(["en-GB", "pt-BR"] as const)(
    "shows the library's graded bands, altitude samples, darkness and Moon, and sends the URL's view, night, site and sort, in %s",
    async (locale) => {
      setLocale(locale)
      const lib = host({ planning_target_rows: () => targetsPage([row(M31)]) })
      renderAt("/targets?night=2026-10-30&site=site-1&sort=-img_time")
      const table = await screen.findByRole("table", { name: m.nav_targets() })
      expect(await within(table).findByText("M 31")).toBeInTheDocument()
      expect(within(table).getByText("2h10")).toBeInTheDocument()
      const strip = [
        { band: "L", grade: "good" },
        { band: "Ha", grade: "marginal" },
        { band: "OIII", grade: "poor" },
      ] as const
      expect(within(table).getByRole("img", { name: gradeStripLabel(m, strip) })).toBeInTheDocument()
      expect(within(table).getByText(m.targets_recommend_broadband())).toBeInTheDocument()
      // The peak is the library's Max alt; its time is the 22:00 UTC sample, where the samples culminate in darkness.
      expect(within(table).getByRole("img", { name: m.tonight_spark_peak({ altitude: "71", time: siteTime("2026-10-29T22:00:00.000Z", "Europe/Amsterdam") }) })).toBeInTheDocument()
      // The darkness line: "Dark" beside the window in the site's zone.
      expect(screen.getByText(siteTimeRange(DARKNESS.startUtc, DARKNESS.endUtc, "Europe/Amsterdam")).closest("[data-dark]")).toHaveTextContent(m.plan_dark())
      expect(screen.getByText(m.tonight_moon())).toBeInTheDocument()
      const query = lib.sent("planning_target_rows")[0]?.args.query
      expect(query).toMatchObject({ show: "my_targets", night: "2026-10-30", siteId: "site-1", sort: { column: "img_time", descending: true }, rigs: { kind: "none" } })
      expect(query).not.toHaveProperty("criteria")
    },
    TEST_MS,
  )

  it(
    "with Suitable filters asks the library for the chosen bands and keeps the order it returns",
    async () => {
      const haOnly = (minutes: number, grade: "good" | "marginal" | "poor") => [{ band: "Ha" as const, grade, clearMinutes: minutes }]
      const lib = host({
        planning_target_rows: () => targetsPage([row(M33, { bands: haOnly(150, "good") }), row(M31, { bands: haOnly(90, "marginal") })]),
      })
      renderAt("/targets?good=Ha")
      const table = await screen.findByRole("table", { name: m.nav_targets() })
      await within(table).findByText("M 33")
      const names = within(table)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent)
      expect(names).toEqual(["M 33", "M 31"])
      expect(lib.sent("planning_target_rows")[0]?.args.query).toMatchObject({ suitableBands: ["Ha"], favourite: null, projectId: null })
    },
    TEST_MS,
  )

  it(
    "without a planning site keeps the rows and says why each planning value is unknown",
    async () => {
      host({
        planning_target_rows: () =>
          targetsPage([row(M31, { maxAltitudeDeg: null, imgTimeMinutes: null, lunarSeparationDeg: null, bands: [], altitudeSamplesDeg: [], recommendation: null, unknownReason: "no_site" })], {
            basis: null,
            moon: null,
            darkness: null,
            planningUnavailable: "no_site",
          }),
      })
      renderAt("/targets")
      expect(await screen.findByText(m.home_no_site_yet())).toBeInTheDocument()
      const table = screen.getByRole("table", { name: m.nav_targets() })
      expect(await within(table).findByText("M 31")).toBeInTheDocument()
      expect(within(table).getAllByText(`${m.status_unknown()} · ${m.targets_reason_no_site()}`).length).toBeGreaterThan(0)
    },
    TEST_MS,
  )

  it(
    "opens a Browse row only when inMyTargets is true, and adds one with a session when false",
    async () => {
      const user = userEvent.setup()
      const lib = host({
        planning_target_rows: () => targetsPage([
          row(M31, { favourite: true, inMyTargets: false, sessions: 1 }),
          row(M33, { favourite: false, inMyTargets: true, sessions: 0 }),
        ]),
        targets_search_result_action: (args) => {
          const result = args.result as { target: typeof M31; inMyTargets: boolean }
          return { action: result.inMyTargets ? "open" : "added", target: { candidate: result.target, decisionRevision: 1 } }
        },
      })
      const { history } = renderAt("/targets?mode=browse&cat=messier")
      const table = await screen.findByRole("table", { name: m.nav_targets() })
      await user.click(await within(table).findByText("M 31"))
      await waitFor(() => expect(lib.sent("targets_search_result_action")).toHaveLength(1))
      expect(lib.sent("targets_search_result_action")[0]?.args.result).toMatchObject({ target: { id: "t-m31" }, inMyTargets: false })
      expect(history.location.pathname).toBe("/targets")

      await user.click(within(table).getByText("M 33"))
      await waitFor(() => expect(history.location.pathname).toBe("/targets/t-m33"))
      expect(lib.sent("targets_search_result_action")).toHaveLength(1)
    },
    TEST_MS,
  )

  it(
    "adds a catalogue result as a favourite with the search still open, and opens a result already in My targets",
    async () => {
      const user = userEvent.setup()
      const lib = host({
        planning_target_rows: () => targetsPage([row(M31)]),
        targets_search: () => ({
          results: [
            { target: M33, source: "catalogue", inMyTargets: false, matchedAlias: null },
            { target: M31, source: "my_targets", inMyTargets: true, matchedAlias: null },
          ],
          simbad: { state: "searched" },
        }),
        targets_search_result_action: (args) => {
          const result = args.result as { target: typeof M31; inMyTargets: boolean }
          return { action: result.inMyTargets ? "open" : "added", target: { candidate: result.target, decisionRevision: 1 } }
        },
      })
      const { history } = renderAt("/targets")
      await user.type(await screen.findByRole("searchbox", { name: m.targets_search_label() }), "m 3")
      const results = await screen.findByRole("table", { name: m.targets_caption_search({ query: "m 3" }) })
      await user.click(await within(results).findByText("M 33"))
      await waitFor(() => expect(lib.sent("targets_search_result_action")).toHaveLength(1))
      expect(lib.sent("targets_search_result_action")[0]?.args.result).toMatchObject({ source: "catalogue", target: { id: "t-m33" } })
      // The search stays open after an add: same field, same results.
      expect(screen.getByRole("searchbox", { name: m.targets_search_label() })).toHaveValue("m 3")
      expect(screen.getByRole("table", { name: m.targets_caption_search({ query: "m 3" }) })).toBeInTheDocument()
      expect(history.location.pathname).toBe("/targets")
      await user.click(within(results).getByText("M 31"))
      await waitFor(() => expect(history.location.pathname).toBe("/targets/t-m31"))
    },
    TEST_MS,
  )

  it(
    "says when SIMBAD wasn't searched, and keeps a failed add visible with Retry",
    async () => {
      const user = userEvent.setup()
      let attempts = 0
      host({
        targets_search: () => ({ results: [{ target: M33, source: "catalogue", inMyTargets: false, matchedAlias: null }], simbad: { state: "not_searched", reason: "offline" } }),
        targets_search_result_action: () => {
          attempts += 1
          if (attempts === 1) refuse("provider_unavailable")
          return { action: "added", target: { candidate: M33, decisionRevision: 1 } }
        },
      })
      renderAt("/targets?q=m%2033")
      expect(await screen.findByText(m.targets_simbad_not_searched())).toBeInTheDocument()
      const results = await screen.findByRole("table", { name: m.targets_caption_search({ query: "m 33" }) })
      await user.click(await within(results).findByText("M 33"))
      expect(await screen.findByText(m.targets_add_failed({ name: "M 33" }))).toBeInTheDocument()
      expect(screen.getByText(m.action_failure_provider_unavailable())).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: m.verb_retry() }))
      await waitFor(() => expect(attempts).toBe(2))
      await waitFor(() => expect(screen.queryByText(m.targets_add_failed({ name: "M 33" }))).toBeNull())
    },
    TEST_MS,
  )

  it(
    "shows the Planned view as not available yet and asks the library for no plan",
    async () => {
      const lib = host({ planning_target_rows: () => targetsPage([row(M31)]) })
      renderAt("/targets?view=planned")
      expect(await screen.findByText(m.home_unavailable({ what: m.targets_view_planned() }))).toBeInTheDocument()
      expect(lib.sent("planning_set_planned")).toEqual([])
      expect(lib.sent("planning_target_rows")).toEqual([])
    },
    TEST_MS,
  )

  it(
    "shows a result row with no Add button, and a star on a favourite result",
    async () => {
      host({
        targets_search: () => ({
          results: [
            { target: M33, source: "catalogue", favourite: false, inMyTargets: false, matchedAlias: null },
            { target: M31, source: "my_targets", favourite: true, inMyTargets: true, matchedAlias: null },
          ],
          simbad: { state: "searched" },
        }),
      })
      renderAt("/targets?q=m%2033")
      const results = await screen.findByRole("table", { name: m.targets_caption_search({ query: "m 33" }) })
      expect(await within(results).findByText("M 33")).toBeInTheDocument()
      expect(within(results).queryByRole("button", { name: m.verb_add() })).toBeNull()
      expect(within(results).queryByRole("button", { name: m.targets_favourite_add() })).toBeNull()
      expect(within(results).getAllByRole("img", { name: m.targets_favourite() })).toHaveLength(1)
    },
    TEST_MS,
  )

  it(
    "Clear empties every filter in one URL change",
    async () => {
      const user = userEvent.setup()
      host({ planning_target_rows: () => targetsPage([row(M31)]) })
      const { history } = renderAt("/targets?fav=yes&good=Ha")
      await screen.findByRole("table", { name: m.nav_targets() })
      await user.click(await screen.findByRole("button", { name: m.filters_clear() }))
      await waitFor(() => expect(history.location.search).not.toContain("fav"))
      expect(history.location.search).not.toContain("good")
    },
    TEST_MS,
  )

  it(
    "filters a list longer than one page in the library, so Favourite stays available",
    async () => {
      const lib = host({ planning_target_rows: () => targetsPage([row(M33, { favourite: false })], { total: 1500 }) })
      renderAt("/targets?fav=no")
      const table = await screen.findByRole("table", { name: m.nav_targets() })
      expect(await within(table).findByText("M 33")).toBeInTheDocument()
      expect(lib.sent("planning_target_rows")[0]?.args.query).toMatchObject({ favourite: false })
      const facet = screen.getByRole("button", { name: m.filter_bar_facet_value({ label: m.targets_favourite(), value: m.targets_favourite_no() }) })
      expect(facet).not.toHaveAttribute("aria-disabled", "true")
    },
    TEST_MS,
  )

  it(
    "plans for this Project's rigs, then one chosen rig, and Clear Project keeps the chosen rig",
    async () => {
      const user = userEvent.setup()
      const lib = host({
        planning_target_rows: () => targetsPage([row(M31, { projects: [{ projectId: "p1", name: "Andromeda" }] })]),
        library_list_equipment: () => [{ id: "rig-1", name: "Astro-T7", camera: null, telescope: null, focalLengthMm: null, pixelSizeUm: null, sensorWidthPx: null, sensorHeightPx: null, colorKind: "mono", decisionRevision: 1, state: "confirmed", provenance: { source: "user" } }],
      })
      const { history } = renderAt("/targets?project=p1&rig=project")
      await screen.findByRole("table", { name: m.nav_targets() })
      expect(lib.sent("planning_target_rows")[0]?.args.query).toMatchObject({ rigs: { kind: "project", projectId: "p1" } })
      expect(lib.sent("targets_presets_list")[0]?.args.rigs).toEqual({ kind: "project", projectId: "p1" })
      await user.click(screen.getByRole("button", { name: m.filter_bar_facet_value({ label: m.targets_rig(), value: m.targets_project_rigs_plain() }) }))
      await user.click(await screen.findByRole("menuitemradio", { name: "Astro-T7" }))
      await waitFor(() => expect(lib.sent("planning_target_rows").some((c) => (c.args.query as { rigs: unknown }).rigs && JSON.stringify((c.args.query as { rigs: unknown }).rigs) === JSON.stringify({ kind: "rig", equipmentId: "rig-1" }))).toBe(true))
      await user.click(screen.getByRole("button", { name: m.targets_clear_project() }))
      await waitFor(() => expect(history.location.search).not.toContain("project"))
      expect(history.location.search).toContain("rig=rig-1")
    },
    TEST_MS,
  )

  it(
    "saves the current filters as a preset and checks it",
    async () => {
      const user = userEvent.setup()
      const lib = host({
        planning_target_rows: () => targetsPage([row(M31)]),
        targets_preset_save: (args) => ({ id: "p9", name: args.name, filters: args.filters, revision: 1 }),
      })
      const { history } = renderAt("/targets?mode=browse&cat=messier")
      await screen.findByRole("table", { name: m.nav_targets() })
      await user.click(screen.getByRole("button", { name: m.filter_bar_presets() }))
      await user.click(await screen.findByRole("menuitem", { name: m.filter_bar_preset_save_ellipsis() }))
      await user.type(await screen.findByRole("textbox", { name: m.filter_bar_preset_name() }), "Messier tonight")
      await user.click(screen.getByRole("button", { name: m.filter_bar_preset_create() }))
      await waitFor(() => expect(lib.sent("targets_preset_save")).toHaveLength(1))
      expect(lib.sent("targets_preset_save")[0]?.args).toEqual({ name: "Messier tonight", filters: { show: "browse", catalogues: ["messier"], preset: null, favourite: null, suitableBands: [], rigId: null } })
      await waitFor(() => expect(history.location.search).toContain("saved=p9"))
    },
    TEST_MS,
  )

  it(
    "renames a saved preset at its revision, and a stale revision reads the presets again",
    async () => {
      const user = userEvent.setup()
      let renames = 0
      const lib = host({
        planning_target_rows: () => targetsPage([row(M31)]),
        targets_presets_list: () => ({ builtin: [], saved: [{ id: "p1", name: "Galaxies", filters: {}, revision: 2 }] }),
        targets_preset_rename: (args) => {
          renames += 1
          if (renames === 1) refuse("conflict", "review")
          return { id: "p1", name: args.name, filters: {}, revision: 3 }
        },
      })
      renderAt("/targets?saved=p1")
      await user.click(await screen.findByRole("button", { name: `${m.targets_rename_preset()}…` }))
      const dialog = await screen.findByRole("dialog")
      const name = within(dialog).getByRole("textbox", { name: m.filter_bar_preset_name() })
      await user.clear(name)
      await user.type(name, "Spring galaxies")
      await user.click(within(dialog).getByRole("button", { name: m.equipment_rename() }))
      expect(await within(dialog).findByText(m.action_failure_conflict())).toBeInTheDocument()
      expect(lib.sent("targets_preset_rename")[0]?.args).toEqual({ preset: { kind: "saved", id: "p1" }, name: "Spring galaxies", expectedRevision: 2 })
      await waitFor(() => expect(lib.sent("targets_presets_list").length).toBeGreaterThan(1))
      // After a failure the dialog's action reads Retry.
      await user.click(within(dialog).getByRole("button", { name: m.verb_retry() }))
      await waitFor(() => expect(renames).toBe(2))
    },
    TEST_MS,
  )

  it(
    "deletes a saved preset at its revision; a refused delete stays visible with Dismiss",
    async () => {
      const user = userEvent.setup()
      const lib = host({
        planning_target_rows: () => targetsPage([row(M31)]),
        targets_presets_list: () => ({ builtin: [], saved: [{ id: "p1", name: "Galaxies", filters: {}, revision: 2 }] }),
        targets_preset_delete: () => refuse("conflict", "review"),
      })
      renderAt("/targets")
      await screen.findByRole("table", { name: m.nav_targets() })
      await user.click(screen.getByRole("button", { name: m.filter_bar_presets() }))
      await user.click(await screen.findByRole("menuitem", { name: m.filter_bar_preset_delete() }))
      // The submenu item is pressed while the submenu still animates open, so it is clicked directly.
      fireEvent.click(await screen.findByRole("menuitem", { name: "Galaxies" }))
      const confirm = await screen.findByRole("alertdialog", { name: m.filter_bar_preset_delete_title({ name: "Galaxies" }) })
      await user.click(within(confirm).getByRole("button", { name: m.filter_bar_preset_delete() }))
      expect(await screen.findByText(m.targets_preset_failed())).toBeInTheDocument()
      expect(lib.sent("targets_preset_delete")[0]?.args).toEqual({ preset: { kind: "saved", id: "p1" }, expectedRevision: 2 })
      expect(screen.getByText(m.action_failure_conflict())).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: m.verb_dismiss() }))
      await waitFor(() => expect(screen.queryByText(m.targets_preset_failed())).toBeNull())
    },
    TEST_MS,
  )

  it(
    "saves Moon limits over the settings revision, and a stale revision keeps the dialog and reads them again",
    async () => {
      const user = userEvent.setup()
      const curve = { distanceDeg: 120, widthDays: 7 }
      const record = { settings: { framing: {}, flats: {}, darkBias: {}, keywords: {}, viewMode: "symlinks", calibration: {}, moonAvoidance: { L: curve, R: curve, G: curve, B: curve, Ha: curve, SII: curve, OIII: curve } }, revision: 7 }
      let saves = 0
      const lib = host({
        planning_target_rows: () => targetsPage([row(M31)]),
        workflow_settings_get: () => record,
        workflow_settings_save: (args) => {
          saves += 1
          if (saves === 1) refuse("conflict", "review")
          return { settings: args.settings, revision: 8 }
        },
      })
      renderAt("/targets")
      await user.click(await screen.findByRole("button", { name: `${m.tonight_moon_limits()}…` }))
      const dialog = await screen.findByRole("dialog")
      const separation = within(dialog).getByRole("spinbutton", { name: m.fields_label_unit({ label: m.tonight_curve_separation(), unit: m.criteria_unit_degrees() }) })
      await user.clear(separation)
      await user.type(separation, "90")
      await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
      expect(await within(dialog).findByText(m.action_failure_conflict())).toBeInTheDocument()
      const sent = lib.sent("workflow_settings_save")[0]?.args as { settings: { moonAvoidance: { L: unknown } }; expectedRevision: number }
      expect(sent.expectedRevision).toBe(7)
      expect(sent.settings.moonAvoidance.L).toEqual({ distanceDeg: 90, widthDays: 7 })
      await waitFor(() => expect(lib.sent("workflow_settings_get").length).toBeGreaterThan(1))
      await user.click(within(dialog).getByRole("button", { name: m.verb_retry() }))
      await waitFor(() => expect(saves).toBe(2))
    },
    TEST_MS,
  )
})
