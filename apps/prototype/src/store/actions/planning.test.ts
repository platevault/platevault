import { describe, expect, it } from "vitest"
import { DEFAULT_LEAD_MIN, LEAD_TIMES_MIN } from "./planning"

describe("reminder lead times (astro-plan-mv2g1)", () => {
  it("defaults to two hours, one of the offered presets", () => {
    expect(DEFAULT_LEAD_MIN).toBe(120)
    expect(LEAD_TIMES_MIN).toContain(DEFAULT_LEAD_MIN)
  })

  it("offers 30 min, 1 h, 2 h, 4 h and 1 day, shortest first", () => {
    expect([...LEAD_TIMES_MIN]).toEqual([30, 60, 120, 240, 1440])
  })
})
