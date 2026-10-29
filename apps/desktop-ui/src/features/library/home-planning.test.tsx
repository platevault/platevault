/**
 * Home's Tonight goal grades and calendar against the library IPC as the
 * webview sees it: `home_dashboard` and `planning_calendar` answer from a
 * mocked host, so these cover what Home draws from the library's replies
 * (PLAN-FR-11, PLAN-FR-12), never a grade or a night Home computes.
 */
import { QueryClientProvider } from "@tanstack/react-query"
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type {
  CalendarNight_Serialize,
  GoalGrade_Serialize,
  HomeDashboard_Serialize,
  NextGoodNight_Serialize,
  ObservingWindow_Serialize,
  PlanCriteria,
  PlanningCalendar_Serialize,
  Tonight_Serialize,
} from "@/api/ipc"
import { createQueryClient } from "@/api/query"
import { setLocale } from "@/app/preferences"
import { gradeStripLabel } from "@/components/domain/grade-badges"
import { siteTime, siteTimeRange } from "@/components/domain/sky-lines"
import { formatCount, formatHours, formatList, formatNight } from "@/lib/format"
import { type Locale, LOCALES, m } from "@/lib/i18n"
import { HomePage } from "./home-page"

const ZONE = "Europe/Amsterdam"
/** A Thursday. */
const TONIGHT = "2026-10-29"
/** Nights from Thursday to the end of the fifth week: the week starts Monday in en-GB (3 nights gone), Sunday in pt-BR (4 gone). */
const NIGHTS_FROM_THURSDAY: Record<Locale, number> = { "en-GB": 32, "pt-BR": 31 }
/** The library's refusal when a read fails. */
const PERSISTENCE = { code: "persistence_failure", identity: null, scope: null, retry: "retry", currentRevision: null, successors: [], window: null, correction: null }
const SITE = { id: "site-1", name: "Backyard", revision: 1, latitudeDeg: 52.09, longitudeDeg: 5.12, elevationM: null }
const CRITERIA: PlanCriteria = { minAltitudeDeg: 30, darkness: "astronomical", moon: { kind: "none" }, minDurationMinutes: 30 }

const WINDOW: ObservingWindow_Serialize = {
  key: "t-ngc7000/site-1/2026-10-29T18:30Z",
  startUtc: "2026-10-29T18:30:00Z",
  endUtc: "2026-10-29T23:10:00Z",
  startLocal: "2026-10-29T19:30:00+01:00",
  endLocal: "2026-10-30T00:10:00+01:00",
  timeZone: ZONE,
  durationMinutes: 280,
  night: TONIGHT,
  siteName: "Backyard",
  peakAltitudeDeg: 81.4,
}

function goal(over: Partial<GoalGrade_Serialize>): GoalGrade_Serialize {
  return {
    projectId: "p-1",
    projectName: "Cygnus HOO",
    goalId: "g-1",
    subjectId: "s-1",
    groupId: null,
    targetId: "t-ngc7000",
    designation: "NGC 7000",
    channel: "Ha",
    band: "Ha",
    grade: "good",
    ungraded: null,
    window: WINDOW,
    ...over,
  }
}

const NGC_HA = goal({})
const M31_L = goal({ projectId: "p-2", projectName: "Andromeda", goalId: "g-2", targetId: "t-m31", designation: "M 31", channel: "L", band: "L", grade: "marginal", window: { ...WINDOW, peakAltitudeDeg: null } })
const IC_OIII = goal({ goalId: "g-3", targetId: "t-ic1396", designation: "IC 1396", channel: "OIII", band: "OIII", grade: "poor", window: null })
const NO_BAND = goal({ goalId: "g-4", channel: "Red", band: null, grade: null, ungraded: { kind: "no_band" }, window: null })
const NO_POSITION = goal({ goalId: "g-5", targetId: "t-x", designation: "Comet X", channel: null, band: null, grade: null, ungraded: { kind: "no_position", reason: "target_coordinates_unknown" }, window: null })
const ODD_FRAME = goal({ goalId: "g-6", targetId: "t-y", designation: "Galactic Y", band: null, grade: null, ungraded: { kind: "no_position", reason: "unsupported_coordinate_frame" }, window: null })

