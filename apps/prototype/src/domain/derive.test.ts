import { beforeAll, describe, expect, it } from "vitest"
import { m, say } from "@/lib/i18n"
import { freezeGoals, goalProgress, nearestPanel, panelBalance, planningPriorities, subjectProgress, type GoalProgress } from "./derive"
import { defaultCriteria, seasonWindow } from "./planning"
import { createSeed } from "./seed"
import { qualityBarFor, subjectConditionsFrom } from "./templates"
import type { Catalog, MosaicPanel, Project } from "./types"

// Goal conditions (C7, HARNESS-V5-FEEDBACK-R1.md "Goals, grilling round 4") on the demo library.
const TONIGHT = "2026-10-13"
const CYGNUS = "prj_cygnus"
const M31 = "prj_m31"
const MOSAIC = "sub_ic5070"
const NGC = "sub_ngc7000"

let demo: Catalog
beforeAll(() => {
  demo = createSeed("demo").catalog
})

/** A fresh copy of the demo library, so each test edits its own. */
function library(): Catalog {
  return structuredClone(demo)
}

function project(catalog: Catalog, id: string): Project {
  return catalog.projects[id]!
}

function progressOf(catalog: Catalog, projectId: string, goalId: string): GoalProgress {
  return goalProgress(catalog, project(catalog, projectId)).find((p) => p.goal.id === goalId)!
}

function subject(catalog: Catalog, projectId: string, subjectId: string) {
  return subjectProgress(catalog, project(catalog, projectId), TONIGHT).find((s) => s.subject.id === subjectId)!
}

function setGoals(catalog: Catalog, projectId: string, edit: (goal: Project["goals"][number]) => Project["goals"][number] | null) {
  const p = project(catalog, projectId)
  catalog.projects[projectId] = { ...p, goals: p.goals.map(edit).filter((g) => g !== null) }
}

function setConditions(catalog: Catalog, projectId: string, subjectId: string, conditions: NonNullable<Project["subjects"][number]["conditions"]>) {
  const p = project(catalog, projectId)
  catalog.projects[projectId] = { ...p, subjects: p.subjects.map((s) => (s.id === subjectId ? { ...s, conditions } : s)) }
}

/** Puts the trashed Panel 3 run back, so every panel has Ha in project. */
function restorePanel3(catalog: Catalog) {
  catalog.runs.run_ic5070_p3 = { ...catalog.runs.run_ic5070_p3!, trashedAt: null }
}

describe("quality bar: count only frames with FWHM ≤ x″ (C7)", () => {
  it("counts the Usable frames inside the bar and shows the rest as below it", () => {
    const catalog = library()
    const l = progressOf(catalog, M31, "goal_m31_l")
    expect(l.goal.qualityBar).toEqual(qualityBarFor(5.25))
    expect(l.inProject.frames).toBeGreaterThan(0)
    expect(l.belowBar.frames).toBeGreaterThan(0)
    // Without a limit every Usable member counts: the bar splits exactly those.
    setGoals(catalog, M31, (g) => (g.id === "goal_m31_l" ? { ...g, qualityBar: qualityBarFor(null) } : g))
    const usable = progressOf(catalog, M31, "goal_m31_l")
    expect(usable.belowBar.frames).toBe(0)
    expect(usable.belowBarLine).toBeNull()
    expect(l.inProject.frames + l.belowBar.frames).toBe(usable.inProject.frames)
    expect(l.inProject.seconds + l.belowBar.seconds).toBe(usable.inProject.seconds)
  })

  it("reads \"+N h below bar\" in the goal's unit", () => {
    const catalog = library()
    setGoals(catalog, M31, (g) => (g.id === "goal_m31_l" ? { ...g, integrationS: 2 * 3600, qualityBar: qualityBarFor(1) } : g))
    const time = progressOf(catalog, M31, "goal_m31_l")
    expect(time.inProject.frames).toBe(0)
    expect(say(m, time.belowBarLine!)).toMatch(/^\+\d+h(\d\d)? below bar$/)
    setGoals(catalog, M31, (g) => (g.id === "goal_m31_l" ? { ...g, integrationS: null, frameCount: 60 } : g))
    const frames = progressOf(catalog, M31, "goal_m31_l")
    expect(say(m, frames.belowBarLine!)).toBe(`+${frames.belowBar.frames} frames below bar`)
  })

  it("never counts an Unusable frame, with or without a limit", () => {
    const catalog = library()
    const r = progressOf(catalog, M31, "goal_m31_r")
    expect(r.met).toBe(true)
    const runIds = catalog.runs.run_m31!.revisions.at(-1)!.included
    for (const id of runIds) {
      const asset = catalog.assets[id]!
      if (catalog.sessions[asset.sessionId!]!.channel === "R") catalog.assets[id] = { ...asset, quality: { ...asset.quality, value: "unusable" } }
    }
    const after = progressOf(catalog, M31, "goal_m31_r")
    expect(after.inProject.frames).toBe(0)
    expect(after.belowBar.frames).toBe(0)
    expect(after.met).toBe(false)
  })
})

