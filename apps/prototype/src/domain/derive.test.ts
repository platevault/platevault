import { beforeAll, describe, expect, it } from "vitest"
import { m, say } from "@/lib/i18n"
import { closeSnapshot, goalProgress, panelBalance, planningPriorities, subjectProgress, type GoalProgress } from "./derive"
import { defaultCriteria, seasonWindow } from "./planning"
import { createSeed } from "./seed"
import { qualityBarFor, subjectConditionsFrom } from "./templates"
import type { AssetId, Catalog, Project, ProjectGroup } from "./types"

// Goal conditions (C7, HARNESS-V5-FEEDBACK-R1.md "Goals, grilling round 4") on the demo library.
const TONIGHT = "2026-10-13"
const CYGNUS = "prj_cygnus"
const MOSAIC_PROJECT = "prj_ic5070"
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

/** Every frame of the sessions a Project holds. */
function heldFrames(catalog: Catalog, projectId: string): AssetId[] {
  return project(catalog, projectId).inputs.flatMap((input) => catalog.sessions[input.sessionId]?.assetIds ?? [])
}

/** The library marks every held frame of one channel Unusable. */
function markUnusable(catalog: Catalog, projectId: string, channel: string) {
  for (const id of heldFrames(catalog, projectId)) {
    const asset = catalog.assets[id]!
    if (catalog.sessions[asset.sessionId!]!.channel === channel) catalog.assets[id] = { ...asset, quality: { ...asset.quality, value: "unusable" } }
  }
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
    expect(progressOf(catalog, M31, "goal_m31_r").met).toBe(true)
    markUnusable(catalog, M31, "R")
    const after = progressOf(catalog, M31, "goal_m31_r")
    expect(after.inProject.frames).toBe(0)
    expect(after.belowBar.frames).toBe(0)
    expect(after.met).toBe(false)
  })
})

