import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultCriteria, isLeadTime, reminderKey, windowsOnNight } from "@/domain/planning"
import { createSeed } from "@/domain/seed"
import { type ActivityEvent, DEFAULT_REMINDER_LEAD_MIN, type NightDate, type ObservingSite, type Target, type TargetId } from "@/domain/types"
import { m, say } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store, withCatalog } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { checkReminders, enableReminders, LEAD_TIMES_MIN, setReminderLead } from "./planning"

// A controlled clock: Date is faked, and every check reads `nowIso()` from it.
const CLOSED_AT = Date.parse("2026-10-13T12:00:00Z")
const LEAD_MIN = DEFAULT_REMINDER_LEAD_MIN
let demo: PrototypeState
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(CLOSED_AT)
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
afterAll(() => {
  vi.useRealTimers()
})
beforeEach(() => {
  vi.setSystemTime(CLOSED_AT)
  store.replace(structuredClone(demo))
})

const site = (): ObservingSite => store.getState().catalog.sites.site_backyard!
const criteria = () => defaultCriteria(site())
/** The demo Targets with a window on `night` at the Backyard, by name. */
function visibleOn(night: NightDate): Target[] {
  return Object.values(store.getState().catalog.targets)
    .filter((t) => windowsOnNight(t, site(), criteria(), night, CLOSED_AT).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}
/** Plans `nights` per Target and turns reminders on at the Backyard, last checked when PlateVault closed. */
function planAndEnable(nights: Record<TargetId, NightDate[]>) {
  const closed = new Date(CLOSED_AT).toISOString()
  store.setState((s) =>
    withCatalog(s, (c) => ({
      ...c,
      plans: Object.fromEntries(Object.entries(nights).map(([targetId, n]) => [targetId, { targetId, nights: n, criteria: criteria(), updatedAt: closed }])),
      reminders: { ...c.reminders, enabled: true, siteId: "site_backyard", permission: "granted", leadTimeMin: LEAD_MIN, deliveredWindowKeys: [], enabledAt: closed, checkedAt: closed },
    })),
  )
}
const reminderEntries = (): ActivityEvent[] => store.getState().activity.filter((e) => e.kind === "reminder" || e.kind === "reminder-missed")
const windowOf = (t: Target, night: NightDate) => windowsOnNight(t, site(), criteria(), night, CLOSED_AT)[0]!

describe("reminder lead time (D-W88, astro-plan-0drm0.2)", () => {
  it("is 12 hours on a new library, and every preset is over 30 minutes", () => {
    expect(createSeed("empty").catalog.reminders.leadTimeMin).toBe(12 * 60)
    expect(LEAD_TIMES_MIN).toContain(DEFAULT_REMINDER_LEAD_MIN)
    expect(LEAD_TIMES_MIN.every((min) => min > 30 && isLeadTime(min))).toBe(true)
  })

  it("refuses 30 minutes or less, from the store as from the dialog", () => {
    expect(enableReminders(30).ok).toBe(false)
    expect(store.getState().catalog.reminders.enabled).toBe(false)
    expect(enableReminders(31).ok).toBe(true)
    expect(setReminderLead(30).ok).toBe(false)
    expect(store.getState().catalog.reminders.leadTimeMin).toBe(31)
    expect(setReminderLead(LEAD_MIN).ok).toBe(true)
    expect(store.getState().catalog.reminders.leadTimeMin).toBe(LEAD_MIN)
  })
})

describe("start-up and resume reminders (PLAN-AC-15)", () => {
  // Closed on 13 Oct at noon for two nights: A and B were planned on the 13th, C to F on the 15th, A again (G) on the 17th.
  const ENDED = "2026-10-13"
  const OPEN = "2026-10-15"
  const LATER = "2026-10-17"

  function scenario() {
    const targets = visibleOn(OPEN).filter((t) => visibleOn(ENDED).includes(t) && visibleOn(LATER).includes(t))
    expect(targets.length, "the demo seed has six Targets up at the Backyard in mid-October").toBeGreaterThanOrEqual(6)
    const [a, b, c, d, e, f] = targets as [Target, Target, Target, Target, Target, Target]
    const g = a
    planAndEnable({ [a.id]: [ENDED, LATER], [b.id]: [ENDED], [c.id]: [OPEN], [d.id]: [OPEN], [e.id]: [OPEN], [f.id]: [OPEN] })
    const open = [c, d, e, f].map((t) => windowOf(t, OPEN))
    // Start just after the first open window starts: it has started, the others are inside the 12 h lead time.
    const startMs = Math.min(...open.map((w) => Date.parse(w.start))) + 60_000
    expect(open.every((w) => Date.parse(w.end) > startMs)).toBe(true)
    return { a, b, c, d, e, f, g, open, startMs }
  }

  it("records the ended windows in Activity only and gathers the open ones into one notice", () => {
    const { a, b, open, startMs } = scenario()
    vi.setSystemTime(startMs)
    const delivery = checkReminders(true)

    expect(delivery?.check).toBe("startup")
    expect(delivery?.missed.map((w) => w.targetId).sort()).toEqual([a.id, b.id].sort())
    const entries = reminderEntries()
    const missed = entries.filter((e) => e.kind === "reminder-missed")
    expect(missed).toHaveLength(2)
    expect(missed.every((e) => say(m, e.title) === "Missed while PlateVault was closed" && e.reminder?.delivery === "missed")).toBe(true)
    expect(missed.map((e) => e.reminder?.names[0]).sort()).toEqual([a.name, b.name].sort())

    const notices = entries.filter((e) => e.kind === "reminder")
    expect(notices).toHaveLength(1)
    const notice = notices[0]!
    const names = open.map((w) => store.getState().catalog.targets[w.targetId]!.name)
    expect(notice.reminder).toMatchObject({ delivery: "coalesced", names: names.slice(0, 3), more: 1, href: "/targets?view=planned" })
    expect(notice.reminder?.windows.map((w) => w.key)).toEqual(open.map((w) => w.key))
    expect(notice.href).toBe("/targets?view=planned")
    expect(say(m, notice.title)).toBe(`Windows open or coming up: ${names.slice(0, 3).join(", ")} and 1 more`)

    const { reminders } = store.getState().catalog
    expect(reminders.checkedAt).toBe(new Date(startMs).toISOString())
    expect(reminders.deliveredWindowKeys).toHaveLength(6)
  })

  it("names only three Targets without 'more' when three windows are open", () => {
    const { f, startMs } = scenario()
    store.setState((s) => withCatalog(s, (c) => ({ ...c, plans: Object.fromEntries(Object.entries(c.plans).filter(([id]) => id !== f.id)) })))
    vi.setSystemTime(startMs)
    checkReminders(true)
    const notice = reminderEntries().find((e) => e.kind === "reminder")!
    expect(notice.reminder?.names).toHaveLength(3)
    expect(notice.reminder?.more).toBe(0)
  })

  it("suppresses every covered identity durably: a restart notifies nothing again", () => {
    const { startMs } = scenario()
    vi.setSystemTime(startMs)
    checkReminders(true)
    const before = reminderEntries().length

    // A restart: the persisted state comes back, and the first check is the start-up scan again.
    store.replace(JSON.parse(JSON.stringify(store.getState())) as PrototypeState)
    vi.setSystemTime(startMs + 10 * 60_000)
    const again = checkReminders(true)
    expect(again).toMatchObject({ check: "startup", missed: [], gathered: [], due: [] })
    expect(reminderEntries()).toHaveLength(before)
  })

  it("then delivers the next window on its own as it enters its lead time", () => {
    const { g, startMs } = scenario()
    vi.setSystemTime(startMs)
    checkReminders(true)
    const before = reminderEntries().length
    const firesAt = Date.parse(windowOf(g, LATER).start) - LEAD_MIN * 60_000

    // The computer slept until just before: a resume, with nothing new to gather and nothing missed.
    vi.setSystemTime(firesAt - 2 * 60_000)
    expect(checkReminders()).toMatchObject({ check: "resume", missed: [], gathered: [], due: [] })
    // An ordinary tick once its lead time has begun.
    vi.setSystemTime(firesAt + 60_000)
    const tick = checkReminders()
    expect(tick?.check).toBe("tick")
    expect(tick?.due.map((w) => w.targetId)).toEqual([g.id])
    const entries = reminderEntries()
    expect(entries).toHaveLength(before + 1)
    const single = entries[0]!
    expect(single.reminder).toMatchObject({ delivery: "single", names: [g.name], more: 0 })
    expect(say(m, single.title)).toBe(`${g.name} window in 12 h`)
    expect(store.getState().catalog.reminders.deliveredWindowKeys).toContain(reminderKey(windowOf(g, LATER), site()))
  })

  it("calls a window that ended during a resume missed while suspended, still Activity only", () => {
    const { a, b } = scenario()
    // Open, last checked at noon on the 13th; the clock moves on two days while it is open (the computer slept).
    vi.setSystemTime(Date.parse("2026-10-15T10:00:00Z"))
    const delivery = checkReminders()
    expect(delivery?.check).toBe("resume")
    expect(delivery?.missed.map((w) => w.targetId).sort()).toEqual([a.id, b.id].sort())
    expect(reminderEntries().filter((e) => e.kind === "reminder-missed").every((e) => say(m, e.title) === "Missed while PlateVault was suspended")).toBe(true)
  })

  it("does nothing while reminders are off", () => {
    scenario()
    store.setState((s) => withCatalog(s, (c) => ({ ...c, reminders: { ...c.reminders, enabled: false } })))
    vi.setSystemTime(Date.parse("2026-10-15T20:00:00Z"))
    expect(checkReminders(true)).toBeNull()
    expect(reminderEntries()).toHaveLength(0)
  })
})
