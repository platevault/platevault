import { describe, expect, it } from "vitest"
import { m, say } from "@/lib/i18n"
import { windowRef } from "./labels"
import { deadlinePriority, defaultCriteria, isLeadTime, LEAD_FLOOR_MIN, LEAD_MAX_MIN, nightsBetween, noticeNames, PRIORITY_RISE_NIGHTS, RESUME_GAP_MS, reminderCheckOf, reminderDelivery, reminderLookbackMs, seasonWindow, shiftNight, visibleMinutes, windowProgress } from "./planning"
import { DEFAULT_REMINDER_LEAD_MIN, type ObservingSite, type ObservingWindow, type SubjectWindow } from "./types"

const BACKYARD: ObservingSite = { id: "site_backyard", name: "Backyard", latitude: 52.09, longitude: 5.12, elevationM: 5, timeZone: "Europe/Amsterdam", twilight: "astronomical", minAltitudeDeg: 25 }
const LA_PALMA: ObservingSite = { id: "site_lapalma", name: "La Palma", latitude: 28.76, longitude: -17.88, elevationM: 2300, timeZone: "Atlantic/Canary", twilight: "astronomical", minAltitudeDeg: 20 }
const IC5070 = { ra: 312.75, dec: 44.37 }
const TONIGHT = "2026-10-13"

describe("nights left (C7)", () => {
  const finishBy: SubjectWindow = { kind: "finish-by", night: "2026-11-01" }

  it("counts tonight and the last night", () => {
    expect(nightsBetween(TONIGHT, "2026-11-01")).toBe(19)
    const progress = windowProgress(finishBy, TONIGHT)
    expect(progress).toMatchObject({ state: "open", nightsLeft: 20, opensIn: 0 })
    expect(say(m, progress.line)).toBe("20 nights left")
    expect(say(m, windowProgress(finishBy, "2026-11-01").line)).toBe("1 night left")
  })

  it("reads none left once the date has passed", () => {
    const progress = windowProgress(finishBy, "2026-11-02")
    expect(progress).toMatchObject({ state: "passed", nightsLeft: 0, priority: 0 })
    expect(say(m, progress.line)).toBe(m.domain_window_finish_by_passed())
    expect(say(m, windowProgress({ kind: "season", from: "2026-08-01", to: "2026-10-01" }, TONIGHT).line)).toBe(m.domain_window_season_over())
  })

  it("counts every night of a season that has not opened yet", () => {
    const progress = windowProgress({ kind: "season", from: "2026-11-01", to: "2026-11-30" }, TONIGHT)
    expect(progress).toMatchObject({ state: "upcoming", opensIn: 19, nightsLeft: 30, priority: 0 })
    expect(say(m, progress.line)).toBe("Opens in 19 nights")
  })

  it("names the window", () => {
    expect(say(m, windowRef(finishBy))).toBe("Finish by 1 Nov")
    expect(say(m, windowRef({ kind: "season", from: TONIGHT, to: "2027-01-27" }))).toBe(m.domain_window_season({ from: "13 Oct", to: "27 Jan" }))
  })
})

describe("planning priority rises as the date nears (C7)", () => {
  it("adds nothing until the last 30 nights, then rises to 1 on the last night", () => {
    expect(deadlinePriority(PRIORITY_RISE_NIGHTS + 1)).toBe(0)
    expect(deadlinePriority(PRIORITY_RISE_NIGHTS)).toBeCloseTo(1 / PRIORITY_RISE_NIGHTS)
    expect(deadlinePriority(1)).toBe(1)
    expect(deadlinePriority(0)).toBe(0)
  })

  it("rises night by night towards a Finish by date", () => {
    const window: SubjectWindow = { kind: "finish-by", night: "2026-11-30" }
    const priorities = Array.from({ length: 49 }, (_, n) => windowProgress(window, shiftNight(TONIGHT, n)).priority)
    // 13 Oct is 49 nights out: the first 19 nights add nothing, the last 30 rise strictly to 1.
    expect(priorities.slice(0, 19).every((p) => p === 0)).toBe(true)
    for (let n = 19; n < priorities.length - 1; n += 1) expect(priorities[n + 1]!).toBeGreaterThan(priorities[n]!)
    expect(priorities.at(-1)).toBe(1)
  })

  it("adds nothing before a season opens", () => {
    expect(windowProgress({ kind: "season", from: "2026-10-20", to: "2026-10-25" }, TONIGHT).priority).toBe(0)
  })
})

