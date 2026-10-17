import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { planningSite, type World } from "./derive"
import { GRADE_RANK, goalHorizon, goalsTonight, type Horizon, nextGoodNight, nightOutlooks } from "./outlook"
import { createSeed } from "./seed"
import type { ObservingSite } from "./types"

const TONIGHT = "2026-10-13"
const NOW = Date.parse(`${TONIGHT}T12:00:00Z`)
const NIGHTS = 21

let world: World
let site: ObservingSite
let horizon: Horizon
beforeAll(() => {
  // The seed plans tonight from the clock (`upcomingNight(site, Date.now())`): freeze Date at the same instant
  // the horizon starts from, so the demo plan's night is TONIGHT whatever day the suite runs.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  world = createSeed("demo")
  site = planningSite(world)!
  horizon = goalHorizon(world.catalog, site, NOW, TONIGHT, NIGHTS)
})
afterAll(() => {
  vi.useRealTimers()
})

describe("goalHorizon (moved from the Home concepts)", () => {
  it("grades every unmet goal with a position and a filter curve on each night", () => {
    expect(horizon.nights).toHaveLength(NIGHTS)
    expect(horizon.nights[0]).toBe(TONIGHT)
    expect(horizon.goals.length).toBeGreaterThan(0)
    for (const goal of horizon.goals) {
      expect(goal.progress.met).toBe(false)
      if (goal.grades) expect(goal.grades).toHaveLength(NIGHTS)
      expect(goal.subject.minutes).toHaveLength(NIGHTS)
    }
  })

  it("finds the next good night after a given one", () => {
    expect(nextGoodNight(["poor", "marginal", "good", "good"])).toBe(2)
    expect(nextGoodNight(["good", "poor", "good"], 2)).toBeNull()
  })
})

describe("nightOutlooks: the calendar's nights", () => {
  it("gives each night its darkness, the Moon's direction, the goals it suits best first, the Moon-limited goals and the plan", () => {
    const nights = nightOutlooks(world.catalog, site, horizon)
    expect(nights.map((n) => n.night)).toEqual(horizon.nights)
    nights.forEach((n, i) => {
      const dark = n.summary.darkness
      expect(n.darkS).toBe(dark ? (Date.parse(dark.end) - Date.parse(dark.start)) / 1000 : null)
      expect(n.suited.every((g) => g.grades?.[i] === "good")).toBe(true)
      expect(n.suited).toHaveLength(horizon.goals.filter((g) => g.grades?.[i] === "good").length)
      // Best first: the subject with the most Img time on the night leads.
      for (let k = 1; k < n.suited.length; k += 1) expect(n.suited[k - 1]!.subject.minutes[i]!).toBeGreaterThanOrEqual(n.suited[k]!.subject.minutes[i]!)
      expect(n.moonLimited.every((g) => g.moonLimited?.[i] === true)).toBe(true)
      if (i + 1 < nights.length) expect(n.waxing).toBe(nights[i + 1]!.summary.moon.illuminationPct > n.summary.moon.illuminationPct)
    })
    // The demo plans NGC 7000 and M 33 for tonight only.
    expect(nights[0]!.planned.map((t) => t.name).sort()).toEqual(["M 33", "NGC 7000"])
    expect(nights.slice(1).every((n) => n.planned.length === 0)).toBe(true)
  })
})

describe("goalsTonight: what Tonight lists", () => {
  it("lists the goals graded good or marginal tonight, good first, and names the next good night", () => {
    const tonight = goalsTonight(horizon)
    expect(tonight.goals.every((g) => g.grades?.[0] === "good" || g.grades?.[0] === "marginal")).toBe(true)
    const ranks = tonight.goals.map((g) => GRADE_RANK[g.grades![0]!])
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    const firstGood = Math.min(...horizon.goals.map((g) => (g.grades ? (nextGoodNight(g.grades) ?? Infinity) : Infinity)))
    expect(tonight.nextGood).toBe(Number.isFinite(firstGood) ? horizon.nights[firstGood] : null)
  })

  it("has no next good night when no goal is ever good", () => {
    const poor: Horizon = { ...horizon, goals: horizon.goals.map((g) => ({ ...g, grades: g.grades?.map(() => "poor" as const) ?? null })) }
    expect(goalsTonight(poor)).toEqual({ goals: [], nextGood: null })
  })
})