describe("mosaic panel balance (C7)", () => {
  const panel = (n: number): MosaicPanel => ({ id: `pnl_${n}`, n, ra: 0, dec: 0, rotationDeg: 0 })
  const shares = (amounts: number[]) => amounts.map((counted, i) => ({ panel: panel(i + 1), counted }))

  it("keeps every panel within ±10 % of the panels' mean by default", () => {
    expect(panelBalance("Ha", "time", shares([100, 95, 105]), 10).balanced).toBe(true)
    const off = panelBalance("Ha", "time", shares([100, 80, 100]), 10)
    expect(off.balanced).toBe(false)
    expect(off.furthest?.panel.n).toBe(2)
    expect(off.furthest?.deviationPct).toBeCloseTo(-14.29, 2)
    expect(say(m, off.line)).toBe("Panel 2 14% below average · limit ±10%")
  })

  it("follows an edited percentage", () => {
    expect(panelBalance("Ha", "time", shares([100, 80, 100]), 15).balanced).toBe(true)
    expect(say(m, panelBalance("Ha", "time", shares([100, 80, 100]), 15).line)).toBe("Panels within ±15%")
    expect(panelBalance("Ha", "time", shares([100, 95, 105]), 4).balanced).toBe(false)
  })

  it("reads even while nothing is counted", () => {
    expect(panelBalance("Ha", "frames", shares([0, 0, 0]), 10)).toMatchObject({ balanced: true, furthest: null, mean: 0 })
  })

  it("compares counted integration per channel on the demo mosaic, at the default and an edited percentage", () => {
    const catalog = library()
    restorePanel3(catalog)
    const ha = () => subject(catalog, CYGNUS, MOSAIC).channels.find((c) => c.channel === "Ha")!.balance!
    // Usable Ha in project: Panels 1 and 2 hold 30 × 300 s, Panel 3 holds 20 × 300 s.
    expect(ha().unit).toBe("time")
    expect(ha().panels.map((p) => p.counted)).toEqual([9000, 9000, 6000])
    expect(ha().tolerancePct).toBe(10)
    expect(ha().balanced).toBe(false)
    expect(ha().furthest?.panel.n).toBe(3)
    expect(ha().furthest?.deviationPct).toBeCloseTo(-25, 6)
    setConditions(catalog, CYGNUS, MOSAIC, { panelBalancePct: 20, window: null })
    expect(ha().balanced).toBe(false)
    setConditions(catalog, CYGNUS, MOSAIC, { panelBalancePct: 25, window: null })
    expect(ha().balanced).toBe(true)
  })

  it("compares frames when every panel goal counts frames", () => {
    const catalog = library()
    restorePanel3(catalog)
    setGoals(catalog, CYGNUS, (g) => (g.subjectId === MOSAIC && g.channel === "Ha" ? { ...g, integrationS: null, frameCount: 40 } : g))
    const ha = subject(catalog, CYGNUS, MOSAIC).channels.find((c) => c.channel === "Ha")!.balance!
    expect(ha.unit).toBe("frames")
    expect(ha.panels.map((p) => p.counted)).toEqual([30, 30, 20])
  })
})

describe("mosaic coverage: weakest panel and completion (C7)", () => {
  it("shows the weakest panel while any panel is short", () => {
    const progress = subject(library(), CYGNUS, MOSAIC)
    expect(progress.complete).toBe(false)
    expect(progress.weakestPanel?.n).toBe(3)
    expect(progress.fraction).toBe(0)
    expect(progress.channels.map((c) => c.weakest.goal.panelId)).toEqual(["pnl_3", "pnl_3"])
    expect(say(m, progress.line!)).toBe("0% · weakest Panel 3")
  })

  it("completes only when every panel meets its goals", () => {
    const catalog = library()
    restorePanel3(catalog)
    // Each panel's goals at exactly what it holds in project; Panel 3 has no OIII, so its OIII goal goes.
    const held = new Map(goalProgress(catalog, project(catalog, CYGNUS)).map((p) => [p.goal.id, p.inProject.frames]))
    setGoals(catalog, CYGNUS, (g) => (g.subjectId !== MOSAIC ? g : held.get(g.id) ? { ...g, integrationS: null, frameCount: held.get(g.id)! } : null))
    const done = subject(catalog, CYGNUS, MOSAIC)
    expect(done.complete).toBe(true)
    expect(done.fraction).toBe(1)
    setGoals(catalog, CYGNUS, (g) => (g.id === "goal_pnl_2_oiii" ? { ...g, frameCount: g.frameCount! + 1 } : g))
    const short = subject(catalog, CYGNUS, MOSAIC)
    expect(short.complete).toBe(false)
    expect(short.weakestPanel?.n).toBe(2)
    expect(short.channels.find((c) => c.channel === "OIII")!.weakest.goal.id).toBe("goal_pnl_2_oiii")
  })

  it("never completes a subject without goals", () => {
    const catalog = library()
    setGoals(catalog, CYGNUS, (g) => (g.subjectId === MOSAIC ? null : g))
    expect(subject(catalog, CYGNUS, MOSAIC)).toMatchObject({ complete: false, fraction: null, line: null })
  })
})