describe("mosaic panel balance (C7)", () => {
  const panel = (n: number): ProjectGroup => ({ id: `grp_${n}`, name: `Panel ${n}`, panel: true, createdAt: "2026-09-12T19:00:00.000Z" })
  const shares = (amounts: number[]) => amounts.map((counted, i) => ({ panel: panel(i + 1), counted }))

  it("keeps every panel within ±10 % of the panels' mean by default", () => {
    expect(panelBalance("Ha", "time", shares([100, 95, 105]), 10).balanced).toBe(true)
    const off = panelBalance("Ha", "time", shares([100, 80, 100]), 10)
    expect(off.balanced).toBe(false)
    expect(off.furthest?.panel.name).toBe("Panel 2")
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

  it("compares counted integration per panel group on the demo mosaic, at the default and an edited percentage", () => {
    const catalog = library()
    const ha = () => subject(catalog, MOSAIC_PROJECT, MOSAIC).channels.find((c) => c.channel === "Ha")!.balance!
    const perPanel = goalProgress(catalog, project(catalog, MOSAIC_PROJECT)).filter((p) => p.goal.channel === "Ha")
    // Each panel group counts only its own sessions: Panel 3 joined with one Ha session.
    expect(ha().unit).toBe("time")
    expect(ha().panels.map((p) => p.panel.name)).toEqual(["Panel 1", "Panel 2", "Panel 3"])
    expect(ha().panels.map((p) => p.counted)).toEqual(perPanel.map((p) => p.inProject.seconds))
    expect(ha().tolerancePct).toBe(10)
    const worst = Math.max(...ha().panels.map((p) => Math.abs(p.deviationPct)))
    expect(ha().balanced).toBe(worst <= 10)
    setConditions(catalog, MOSAIC_PROJECT, MOSAIC, { panelBalancePct: Math.ceil(worst) + 1, window: null })
    expect(ha().balanced).toBe(true)
  })

  it("compares frames when every panel goal counts frames", () => {
    const catalog = library()
    setGoals(catalog, MOSAIC_PROJECT, (g) => (g.channel === "Ha" ? { ...g, integrationS: null, frameCount: 40 } : g))
    const ha = subject(catalog, MOSAIC_PROJECT, MOSAIC).channels.find((c) => c.channel === "Ha")!.balance!
    expect(ha.unit).toBe("frames")
    expect(ha.panels.map((p) => p.counted)).toEqual(goalProgress(catalog, project(catalog, MOSAIC_PROJECT)).filter((p) => p.goal.channel === "Ha").map((p) => p.inProject.frames))
  })
})

describe("mosaic coverage: weakest panel and completion (C7)", () => {
  it("shows the weakest panel group while any panel is short", () => {
    const progress = subject(library(), MOSAIC_PROJECT, MOSAIC)
    expect(progress.complete).toBe(false)
    // Panel 3 holds no OIII session, so its OIII goal is at 0 %.
    expect(progress.weakestPanel?.name).toBe("Panel 3")
    // A mosaic's fraction is its weakest panel's mean over that panel's goals.
    const panel3 = goalProgress(library(), project(library(), MOSAIC_PROJECT)).filter((p) => p.goal.groupId === "grp_ic5070_p3").map((p) => p.measure.fraction ?? 0)
    expect(progress.fraction).toBeCloseTo(panel3.reduce((n, f) => n + f, 0) / panel3.length, 9)
    expect(say(m, progress.line!)).toBe(`${Math.floor(progress.fraction! * 100)}% · weakest Panel 3`)
  })

  it("completes only when every panel meets its goals", () => {
    const catalog = library()
    // Each panel's goals at exactly what it holds in project; Panel 3 has no OIII, so its OIII goal goes.
    const held = new Map(goalProgress(catalog, project(catalog, MOSAIC_PROJECT)).map((p) => [p.goal.id, p.inProject.frames]))
    setGoals(catalog, MOSAIC_PROJECT, (g) => (held.get(g.id) ? { ...g, integrationS: null, frameCount: held.get(g.id)! } : null))
    const done = subject(catalog, MOSAIC_PROJECT, MOSAIC)
    expect(done.complete).toBe(true)
    expect(done.fraction).toBe(1)
    setGoals(catalog, MOSAIC_PROJECT, (g) => (g.id === "goal_grp_ic5070_p2_oiii" ? { ...g, frameCount: g.frameCount! + 1 } : g))
    const short = subject(catalog, MOSAIC_PROJECT, MOSAIC)
    expect(short.complete).toBe(false)
    expect(short.weakestPanel?.name).toBe("Panel 2")
    expect(short.channels.find((c) => c.channel === "OIII")!.weakest.goal.id).toBe("goal_grp_ic5070_p2_oiii")
  })

  it("never completes a subject without goals", () => {
    const catalog = library()
    setGoals(catalog, MOSAIC_PROJECT, () => null)
    expect(subject(catalog, MOSAIC_PROJECT, MOSAIC)).toMatchObject({ complete: false, fraction: null, line: null })
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
    expect(say(m, ratio.line)).toBe(`Ha ${(ha / Math.min(ha, oiii)).toFixed(1)} : OIII ${(oiii / Math.min(ha, oiii)).toFixed(1)} counted · goals Ha 1.0 : OIII 1.0`)
  })

  it("adds a mosaic's panels per channel", () => {
    const catalog = library()
    const mosaic = subject(catalog, MOSAIC_PROJECT, MOSAIC).ratio!
    const sum = (channel: string) => mosaic.counted.find((p) => p.channel === channel)!.amount
    const goals = goalProgress(catalog, project(catalog, MOSAIC_PROJECT)).filter((p) => p.goal.subjectId === MOSAIC)
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
    setConditions(catalog, MOSAIC_PROJECT, MOSAIC, { panelBalancePct: 10, window: { kind: "season", from: "2026-10-01", to: "2027-01-27" } })
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
    setConditions(catalog, MOSAIC_PROJECT, MOSAIC, { panelBalancePct: 10, window: { kind: "finish-by", night: "2026-10-20" } })
    setGoals(catalog, MOSAIC_PROJECT, (g) => (g.subjectId === MOSAIC ? { ...g, integrationS: 0 } : g))
    expect(planningPriorities(catalog, TONIGHT)).toEqual([])
  })

  it("comes from a template's season rule, pre-filled from the Target's visibility", () => {
    const catalog = library()
    const template = catalog.goalTemplates.gtpl_user_hoo_mosaic!
    const site = catalog.sites.site_backyard!
    const target = catalog.targets[project(catalog, MOSAIC_PROJECT).subjects.find((s) => s.id === MOSAIC)!.targetId]!
    const conditions = subjectConditionsFrom(template, () => seasonWindow({ ra: target.ra!, dec: target.dec! }, site, defaultCriteria(site), TONIGHT))
    expect(conditions.panelBalancePct).toBe(15)
    expect(conditions.window).toMatchObject({ kind: "season", from: TONIGHT })
    expect(template.values.every((v) => v.qualityBar?.kind === "usable-max-fwhm")).toBe(true)
  })
})

describe("goals freeze when the Project closes (C7)", () => {
  function close(catalog: Catalog, at: string) {
    const p = project(catalog, M31)
    catalog.projects[M31] = { ...p, state: "closed", closedAt: at, snapshot: closeSnapshot(catalog, p, at) }
  }

  it("keeps the figures from Close while the library changes", () => {
    const catalog = library()
    const before = goalProgress(catalog, project(catalog, M31))
    close(catalog, "2026-10-13T08:00:00.000Z")
    markUnusable(catalog, M31, "R")
    const closed = goalProgress(catalog, project(catalog, M31))
    expect(closed.every((p) => p.frozen)).toBe(true)
    expect(closed.map((p) => [p.inProject, p.captured, p.belowBar, p.met])).toEqual(before.map((p) => [p.inProject, p.captured, p.belowBar, p.met]))
    expect(closed.map((p) => say(m, p.line))).toEqual(before.map((p) => say(m, p.line)))
  })

  it("reads the live library while the Project is open", () => {
    const catalog = library()
    markUnusable(catalog, M31, "R")
    const r = goalProgress(catalog, project(catalog, M31)).find((p) => p.goal.id === "goal_m31_r")!
    expect(r.frozen).toBe(false)
    expect(r.inProject.frames).toBe(0)
    expect(r.met).toBe(false)
  })

  it("freezes into the subject's progress too", () => {
    const catalog = library()
    const before = subject(catalog, M31, "sub_m31")
    close(catalog, "2026-10-13T08:00:00.000Z")
    markUnusable(catalog, M31, "R")
    markUnusable(catalog, M31, "G")
    const after = subject(catalog, M31, "sub_m31")
    expect(after.fraction).toBe(before.fraction)
    expect(say(m, after.ratio!.line)).toBe(say(m, before.ratio!.line))
  })
})
