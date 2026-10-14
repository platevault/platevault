import { describe, expect, it } from "vitest"
import { planningPriorities } from "@/domain/derive"
import { createSeed } from "@/domain/seed"
import { prioritiesByTarget, priorityOrder, type RowView, sortValue } from "./targets-model"

const NIGHT = "2026-10-13"

/** A Planning row with only what its order reads: the designation and the rank. */
function view(designation: string, planningRank: number | null): RowView {
  return { row: { designation }, planningRank } as RowView
}

describe("Planning order (C7): planningPriorities, then the rest by designation", () => {
  it("ranks each Target by its first subject in planningPriorities", () => {
    const { catalog } = createSeed("demo")
    const order = planningPriorities(catalog, NIGHT)
    expect(order.length).toBeGreaterThan(0)
    const ranks = prioritiesByTarget(catalog, NIGHT)
    const firstPerTarget = [...new Set(order.map((p) => p.subject.targetId))]
    expect([...ranks.entries()].map(([id, r]) => [id, r.rank])).toEqual(firstPerTarget.map((id, rank) => [id, rank]))
    for (const [id, r] of ranks) expect(r.priority).toEqual(order.find((p) => p.subject.targetId === id))
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