describe("channel ratio display (C7)", () => {
  it("shows counted time per channel next to the ratio the goals imply", () => {
    const catalog = library()
    const ngc = subject(catalog, CYGNUS, NGC)
    const ha = progressOf(catalog, CYGNUS, "goal_ngc_ha").inProject.seconds
    const oiii = progressOf(catalog, CYGNUS, "goal_ngc_oiii").inProject.seconds
    const ratio = ngc.ratio!
    expect(ratio.unit).toBe("time")
    expect(ratio.counted.map((p) => p.channel)).toEqual(["Ha", "OIII"])
    expect(ratio.counted.map((p) => p.amount)).toEqual([ha, oiii])
    expect(ratio.counted.map((p) => p.part)).toEqual([ha / Math.min(ha, oiii), oiii / Math.min(ha, oiii)])
    expect(ratio.implied?.map((p) => p.part)).toEqual([1, 1])
    expect(say(m, ratio.line)).toBe(`Ha ${(ha / oiii).toFixed(1)} : OIII 1.0 counted · goals Ha 1.0 : OIII 1.0`)
  })

  it("adds a mosaic's panels per channel", () => {
    const catalog = library()
    const mosaic = subject(catalog, CYGNUS, MOSAIC).ratio!
    const sum = (channel: string) => mosaic.counted.find((p) => p.channel === channel)!.amount
    const goals = goalProgress(catalog, project(catalog, CYGNUS)).filter((p) => p.goal.subjectId === MOSAIC)
    expect(sum("Ha")).toBe(goals.filter((p) => p.goal.channel === "Ha").reduce((n, p) => n + p.inProject.seconds, 0))
    expect(mosaic.implied?.map((p) => p.amount)).toEqual([12 * 3600, 12 * 3600])
  })

  it("implies no ratio when the goals mix time and frames", () => {
    const ratio = subject(library(), M31, "sub_m31").ratio!
    expect(ratio.unit).toBe("time")
    expect(ratio.implied).toBeNull()
    expect(ratio.counted.map((p) => p.channel)).toEqual(["L", "R", "G", "B"])
  })

  it("counts frames when every goal counts frames", () => {
    const catalog = library()
    setGoals(catalog, M31, (g) => (g.id === "goal_m31_l" ? { ...g, integrationS: null, frameCount: 60 } : g))
    const ratio = subject(catalog, M31, "sub_m31").ratio!
    expect(ratio.unit).toBe("frames")
    expect(ratio.implied?.map((p) => p.part)).toEqual([3, 1, 1, 1])
  })
})

