import { describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { imgTimeText, prioritiesByTarget, priorityOrder, type RowView, sortValue } from "./targets-model"

const NIGHT = "2026-10-13"

/** A Planning row with only what its order reads: the designation and the rank. */
function view(designation: string, planningRank: number | null): RowView {
  return { row: { designation }, planningRank } as RowView
}

describe("Planning order (C7): planningPriorities, then the rest by designation", () => {
  it("ranks the demo's Targets with a window: NGC 7000 (Cygnus HOO 2026) first, then IC 5070", () => {
    const ranks = prioritiesByTarget(createSeed("demo").catalog, NIGHT)
    expect([...ranks.entries()].map(([id, r]) => [id, r.rank, r.priority.project.id, r.priority.subject.id])).toEqual([
      ["tgt_y2bxfy", 0, "prj_cygnus", "sub_ngc7000"],
      ["tgt_3bg4tx", 1, "prj_ic5070", "sub_ic5070"],
    ])
  })

  it("puts ranked rows first in rank order, then the others by designation", () => {
    const rows = [view("M 31", null), view("NGC 7000", 1), view("IC 1396", null), view("IC 5070", 0)]
    expect(priorityOrder(rows).map((v) => v.row.designation)).toEqual(["IC 5070", "NGC 7000", "IC 1396", "M 31"])
  })
})

describe("Suitable filters sort", () => {
  const chips = (minutes: Record<string, number>, grades: Record<string, "good" | "marginal" | "poor">) =>
    ({ row: { designation: "X" }, sky: { status: "no-site" }, tonight: Object.entries(minutes).map(([band, m]) => ({ band, minutes: m, grade: grades[band] })) }) as unknown as RowView
  const a = chips({ Ha: 300, OIII: 90, SII: 20 }, { Ha: "good", OIII: "marginal", SII: "poor" })
  const b = chips({ Ha: 120, OIII: 400, SII: 20 }, { Ha: "marginal", OIII: "good", SII: "poor" })

  it("without picked bands: two points per good and one per marginal band, poor counts nothing (Q36)", () => {
    expect(sortValue(a, "tonight")).toBe(3)
    expect(sortValue(b, "tonight")).toBe(3)
  })

  it("with picked bands: the longest Moon-clear time among them (Q16)", () => {
    expect(sortValue(a, "tonight", ["Ha"])).toBe(300)
    expect(sortValue(a, "tonight", ["Ha", "OIII"])).toBe(300)
    expect(sortValue(b, "tonight", ["Ha", "OIII"])).toBe(400)
    expect(sortValue(a, "tonight", ["L"])).toBeNull()
  })
})

describe("Img time (T10): the reason it is zero is a short value beside 0h, never a sentence", () => {
  it("reads the hours when there is time, and 0h with its reason label when there is none", () => {
    expect(imgTimeText({ imgTimeS: 7800, zeroReason: null })).toBe("2h10")
    expect(imgTimeText({ imgTimeS: 0, zeroReason: "low" })).toBe("0h · Too low")
    expect(imgTimeText({ imgTimeS: 0, zeroReason: "darkness" })).toBe("0h · Twilight only")
    expect(imgTimeText({ imgTimeS: 0, zeroReason: null })).toBe("0h")
  })
})