describe("season window pre-filled from visibility (C7)", () => {
  const criteria = defaultCriteria(BACKYARD)

  it("runs from tonight to the last night the Target is visible", () => {
    const season = seasonWindow(IC5070, BACKYARD, criteria, TONIGHT)
    expect(season?.kind).toBe("season")
    if (season?.kind !== "season") return
    expect(season.from).toBe(TONIGHT)
    expect(season.to > season.from).toBe(true)
    expect(visibleMinutes(IC5070, BACKYARD, criteria, season.to)).toBeGreaterThanOrEqual(criteria.minDurationMin)
    expect(visibleMinutes(IC5070, BACKYARD, criteria, shiftNight(season.to, 1))).toBeLessThan(criteria.minDurationMin)
  })

  it("finds the next season when the Target is out of season tonight", () => {
    const after = seasonWindow(IC5070, BACKYARD, criteria, TONIGHT)
    if (after?.kind !== "season") throw new Error("IC 5070 has a season at the backyard site")
    const next = seasonWindow(IC5070, BACKYARD, criteria, shiftNight(after.to, 1))
    expect(next?.kind === "season" && next.from > after.to).toBe(true)
  })

  it("has none for a Target never above the limit or up all year", () => {
    expect(seasonWindow({ ra: 6.024, dec: -72.081 }, BACKYARD, criteria, TONIGHT)).toBeNull()
    // Polaris from La Palma: above 20° on every dark night of the year.
    expect(seasonWindow({ ra: 37.95, dec: 89.26 }, LA_PALMA, defaultCriteria(LA_PALMA), TONIGHT)).toBeNull()
  })
})

describe("reminder lead time (D-W88, PLAN-AC-13)", () => {
  it("defaults to 12 hours, a lead time in range", () => {
    expect(DEFAULT_REMINDER_LEAD_MIN).toBe(12 * 60)
    expect(isLeadTime(DEFAULT_REMINDER_LEAD_MIN)).toBe(true)
  })

  it("is over 30 minutes and at most a week, in whole minutes", () => {
    expect(LEAD_FLOOR_MIN).toBe(30)
    expect(isLeadTime(30)).toBe(false)
    expect(isLeadTime(1)).toBe(false)
    expect(isLeadTime(31)).toBe(true)
    expect(isLeadTime(LEAD_MAX_MIN)).toBe(true)
    expect(isLeadTime(LEAD_MAX_MIN + 1)).toBe(false)
    expect(isLeadTime(45.5)).toBe(false)
  })
})