function tonight(over: Partial<Tonight_Serialize> = {}): Tonight_Serialize {
  return {
    site: SITE,
    timeZone: ZONE,
    night: TONIGHT,
    criteria: CRITERIA,
    goals: [NGC_HA],
    nextGoodNight: { state: "tonight" },
    windows: [],
    moon: null,
    darkness: null,
    method: "skymath",
    unavailableReason: null,
    ...over,
  }
}

function dashboard(t: Tonight_Serialize): HomeDashboard_Serialize {
  return {
    topLine: { needsTarget: 0, notInAnyProject: 0, needsCalibration: 0 },
    actions: ["import", "new_project", "plan_tonight"],
    projects: [],
    newSessions: { needsTarget: [], notInProject: [], unreviewed: [], readyToAdd: [] },
    tonight: t,
    targetStatus: [],
    runningWork: [],
  }
}

const MOONRISE = "2026-10-29T13:05:00Z"

/** Tonight: a waxing gibbous Moon, 10 h 35 dark, two goals suited and one the Moon rules out. Tomorrow: never dark, the Moon's fraction unknown. */
const NIGHTS: CalendarNight_Serialize[] = [
  {
    night: TONIGHT,
    moon: { illumination: 0.42, phase: "waxing_gibbous", riseUtc: MOONRISE, setUtc: null },
    darkness: { startUtc: "2026-10-29T17:45:00Z", endUtc: "2026-10-30T04:20:00Z", startLocal: "2026-10-29T18:45:00+01:00", endLocal: "2026-10-30T05:20:00+01:00" },
    darkSeconds: 38_100,
    suitedGoals: [NGC_HA, M31_L],
    moonRuledOutGoals: [IC_OIII],
  },
  {
    night: "2026-10-30",
    moon: { illumination: null, phase: "full", riseUtc: null, setUtc: null },
    darkness: null,
    darkSeconds: 0,
    suitedGoals: [],
    moonRuledOutGoals: [],
  },
]

function calendar(over: Partial<PlanningCalendar_Serialize> = {}): PlanningCalendar_Serialize {
  return { site: SITE, timeZone: ZONE, criteria: CRITERIA, nights: NIGHTS, method: "skymath", unavailableReason: null, ...over }
}

/** Home's other reads: no location, no capture, no issue. */
function quietHome(command: string): unknown {
  if (command === "library_list_locations") return []
  if (command === "library_new_captures") return { locations: [] }
  if (command === "library_list_operations") return []
  if (command === "library_issues") return { issues: [], dismissed: [], counts: { danger: 0, warning: 0, info: 0 }, pages: [] }
  if (command === "library_list_sessions") return []
  return null
}

/** Home over a host answering Tonight with `t` and the calendar with `cal` (a function may throw a refusal); it records each planning_calendar query. */
function renderHome(t: Tonight_Serialize, cal: PlanningCalendar_Serialize | (() => PlanningCalendar_Serialize) = calendar()) {
  const asked: unknown[] = []
  mockIPC((command, args) => {
    if (command === "plugin:event|listen") return (args as { handler: number }).handler
    if (command === "plugin:event|unlisten") return null
    if (command === "home_dashboard") return dashboard(t)
    if (command === "planning_home_criteria") return { criteria: t.criteria, revision: t.criteria ? 1 : 0 }
    if (command === "planning_calendar") {
      asked.push((args as { query: unknown }).query)
      return typeof cal === "function" ? cal() : cal
    }
    return quietHome(command)
  })
  const root = createRootRoute()
  const tree = root.addChildren([createRoute({ getParentRoute: () => root, path: "/", component: HomePage })])
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { asked, user: userEvent.setup() }
}

/** A Home section by its title; the name also carries the section's count. */
const region = (title: string) => screen.findByRole("region", { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })
const row = (r: HTMLElement, text: string) => within(r).getByText(text).closest("tr")!
const goalName = (g: GoalGrade_Serialize) => m.home_goal_item({ subject: g.designation, channel: g.channel ?? m.palette_session_no_filter() })
const night = (date: string) => document.querySelector<HTMLElement>(`[data-night="${date}"]`)!

