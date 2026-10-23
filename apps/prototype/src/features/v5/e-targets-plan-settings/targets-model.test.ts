import { describe, expect, it } from "vitest"
import { liveLightSessions } from "@/domain/derive"
import { createSeed } from "@/domain/seed"
import type { AssociationStatus, Catalog, Target, TargetId } from "@/domain/types"
import { m } from "@/lib/i18n"
import { allRows, favouriteFor, imgTimeText, myTargetRows, parseFavourite, prioritiesByTarget, priorityOrder, type RowView, rowSource, searchRows, sortValue } from "./targets-model"

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

describe("My targets (D-W125): favourites, open-Project subjects and every Target with a session", () => {
  const SHOT = "tgt_test_shot"
  const SUGGESTED = "tgt_test_suggested"
  const FAVOURITE = "tgt_test_favourite"

  /** The demo library plus three new Targets: one with an indexed session, one only suggested for a session, one favourite with no session. */
  function library(): Catalog {
    const catalog = structuredClone(createSeed("demo").catalog)
    const base = Object.values(catalog.targets)[0]!
    const add = (id: TargetId, name: string, favourite: boolean) => {
      const target: Target = { ...base, id, name, aliases: [], favourite }
      catalog.targets[id] = target
    }
    add(SHOT, "Shot Test Nebula", false)
    add(SUGGESTED, "Suggested Test Nebula", false)
    add(FAVOURITE, "Favourite Test Nebula", true)
    const [shot, suggested] = liveLightSessions(catalog)
    const point = (sessionId: string, value: TargetId, status: AssociationStatus) => {
      catalog.sessions[sessionId] = { ...catalog.sessions[sessionId]!, target: { value, status, evidence: [], confirmedAt: null } }
    }
    point(shot!.id, SHOT, "associated")
    point(suggested!.id, SUGGESTED, "needs-review")
    return catalog
  }

  const mine = (catalog: Catalog) => new Map(myTargetRows(allRows(catalog)).map((r) => [r.key, r]))

  it("lists a Target with an indexed session that is neither a favourite nor an open-Project subject", () => {
    const catalog = library()
    expect(Object.values(catalog.projects).some((p) => p.state === "open" && p.subjects.some((s) => s.targetId === SHOT))).toBe(false)
    const row = mine(catalog).get(SHOT)
    expect(row?.mine).toBe(true)
    expect(row?.target?.favourite).toBe(false)
    expect(row?.projects).toEqual([])
  })

  it("does not list a Target only suggested for a session", () => {
    const catalog = library()
    expect(mine(catalog).has(SUGGESTED)).toBe(false)
    expect(allRows(catalog).find((r) => r.key === SUGGESTED)?.mine).toBe(false)
  })

  it("still lists favourites with no session, and open-Project subjects with their Project badge", () => {
    const catalog = library()
    const project = Object.values(catalog.projects).find((p) => p.state === "open" && p.subjects.length > 0)!
    const subjectId = project.subjects[0]!.targetId
    catalog.targets[subjectId] = { ...catalog.targets[subjectId]!, favourite: false }
    for (const session of Object.values(catalog.sessions)) {
      if (session.target.value === subjectId) catalog.sessions[session.id] = { ...session, target: { ...session.target, status: "unresolved" } }
    }
    const rows = mine(catalog)
    expect(rows.get(FAVOURITE)?.mine).toBe(true)
    expect(rows.get(subjectId)?.projects.map((p) => p.id)).toContain(project.id)
  })

  it("its search result is the library Target, in My targets, so it offers no Add to targets", () => {
    const results = searchRows(allRows(library()), "Shot Test", false)
    expect(results.map((r) => r.key)).toEqual([SHOT])
    const [row] = results
    // Add to targets is offered only for a result with no library Target (targets.tsx `rowActions`).
    expect(row!.target?.id).toBe(SHOT)
    expect(row!.mine).toBe(true)
    expect(rowSource(row!)).toBe(m.project_search_my_targets())
  })
})

describe("Favourite facet (`?fav=`)", () => {
  const row = (designation: string, favourite: boolean | null) => ({ row: { designation, target: favourite === null ? null : { favourite } } }) as unknown as RowView
  const rows = [row("M 31", true), row("M 33", false), row("Catalogue only", null)]
  const names = (views: RowView[]) => views.map((v) => v.row.designation)

  it("reads yes and no, and nothing else", () => {
    expect(parseFavourite("yes")).toBe("yes")
    expect(parseFavourite("no")).toBe("no")
    expect(parseFavourite("")).toBeNull()
    expect(parseFavourite(undefined)).toBeNull()
    expect(parseFavourite("true")).toBeNull()
  })

  it("keeps favourites for yes, every other row for no, and every row without a filter", () => {
    expect(names(favouriteFor(rows, "yes"))).toEqual(["M 31"])
    expect(names(favouriteFor(rows, "no"))).toEqual(["M 33", "Catalogue only"])
    expect(names(favouriteFor(rows, null))).toEqual(["M 31", "M 33", "Catalogue only"])
  })

  it("leaves My targets membership alone: a favourite removed from favourites stays listed while it has a session", () => {
    const catalog = structuredClone(createSeed("demo").catalog)
    const withSession = allRows(catalog).find((r) => r.mine && r.target && r.projects.length === 0 && !r.target.favourite)
    expect(withSession, "a My targets row that is neither a favourite nor a Project subject").toBeDefined()
    const id = withSession!.target!.id
    catalog.targets[id] = { ...catalog.targets[id]!, favourite: true }
    expect(myTargetRows(allRows(catalog)).some((r) => r.key === id)).toBe(true)
    catalog.targets[id] = { ...catalog.targets[id]!, favourite: false }
    expect(myTargetRows(allRows(catalog)).some((r) => r.key === id)).toBe(true)
  })
})