describe("deadline or season window (C7)", () => {
  it("shows the nights left and raises the subject in Planning as the date nears", () => {
    const catalog = library()
    setConditions(catalog, CYGNUS, NGC, { panelBalancePct: 10, window: { kind: "finish-by", night: "2026-11-01" } })
    setConditions(catalog, CYGNUS, MOSAIC, { panelBalancePct: 10, window: { kind: "season", from: "2026-10-01", to: "2027-01-27" } })
    const ngc = subject(catalog, CYGNUS, NGC).window!
    expect(ngc).toMatchObject({ state: "open", nightsLeft: 20 })
    expect(say(m, ngc.line)).toBe("20 nights left")
    const order = planningPriorities(catalog, TONIGHT)
    expect(order.map((p) => p.subject.id)).toEqual([NGC, MOSAIC])
    expect(order[0]!.priority).toBeCloseTo(11 / 30, 6)
    expect(order[1]!.priority).toBe(0)
    const nearer = planningPriorities(catalog, "2026-10-30")
    expect(nearer[0]!.priority).toBeGreaterThan(order[0]!.priority)
  })

  it("leaves complete subjects and passed windows out of Planning's order", () => {
    const catalog = library()
    setConditions(catalog, CYGNUS, NGC, { panelBalancePct: 10, window: { kind: "finish-by", night: "2026-10-01" } })
    setConditions(catalog, CYGNUS, MOSAIC, { panelBalancePct: 10, window: { kind: "finish-by", night: "2026-10-20" } })
    setGoals(catalog, CYGNUS, (g) => (g.subjectId === MOSAIC ? { ...g, integrationS: 0 } : g))
    expect(planningPriorities(catalog, TONIGHT)).toEqual([])
  })

  it("comes from a template's season rule, pre-filled from the Target's visibility", () => {
    const catalog = library()
    const template = catalog.goalTemplates.gtpl_user_hoo_mosaic!
    const site = catalog.sites.site_backyard!
    const target = catalog.targets[project(catalog, CYGNUS).subjects.find((s) => s.id === MOSAIC)!.targetId]!
    const conditions = subjectConditionsFrom(template, () => seasonWindow({ ra: target.ra!, dec: target.dec! }, site, defaultCriteria(site), TONIGHT))
    expect(conditions.panelBalancePct).toBe(15)
    expect(conditions.window).toMatchObject({ kind: "season", from: TONIGHT })
    expect(template.values.every((v) => v.qualityBar?.kind === "usable-max-fwhm")).toBe(true)
  })
})

describe("goals freeze when the Project closes (C7)", () => {
  function close(catalog: Catalog, at: string) {
    const p = project(catalog, M31)
    catalog.projects[M31] = { ...p, state: "done", doneAt: at, goalFreeze: freezeGoals(catalog, p, at) }
  }

  function markUnusable(catalog: Catalog, channel: string) {
    for (const id of catalog.runs.run_m31!.revisions.at(-1)!.included) {
      const asset = catalog.assets[id]!
      if (catalog.sessions[asset.sessionId!]!.channel === channel) catalog.assets[id] = { ...asset, quality: { ...asset.quality, value: "unusable" } }
    }
  }

  it("keeps the figures from Close while the library changes", () => {
    const catalog = library()
    const before = goalProgress(catalog, project(catalog, M31))
    close(catalog, "2026-10-13T08:00:00.000Z")
    markUnusable(catalog, "R")
    const closed = goalProgress(catalog, project(catalog, M31))
    expect(closed.every((p) => p.frozen)).toBe(true)
    expect(closed.map((p) => [p.inProject, p.captured, p.belowBar, p.met])).toEqual(before.map((p) => [p.inProject, p.captured, p.belowBar, p.met]))
    expect(closed.map((p) => say(m, p.line))).toEqual(before.map((p) => say(m, p.line)))
  })

  it("reads the live library again after Reopen", () => {
    const catalog = library()
    close(catalog, "2026-10-13T08:00:00.000Z")
    markUnusable(catalog, "R")
    catalog.projects[M31] = { ...project(catalog, M31), state: "open", doneAt: null, goalFreeze: null }
    const r = goalProgress(catalog, project(catalog, M31)).find((p) => p.goal.id === "goal_m31_r")!
    expect(r.frozen).toBe(false)
    expect(r.inProject.frames).toBe(0)
    expect(r.met).toBe(false)
  })

  it("freezes into the subject's progress too", () => {
    const catalog = library()
    const before = subject(catalog, M31, "sub_m31")
    close(catalog, "2026-10-13T08:00:00.000Z")
    markUnusable(catalog, "R")
    markUnusable(catalog, "G")
    const after = subject(catalog, M31, "sub_m31")
    expect(after.fraction).toBe(before.fraction)
    expect(say(m, after.ratio!.line)).toBe(say(m, before.ratio!.line))
  })
})

describe("nearestPanel", () => {
  const panels = [
    { id: "p1", ra: 314.0, dec: 44.0 },
    { id: "p2", ra: 316.0, dec: 44.0 },
    { id: "p3", ra: 315.0, dec: 46.0 },
  ]
  const at = (ra: number, dec: number) => ({ ra, dec, rotationDeg: null })

  it("picks the panel whose centre is closest to the pointing", () => {
    expect(nearestPanel(at(315.8, 44.2), panels)?.id).toBe("p2")
    expect(nearestPanel(at(314.9, 45.7), panels)?.id).toBe("p3")
  })

  it("measures right ascension across 0°/360°", () => {
    expect(nearestPanel(at(359.5, 10), [{ id: "east", ra: 1, dec: 10 }, { id: "west", ra: 357, dec: 10 }])?.id).toBe("east")
  })

  it("is null without pointing or panels", () => {
    expect(nearestPanel(null, panels)).toBeNull()
    expect(nearestPanel(at(315, 44), [])).toBeNull()
  })
})
