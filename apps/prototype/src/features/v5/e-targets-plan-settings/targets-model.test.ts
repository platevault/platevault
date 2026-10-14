import { describe, expect, it } from "vitest"
import { planningPriorities } from "@/domain/derive"
import { createSeed } from "@/domain/seed"
import { prioritiesByTarget, priorityOrder, type RowView } from "./targets-model"

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
