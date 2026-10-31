/**
 * A Target page over a mocked library host: the library's windows and why
 * a night has none, the Favourite toggle, the reviewed notification opt-in
 * with its real denial, Settings and Retry, a stale revision, and the
 * reviewed calendar export.
 */
import { type AnyRoute, createMemoryHistory, createRoute } from "@tanstack/react-router"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { ObservingWindow_Serialize, ReminderSubscription } from "@/api/ipc"
import { createQueryClient } from "@/api/query"
import { setLocale } from "@/app/preferences"
import { AppRoot } from "@/app/root"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { createShellRouter } from "@/routes"
import { BASIS, CRITERIA, candidate, host as answers, NIGHT, refuse, row, SITE, targetDetail } from "./__fixtures__/targets-host"
import { TargetPage } from "./target"
import { TargetsPage } from "./targets"

const TEST_MS = 30_000

/** Serve the Targets host over the mocked IPC. */
function host(...args: Parameters<typeof answers>) {
  const lib = answers(...args)
  mockIPC(lib.handler)
  return lib
}
const M31 = candidate("t-m31", "M 31")
const WINDOW: ObservingWindow_Serialize = {
  key: "w-1",
  startUtc: "2026-10-30T19:40:00Z",
  endUtc: "2026-10-31T00:30:00Z",
  startLocal: "2026-10-30T20:40:00+01:00",
  endLocal: "2026-10-31T01:30:00+01:00",
  timeZone: "Europe/Amsterdam",
  durationMinutes: 290,
  night: "2026-10-30",
  siteName: "Backyard",
  peakAltitudeDeg: 71.4,
}
const WINDOWS = {
  basis: { targetId: "t-m31", targetRevision: 1, designation: "M 31", site: SITE, timeZone: "Europe/Amsterdam", criteria: CRITERIA, method: "skymath" },
  nights: [
    { night: NIGHT, windows: [], noWindowReason: "never_dark" },
    { night: "2026-10-30", windows: [WINDOW], noWindowReason: null },
  ],
  unavailableReason: null,
}

function subscription(over: Partial<ReminderSubscription> = {}): ReminderSubscription {
  return {
    targetId: "t-m31",
    siteId: SITE.id,
    siteName: SITE.name,
    siteRevision: 2,
    settingsRevision: 5,
    criteria: CRITERIA,
    leadMinutes: 720,
    state: "enabled",
    blockReason: null,
    actions: [],
    revision: 4,
    activatedAt: "2026-10-28T10:00:00Z",
    updatedAt: "2026-10-28T10:00:00Z",
    ...over,
  }
}

const status = (subs: ReminderSubscription[]) => ({
  schedulerRunning: true,
  permission: { state: "denied" },
  appClosedDelivery: { available: false, reason: "no_installed_scheduler" },
  subscriptions: subs,
  upcoming: [],
  deliveries: [],
})

const detail = () => targetDetail(row(M31))

