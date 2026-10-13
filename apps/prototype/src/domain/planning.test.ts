import { describe, expect, it } from "vitest"
import { m, say } from "@/lib/i18n"
import { windowRef } from "./labels"
import { deadlinePriority, defaultCriteria, nightsBetween, PRIORITY_RISE_NIGHTS, seasonWindow, shiftNight, visibleMinutes, windowProgress } from "./planning"
import type { ObservingSite, SubjectWindow } from "./types"

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
    expect(say(m, windowRef({ kind: "season", from: TONIGHT, to: "2027-01-27" }))).toBe("Season 13 Oct – 27 Jan")
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