const original = globalThis.ResizeObserver
beforeAll(() => {
  // The night card's positioner measures its trigger; jsdom has no ResizeObserver.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => {
  globalThis.ResizeObserver = original
})
afterEach(() => {
  cleanup()
  clearMocks()
  act(() => setLocale("en-GB"))
})

describe.each(LOCALES)("Home planning in %s", (locale) => {
  beforeEach(() => {
    act(() => setLocale(locale))
  })

  it("draws the calendar's nights from planning_calendar: the Moon, darkness, and the goals each suits and the Moon rules out", async () => {
    const { asked, user } = renderHome(tonight())
    const cal = await region(m.home_calendar())
    expect(await within(cal).findByRole("grid", { name: m.home_calendar_label({ site: "Backyard" }) })).toBeInTheDocument()
    // Tonight (a Thursday) through the end of the fifth week, from the locale's first day: Monday in en-GB, Sunday in pt-BR.
    expect(asked).toEqual([{ firstNight: TONIGHT, nights: NIGHTS_FROM_THURSDAY[locale] }])
    // Tonight opens Targets as it is (no night); a later night sets it.
    expect(night(TONIGHT)).toHaveAttribute("href", "/targets")
    expect(night("2026-10-30")).toHaveAttribute("href", "/targets?night=2026-10-30")

    const moon = m.calendar_moon({ illumination: 42, phase: m.tonight_moon_phase_waxing_gibbous() })
    const first = night(TONIGHT).getAttribute("aria-label")!
    for (const part of [moon, m.calendar_dark({ time: formatHours(38_100) }), m.calendar_goals_suit({ count: 2, n: formatCount(2) }), m.calendar_plan_unknown()]) expect(first).toContain(part)
    const second = night("2026-10-30").getAttribute("aria-label")!
    for (const part of [m.calendar_moon_phase({ phase: m.tonight_moon_phase_full() }), m.calendar_never_dark(), m.calendar_goals_suit({ count: 0, n: formatCount(0) })]) expect(second).toContain(part)
    // An unknown fraction draws no Moon glyph, so it never reads as a New Moon.
    expect(night("2026-10-30").querySelector("[data-moon-phase]")).toBeNull()

    await user.hover(night(TONIGHT))
    expect(await screen.findByText(formatList([goalName(NGC_HA), goalName(M31_L)]), {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText(goalName(IC_OIII))).toBeInTheDocument()
    expect(screen.getByText(siteTimeRange(NIGHTS[0]!.darkness!.startUtc, NIGHTS[0]!.darkness!.endUtc, ZONE))).toBeInTheDocument()
    expect(screen.getByText([moon, m.tonight_moon_rises({ time: siteTime(MOONRISE, ZONE) }), m.tonight_moon_no_set()].join(" · "))).toBeInTheDocument()
    // The plan is not served yet (astro-plan-wre19.14): unknown in the card and named under the calendar, never 0.
    expect(screen.getByText(m.calendar_plan_unknown())).toBeInTheDocument()
    expect(within(cal).getByText(m.home_planned_unavailable())).toBeInTheDocument()
  })

  it("offers Retry when the calendar can't be read, and draws the nights once it can", async () => {
    let reads = 0
    const { asked, user } = renderHome(tonight(), () => {
      reads += 1
      if (reads === 1) throw PERSISTENCE
      return calendar()
    })
    const cal = await region(m.home_calendar())
    const alert = await within(cal).findByRole("alert")
    expect(within(cal).queryByRole("grid")).toBeNull()
    await user.click(within(alert).getByRole("button", { name: m.verb_retry() }))
    expect(await within(cal).findByRole("grid", { name: m.home_calendar_label({ site: "Backyard" }) })).toBeInTheDocument()
    expect(asked).toHaveLength(2)
  })

  it.each([
    ["no_site", () => m.home_no_site_yet()],
    ["no_criteria", () => m.home_no_criteria_yet()],
  ] as const)("names the calendar's %s without a second set of buttons", async (reason, title) => {
    renderHome(tonight(), calendar({ nights: [], unavailableReason: reason }))
    const cal = await region(m.home_calendar())
    expect(await within(cal).findByText(title())).toBeInTheDocument()
    expect(within(cal).queryByRole("grid")).toBeNull()
    expect(within(cal).queryByRole("button")).toBeNull()
  })

  it("names the calendar's gap from Tonight's when no default site is set, without reading the calendar", async () => {
    const { asked } = renderHome(tonight({ site: null, timeZone: null, night: null, goals: [], nextGoodNight: null, unavailableReason: "no_site" }))
    const cal = await region(m.home_calendar())
    expect(await within(cal).findByText(m.home_no_site_yet())).toBeInTheDocument()
    expect(asked).toEqual([])
    // Tonight holds the one way to add the site; the calendar repeats no button.
    expect(within(await region(m.home_tonight())).getByRole("button", { name: m.tonight_add_site() })).toBeInTheDocument()
    expect(within(cal).queryByRole("button")).toBeNull()
  })

  it("grades each goal with its band and best window, and says why a goal has no grade", async () => {
    renderHome(tonight({ goals: [NGC_HA, M31_L, NO_BAND, NO_POSITION, ODD_FRAME] }))
    const t = await region(m.home_tonight_at({ site: "Backyard" }))
    await within(t).findByText(goalName(NGC_HA))
    const ngc = row(t, goalName(NGC_HA))
    expect(within(ngc).getByRole("img", { name: gradeStripLabel(m, [{ band: "Ha", grade: "good" }]) })).toBeInTheDocument()
    expect(within(ngc).getByText(m.home_window_peak({ range: siteTimeRange(WINDOW.startUtc, WINDOW.endUtc, ZONE), altitude: formatCount(81) }))).toBeInTheDocument()
    const m31 = row(t, goalName(M31_L))
    expect(within(m31).getByRole("img", { name: gradeStripLabel(m, [{ band: "L", grade: "marginal" }]) })).toBeInTheDocument()
    expect(within(m31).getByText(siteTimeRange(WINDOW.startUtc, WINDOW.endUtc, ZONE))).toBeInTheDocument()
    expect(within(row(t, goalName(NO_BAND))).getByText(`${m.home_not_graded()} · ${m.home_ungraded_no_band()}`)).toBeInTheDocument()
    expect(within(row(t, goalName(NO_POSITION))).getByText(`${m.home_not_graded()} · ${m.tonight_no_coordinates()}`)).toBeInTheDocument()
    expect(within(row(t, goalName(ODD_FRAME))).getByText(`${m.home_not_graded()} · ${m.targets_reason_unsupported_frame()}`)).toBeInTheDocument()
  })

  const notes = () => [m.home_no_goals_suit_next({ date: formatNight("2026-11-03") }), m.home_no_goals_suit_within({ count: 30, n: formatCount(30) }), m.home_no_gradable_goal()]

  it.each<[string, NextGoodNight_Serialize, GoalGrade_Serialize[], () => string | null]>([
    ["tonight", { state: "tonight" }, [NGC_HA], () => null],
    ["night", { state: "night", night: "2026-11-03" }, [IC_OIII], () => m.home_no_goals_suit_next({ date: formatNight("2026-11-03") })],
    ["none_within", { state: "none_within", nights: 30 }, [IC_OIII], () => m.home_no_goals_suit_within({ count: 30, n: formatCount(30) })],
    ["no_gradable_goal", { state: "no_gradable_goal" }, [NO_BAND], () => m.home_no_gradable_goal()],
  ])("says when the next good night is: %s", async (_state, next, goals, note) => {
    renderHome(tonight({ goals, nextGoodNight: next }))
    const t = await region(m.home_tonight_at({ site: "Backyard" }))
    await within(t).findByText(goalName(goals[0]!))
    const expected = note()
    for (const text of notes()) {
      if (text === expected) expect(within(t).getByText(text)).toBeInTheDocument()
      else expect(within(t).queryByText(text)).toBeNull()
    }
  })

  it("says there is no unfinished goal when nothing can be graded and no goal is listed", async () => {
    renderHome(tonight({ goals: [], nextGoodNight: { state: "no_gradable_goal" } }))
    const t = await region(m.home_tonight_at({ site: "Backyard" }))
    expect(await within(t).findByText(m.home_no_unfinished_goals())).toBeInTheDocument()
    expect(within(t).queryByText(m.home_no_gradable_goal())).toBeNull()
  })
})