function renderTarget(path = "/targets/t-m31") {
  const history = createMemoryHistory({ initialEntries: [path] })
  const pages = (appWindow: AnyRoute): AnyRoute[] => [
    createRoute({ getParentRoute: () => appWindow, path: "/targets", component: TargetsPage }),
    createRoute({ getParentRoute: () => appWindow, path: "/targets/$targetId", component: TargetPage }),
  ]
  render(<AppRoot router={createShellRouter(history, pages)} client={createQueryClient()} />)
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

describe("Target page", () => {
  it.each(["en-GB", "pt-BR"] as const)(
    "shows each night's windows and why a night has none, at the site and zone the library planned for, in %s",
    async (locale) => {
      setLocale(locale)
      const lib = host({ targets_get: detail, planning_compute_windows: () => WINDOWS })
      renderTarget()
      expect(await screen.findByText(m.targets_no_window_never_dark())).toBeInTheDocument()
      expect(await screen.findByText(/Backyard$/)).toBeInTheDocument()
      expect(screen.getByText(`${SITE.name} · ${BASIS.timeZone}`)).toBeInTheDocument()
      expect(lib.sent("planning_compute_windows")[0]?.args.query).toEqual({ targetId: "t-m31", siteId: SITE.id, firstNight: NIGHT, nights: 7, criteria: CRITERIA })
    },
    TEST_MS,
  )

  it(
    "says the windows are unknown when the Target has no catalogued coordinates",
    async () => {
      host({ targets_get: detail, planning_compute_windows: () => ({ ...WINDOWS, nights: [], unavailableReason: "target_coordinates_unknown" }) })
      renderTarget()
      expect(await screen.findByText(`${m.status_unknown()} · ${m.tonight_no_coordinates()}`)).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "turns Favourite off from the toggle beside the title",
    async () => {
      const user = userEvent.setup()
      const lib = host({ targets_get: detail, targets_set_favourite: () => false })
      renderTarget()
      const toggle = await screen.findByRole("button", { name: m.targets_favourite(), pressed: true })
      await user.click(toggle)
      await waitFor(() => expect(lib.sent("targets_set_favourite")[0]?.args).toEqual({ targetId: "t-m31", favourite: false }))
    },
    TEST_MS,
  )

  it(
    "enables notifications only after the library's review, sending the reviewed site and revisions",
    async () => {
      const user = userEvent.setup()
      const lib = host({
        targets_get: detail,
        planning_review_reminders: (args) => ({
          targetId: "t-m31",
          designation: "M 31",
          site: SITE,
          timeZone: "Europe/Amsterdam",
          settingsRevision: 5,
          criteria: CRITERIA,
          leadMinutes: (args.reminder as { leadMinutes: number }).leadMinutes,
          permission: { state: "not_determined" },
          appClosedDelivery: { available: false, reason: "no_installed_scheduler" },
          subscriptionRevision: null,
          upcoming: [],
        }),
        planning_enable_reminders: () => subscription(),
      })
      renderTarget()
      await user.click(await screen.findByRole("button", { name: `${m.targets_enable_notifications()}…` }))
      const dialog = await screen.findByRole("dialog")
      expect(await within(dialog).findByText(m.targets_permission_ask())).toBeInTheDocument()
      expect(within(dialog).getByText(m.plan_reminders_while_open())).toBeInTheDocument()
      await user.click(within(dialog).getByRole("button", { name: m.targets_enable_notifications() }))
      await waitFor(() => expect(lib.sent("planning_enable_reminders")).toHaveLength(1))
      expect(lib.sent("planning_enable_reminders")[0]?.args).toEqual({
        reminder: { targetId: "t-m31", criteria: CRITERIA, leadMinutes: 720 },
        siteId: SITE.id,
        siteRevision: 2,
        settingsRevision: 5,
        expectedRevision: null,
      })
    },
    TEST_MS,
  )

  it.each(["en-GB", "pt-BR"] as const)(
    "starts the lead time from the stored default and takes up to 7 days, refusing longer, in %s",
    async (locale) => {
      setLocale(locale)
      const user = userEvent.setup()
      const lib = host({
        targets_get: detail,
        planning_reminder_lead_time: () => ({ leadMinutes: 2880, revision: 1 }),
        planning_review_reminders: (args) => ({
          targetId: "t-m31",
          designation: "M 31",
          site: SITE,
          timeZone: "Europe/Amsterdam",
          settingsRevision: 5,
          criteria: CRITERIA,
          leadMinutes: (args.reminder as { leadMinutes: number }).leadMinutes,
          permission: { state: "granted" },
          appClosedDelivery: { available: false, reason: "no_installed_scheduler" },
          subscriptionRevision: null,
          upcoming: [],
        }),
        planning_enable_reminders: () => subscription(),
      })
      renderTarget()
      await user.click(await screen.findByRole("button", { name: `${m.targets_enable_notifications()}…` }))
      const dialog = await screen.findByRole("dialog")
      const amount = await within(dialog).findByRole("spinbutton", { name: m.plan_lead_amount() })
      // 2880 minutes stored: the form opens on 2 days.
      await waitFor(() => expect(amount).toHaveValue(2))
      await user.clear(amount)
      await user.type(amount, "8")
      expect(await within(dialog).findByText(m.plan_reason_lead_out_of_range())).toBeInTheDocument()
      await user.clear(amount)
      await user.type(amount, "7")
      expect(await within(dialog).findByText(m.plan_lead_days({ count: 7 }))).toBeInTheDocument()
      await user.click(within(dialog).getByRole("button", { name: m.targets_enable_notifications() }))
      await waitFor(() => expect(lib.sent("planning_enable_reminders")).toHaveLength(1))
      expect(lib.sent("planning_enable_reminders")[0]?.args.reminder).toEqual({ targetId: "t-m31", criteria: CRITERIA, leadMinutes: 10_080 })
    },
    TEST_MS,
  )

  it(
    "keeps a denial visible with Settings and Retry; Retry repeats the confirmed values",
    async () => {
      const user = userEvent.setup()
      const blocked = subscription({ state: "blocked", blockReason: "permission_denied", actions: ["settings", "retry"] })
      const lib = host({
        targets_get: detail,
        planning_reminder_status: () => status([blocked]),
        planning_enable_reminders: () => blocked,
        planning_open_notification_settings: () => ({ opened: false, reason: null }),
      })
      renderTarget()
      expect(await screen.findByText(m.targets_notifications_blocked({ reason: m.plan_reason_notifications_denied() }))).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: m.targets_notification_settings() }))
      expect(await screen.findByText(m.targets_settings_not_opened())).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: m.verb_retry() }))
      await waitFor(() => expect(lib.sent("planning_enable_reminders")).toHaveLength(1))
      expect(lib.sent("planning_enable_reminders")[0]?.args).toEqual({ reminder: { targetId: "t-m31", criteria: CRITERIA, leadMinutes: 720 }, siteId: SITE.id, siteRevision: 2, settingsRevision: 5, expectedRevision: 4 })
    },
    TEST_MS,
  )

  it(
    "refuses a stale subscription revision and reads the reminders again",
    async () => {
      const user = userEvent.setup()
      const lib = host({
        targets_get: detail,
        planning_reminder_status: () => status([subscription()]),
        planning_disable_reminders: () => refuse("conflict", "review"),
      })
      renderTarget()
      await user.click(await screen.findByRole("button", { name: m.targets_disable_notifications() }))
      expect(await screen.findByText(m.action_failure_conflict())).toBeInTheDocument()
      expect(lib.sent("planning_disable_reminders")[0]?.args).toEqual({ targetId: "t-m31", expectedRevision: 4 })
      await waitFor(() => expect(lib.sent("planning_reminder_status").length).toBeGreaterThan(1))
    },
    TEST_MS,
  )

  it(
    "exports the reviewed calendar with its digest",
    async () => {
      const user = userEvent.setup()
      const lib = host({
        targets_get: detail,
        planning_compute_windows: () => WINDOWS,
        planning_review_calendar_export: () => ({
          snapshotDigest: "digest-a",
          suggestedFileName: "M31-Backyard.ics",
          targetId: "t-m31",
          targetRevision: 1,
          designation: "M 31",
          site: SITE,
          timeZone: "Europe/Amsterdam",
          firstNight: NIGHT,
          lastNight: "2026-11-04",
          criteria: CRITERIA,
          windows: [WINDOW],
        }),
        planning_export_calendar: () => ({ saved: true, path: { encoding: "unix-bytes", payload: [], display: "/Users/me/M31-Backyard.ics" }, byteCount: 900, sha256: "ab", windowCount: 1 }),
      })
      renderTarget()
      const trigger = await screen.findByRole("button", { name: `${m.plan_export_calendar()}…` })
      await waitFor(() => expect(trigger).not.toHaveAttribute("aria-disabled", "true"))
      await user.click(trigger)
      const dialog = await screen.findByRole("dialog")
      expect(await within(dialog).findByText("M31-Backyard.ics")).toBeInTheDocument()
      await user.click(within(dialog).getByRole("button", { name: m.plan_export_calendar() }))
      await waitFor(() => expect(lib.sent("planning_export_calendar")).toHaveLength(1))
      expect(lib.sent("planning_export_calendar")[0]?.args).toEqual({ selection: { query: WINDOWS.basis && { targetId: "t-m31", siteId: SITE.id, firstNight: NIGHT, nights: 7, criteria: CRITERIA }, windowKeys: ["w-1"] }, snapshotDigest: "digest-a" })
    },
    TEST_MS,
  )

  it(
    "reads its Target under the list's site, night and rig, and keeps it on screen out of My targets after Favourite goes off",
    async () => {
      const user = userEvent.setup()
      let favourite = true
      const lib = host({
        targets_get: () => targetDetail(row(M31, { sessions: 0, projects: [], favourite, inMyTargets: favourite })),
        targets_set_favourite: (args) => {
          favourite = args.favourite as boolean
          return favourite
        },
      })
      renderTarget("/targets/t-m31?site=site-1&night=2026-10-29&rig=r1&fav=yes")
      await user.click(await screen.findByRole("button", { name: m.targets_favourite(), pressed: true }))
      expect(lib.sent("targets_get")[0]?.args).toEqual({ targetId: "t-m31", context: { siteId: "site-1", night: "2026-10-29", rigs: { kind: "rig", equipmentId: "r1" } } })
      await waitFor(() => expect(lib.sent("targets_get").length).toBeGreaterThan(1))
      expect(await screen.findByRole("button", { name: m.targets_favourite(), pressed: false })).toBeInTheDocument()
      expect(screen.getByRole("heading", { name: "M 31" })).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "says a Target the library doesn't hold isn't in the library, with the way back to Targets",
    async () => {
      host({
        targets_get: () => {
          throw { code: "not_found", identity: "t-m31", scope: null, retry: "none", currentRevision: null, successors: [], window: null, correction: null }
        },
      })
      renderTarget()
      expect(await screen.findAllByText(m.targets_not_in_library())).not.toHaveLength(0)
      expect(screen.getByRole("button", { name: m.nav_targets() })).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "shows Retry when a context entity, not the Target, is missing",
    async () => {
      host({
        targets_get: () => {
          throw { code: "not_found", identity: "missing-rig", scope: null, retry: "none", currentRevision: null, successors: [], window: null, correction: null }
        },
      })
      renderTarget()
      expect(await screen.findByText(m.action_failure_not_found())).toBeInTheDocument()
      expect(screen.getByRole("button", { name: m.verb_retry() })).toBeInTheDocument()
      expect(screen.queryByText(m.targets_not_in_library())).toBeNull()
    },
    TEST_MS,
  )

  it(
    "offers Retry when the Target can't be read, and when the goal gaps can't",
    async () => {
      const user = userEvent.setup()
      let reads = 0
      host({
        targets_get: () => {
          reads += 1
          if (reads === 1) refuse("persistence_failure")
          return detail()
        },
        planning_target_gaps: () => refuse("persistence_failure"),
      })
      renderTarget()
      expect(await screen.findByText(m.action_failure_persistence_failure())).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: m.verb_retry() }))
      expect(await screen.findByRole("heading", { name: "M 31" })).toBeInTheDocument()
      // The Target came back; the goal gaps did not, and say so with their own Retry.
      expect(await screen.findByText(m.action_failure_persistence_failure())).toBeInTheDocument()
      expect(screen.getByRole("button", { name: m.verb_retry() })).toBeInTheDocument()
    },
    TEST_MS,
  )

  it(
    "after a stale review the dialog stays, the review is read again, and Enable sends the new revisions",
    async () => {
      const user = userEvent.setup()
      let reviews = 0
      let enables = 0
      const lib = host({
        targets_get: detail,
        planning_review_reminders: (args) => {
          reviews += 1
          return {
            targetId: "t-m31",
            designation: "M 31",
            site: { ...SITE, revision: reviews === 1 ? 2 : 3 },
            timeZone: "Europe/Amsterdam",
            settingsRevision: reviews === 1 ? 5 : 6,
            criteria: CRITERIA,
            leadMinutes: (args.reminder as { leadMinutes: number }).leadMinutes,
            permission: { state: "granted" },
            appClosedDelivery: { available: false, reason: "no_installed_scheduler" },
            subscriptionRevision: null,
            upcoming: [],
          }
        },
        planning_enable_reminders: () => {
          enables += 1
          if (enables === 1) refuse("conflict", "review")
          return subscription()
        },
      })
      renderTarget()
      await user.click(await screen.findByRole("button", { name: `${m.targets_enable_notifications()}…` }))
      const dialog = await screen.findByRole("dialog")
      await within(dialog).findByText(m.targets_permission_granted())
      await user.click(within(dialog).getByRole("button", { name: m.targets_enable_notifications() }))
      expect(await within(dialog).findByText(m.action_failure_conflict())).toBeInTheDocument()
      await waitFor(() => expect(reviews).toBe(2))
      await act(async () => {})
      await user.click(within(dialog).getByRole("button", { name: m.verb_retry() }))
      await waitFor(() => expect(enables).toBe(2))
      expect(lib.sent("planning_enable_reminders")[1]?.args).toMatchObject({ siteRevision: 3, settingsRevision: 6 })
    },
    TEST_MS,
  )

  it(
    "after a stale export digest the dialog stays, the export is reviewed again, and Export sends the new digest",
    async () => {
      const user = userEvent.setup()
      let reviews = 0
      let exports = 0
      const lib = host({
        targets_get: detail,
        planning_compute_windows: () => WINDOWS,
        planning_review_calendar_export: () => {
          reviews += 1
          return { snapshotDigest: reviews === 1 ? "digest-a" : "digest-b", suggestedFileName: "M31.ics", targetId: "t-m31", targetRevision: 1, designation: "M 31", site: SITE, timeZone: "Europe/Amsterdam", firstNight: NIGHT, lastNight: NIGHT, criteria: CRITERIA, windows: [WINDOW] }
        },
        planning_export_calendar: () => {
          exports += 1
          if (exports === 1) refuse("conflict", "review")
          return null
        },
      })
      renderTarget()
      const trigger = await screen.findByRole("button", { name: `${m.plan_export_calendar()}…` })
      await waitFor(() => expect(trigger).not.toHaveAttribute("aria-disabled", "true"))
      await user.click(trigger)
      const dialog = await screen.findByRole("dialog")
      await within(dialog).findByText("M31.ics")
      await user.click(within(dialog).getByRole("button", { name: m.plan_export_calendar() }))
      expect(await within(dialog).findByText(m.action_failure_conflict())).toBeInTheDocument()
      await waitFor(() => expect(reviews).toBe(2))
      await act(async () => {})
      await user.click(within(dialog).getByRole("button", { name: m.verb_retry() }))
      await waitFor(() => expect(exports).toBe(2))
      expect(lib.sent("planning_export_calendar")[1]?.args.snapshotDigest).toBe("digest-b")
    },
    TEST_MS,
  )
})
