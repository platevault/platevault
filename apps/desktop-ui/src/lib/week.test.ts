import { describe, expect, it } from "vitest"
import { dayInWeek, dayOfWeek, shiftNight, startOfWeek, WEEK_START } from "./week"

/** A Thursday. */
const THURSDAY = "2026-10-29"

describe("calendar weeks", () => {
  it("starts the week on Monday in en-GB and on Sunday in pt-BR", () => {
    expect(WEEK_START).toEqual({ "en-GB": 1, "pt-BR": 0 })
  })

  it("shifts a night across month and year ends, both ways", () => {
    expect(shiftNight(THURSDAY, 3)).toBe("2026-11-01")
    expect(shiftNight("2026-12-31", 1)).toBe("2027-01-01")
    expect(shiftNight("2026-03-01", -1)).toBe("2026-02-28")
    expect(shiftNight(THURSDAY, 0)).toBe(THURSDAY)
  })

  it("reads the day of the week of a night", () => {
    expect(dayOfWeek(THURSDAY)).toBe(4)
    expect(dayOfWeek("2026-11-01")).toBe(0)
  })

  it("counts the nights since the week's first, per week start", () => {
    expect(dayInWeek(THURSDAY, 1)).toBe(3)
    expect(dayInWeek(THURSDAY, 0)).toBe(4)
    // The first night of a week is 0 nights in; the night before it is the last of the week before.
    expect(dayInWeek("2026-10-26", 1)).toBe(0)
    expect(dayInWeek("2026-10-25", 1)).toBe(6)
    expect(dayInWeek("2026-10-25", 0)).toBe(0)
  })

  it("finds the first night of a night's week, per week start", () => {
    expect(startOfWeek(THURSDAY, 1)).toBe("2026-10-26")
    expect(startOfWeek(THURSDAY, 0)).toBe("2026-10-25")
    expect(startOfWeek("2026-10-26", 1)).toBe("2026-10-26")
    // Across a month end.
    expect(startOfWeek("2026-11-01", 1)).toBe("2026-10-26")
  })
})