describe("reminder checks: start-up, resume and tick (PLAN-AC-15)", () => {
  const LEAD_MS = 12 * 3_600_000
  const at = (iso: string) => Date.parse(iso)
  const win = (targetId: string, start: string, end: string): ObservingWindow => ({ key: `${targetId}/site_backyard/${start}`, targetId, siteId: "site_backyard", start, end, maxAltitudeDeg: 60, moonIlluminationPct: 10, moonSeparationDeg: 90 })
  const keyOf = (w: ObservingWindow) => w.targetId
  const ids = (windows: ObservingWindow[]) => windows.map((w) => w.targetId)
  // PlateVault closed on the 13th at noon and starts on the 15th at 20:00Z: two windows ended while it was closed,
  // C has started, D and E are inside the 12 h lead time, F's lead time begins on the 16th at 07:30Z.
  const NOW = at("2026-10-15T20:00:00Z")
  const windows = [
    win("A", "2026-10-13T19:00:00Z", "2026-10-13T23:00:00Z"),
    win("B", "2026-10-14T19:00:00Z", "2026-10-14T23:00:00Z"),
    win("C", "2026-10-15T19:00:00Z", "2026-10-15T23:00:00Z"),
    win("D", "2026-10-15T22:00:00Z", "2026-10-16T02:00:00Z"),
    win("E", "2026-10-16T01:00:00Z", "2026-10-16T04:00:00Z"),
    win("F", "2026-10-16T19:30:00Z", "2026-10-16T23:30:00Z"),
  ]

  it("tells start-up, resume and an ordinary tick apart", () => {
    expect(reminderCheckOf(true, NOW - 1000, NOW)).toBe("startup")
    expect(reminderCheckOf(false, NOW - RESUME_GAP_MS - 1, NOW)).toBe("resume")
    expect(reminderCheckOf(false, NOW - 30_000, NOW)).toBe("tick")
    expect(reminderCheckOf(false, null, NOW)).toBe("tick")
  })

  it("looks back to the last check, never before reminders were turned on, never after now", () => {
    expect(reminderLookbackMs({ checkedAt: "2026-10-13T12:00:00Z", enabledAt: "2026-10-01T12:00:00Z" }, NOW)).toBe(at("2026-10-13T12:00:00Z"))
    expect(reminderLookbackMs({ checkedAt: "2026-10-13T12:00:00Z", enabledAt: "2026-10-14T08:00:00Z" }, NOW)).toBe(at("2026-10-14T08:00:00Z"))
    expect(reminderLookbackMs({ checkedAt: "2026-10-20T12:00:00Z", enabledAt: null }, NOW)).toBe(NOW)
    expect(reminderLookbackMs({ checkedAt: null, enabledAt: null }, NOW)).toBe(NOW)
  })

  it("at start-up records ended windows as missed and gathers every open one, started or inside its lead time", () => {
    const delivery = reminderDelivery(windows, keyOf, { check: "startup", nowMs: NOW, leadMs: LEAD_MS, delivered: new Set() })
    expect(ids(delivery.missed)).toEqual(["A", "B"])
    expect(ids(delivery.gathered)).toEqual(["C", "D", "E"])
    expect(delivery.due).toEqual([])
  })

  it("gathers on resume the same way", () => {
    const delivery = reminderDelivery(windows, keyOf, { check: "resume", nowMs: NOW, leadMs: LEAD_MS, delivered: new Set() })
    expect(ids(delivery.missed)).toEqual(["A", "B"])
    expect(ids(delivery.gathered)).toEqual(["C", "D", "E"])
  })

  it("passes over every delivered identity, so a restart notifies nothing again", () => {
    const first = reminderDelivery(windows, keyOf, { check: "startup", nowMs: NOW, leadMs: LEAD_MS, delivered: new Set() })
    const delivered = new Set([...first.missed, ...first.gathered].map(keyOf))
    const again = reminderDelivery(windows, keyOf, { check: "startup", nowMs: NOW + 60_000, leadMs: LEAD_MS, delivered })
    expect(again).toEqual({ check: "startup", missed: [], gathered: [], due: [] })
  })

  it("then delivers the next window on its own as it enters its lead time", () => {
    const delivered = new Set(["A", "B", "C", "D", "E"])
    const before = reminderDelivery(windows, keyOf, { check: "tick", nowMs: at("2026-10-16T07:29:00Z"), leadMs: LEAD_MS, delivered })
    expect(before.due).toEqual([])
    const entered = reminderDelivery(windows, keyOf, { check: "tick", nowMs: at("2026-10-16T07:31:00Z"), leadMs: LEAD_MS, delivered })
    expect(ids(entered.due)).toEqual(["F"])
    expect(entered.gathered).toEqual([])
    expect(entered.missed).toEqual([])
  })

  it("on a tick never notifies a window that has started, and records nothing as missed", () => {
    const tick = reminderDelivery(windows, keyOf, { check: "tick", nowMs: NOW, leadMs: LEAD_MS, delivered: new Set() })
    expect(ids(tick.due)).toEqual(["D", "E"])
    expect(tick.missed).toEqual([])
  })

  it("lets an open window take its identity before an ended one of the same identity", () => {
    const sameNight = [win("A", "2026-10-15T18:00:00Z", "2026-10-15T19:00:00Z"), win("A", "2026-10-15T19:30:00Z", "2026-10-15T23:00:00Z")]
    const delivery = reminderDelivery(sameNight, keyOf, { check: "startup", nowMs: NOW, leadMs: LEAD_MS, delivered: new Set() })
    expect(delivery.gathered.map((w) => w.start)).toEqual(["2026-10-15T19:30:00Z"])
    expect(delivery.missed).toEqual([])
  })
})

describe("a gathered notice names at most three Targets (PLAN-AC-15)", () => {
  it("names three, then counts the rest once each", () => {
    expect(noticeNames(["M 31", "M 33", "NGC 7000"])).toEqual({ names: ["M 31", "M 33", "NGC 7000"], more: 0 })
    expect(noticeNames(["M 31", "M 33", "M 31", "NGC 7000", "IC 5070"])).toEqual({ names: ["M 31", "M 33", "NGC 7000"], more: 1 })
    expect(noticeNames(["M 31"])).toEqual({ names: ["M 31"], more: 0 })
  })
})
