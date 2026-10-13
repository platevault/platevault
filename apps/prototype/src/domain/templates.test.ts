import { describe, expect, it, vi } from "vitest"
import { m, say } from "@/lib/i18n"
import { numberText, panelBalanceRef, qualityBarRef, windowRuleRef } from "./labels"
import {
  BUILT_IN_GOAL_TEMPLATES,
  clampPanelBalance,
  DEFAULT_PANEL_BALANCE_PCT,
  DEFAULT_SUBJECT_CONDITIONS,
  fwhmBar,
  goalMeasure,
  PANEL_BALANCE_LIMITS,
  qualityBarFor,
  subjectConditions,
  subjectConditionsFrom,
  templateConditions,
} from "./templates"
import type { GoalTemplate, SubjectWindow } from "./types"

const H = 3600
const SEASON: SubjectWindow = { kind: "season", from: "2026-10-13", to: "2027-01-27" }

function template(conditions: GoalTemplate["conditions"]): GoalTemplate {
  return { id: "gtpl_test", name: "Test", source: "user", values: [{ channel: "Ha", integrationS: 4 * H, frameCount: null, qualityBar: qualityBarFor(3.5) }], ...(conditions ? { conditions } : {}) }
}

describe("quality bar (C7)", () => {
  it("is Usable frames, narrowed to FWHM ≤ x″ only when a limit is set", () => {
    expect(qualityBarFor(null)).toEqual({ kind: "usable-only" })
    expect(qualityBarFor(2.5)).toEqual({ kind: "usable-max-fwhm", maxArcsec: 2.5 })
  })

  it("reads back the limit an editor wrote", () => {
    expect(fwhmBar(qualityBarFor(2.5))).toBe(2.5)
    expect(fwhmBar(qualityBarFor(null))).toBeNull()
    expect(fwhmBar(null)).toBeNull()
    expect(fwhmBar({ kind: "max-fwhm", maxArcsec: 4 })).toBe(4)
  })

  it("names the limit in the reader's digits, as precise as it was set", () => {
    expect(say(m, qualityBarRef(qualityBarFor(3.5)))).toBe(m.domain_quality_usable_max_fwhm({ arcsec: "3.5" }))
    expect([numberText(10), numberText(1.1), numberText(5.25)]).toEqual(["10", "1.1", "5.25"])
  })
})

describe("goal fraction", () => {
  const totals = (seconds: number, frames = 0) => ({ seconds, frames })

  it("is the share of the amount in project, 1 exactly when met", () => {
    expect(goalMeasure({ integrationS: 4 * H, frameCount: null }, totals(2 * H), totals(3 * H)).fraction).toBe(0.5)
    expect(goalMeasure({ integrationS: 4 * H, frameCount: null }, totals(5 * H), totals(5 * H)).fraction).toBe(1)
    expect(goalMeasure({ integrationS: null, frameCount: 20 }, totals(0, 5), totals(0, 5)).fraction).toBe(0.25)
  })

  it("is null without an amount", () => {
    expect(goalMeasure({ integrationS: null, frameCount: null }, totals(H, 3), totals(H, 3)).fraction).toBeNull()
  })
})

describe("panel balance setting (C7)", () => {
  it("defaults to ±10 %", () => {
    expect(DEFAULT_PANEL_BALANCE_PCT).toBe(10)
    expect(subjectConditions({ id: "sub", targetId: "tgt", mosaic: null })).toEqual({ panelBalancePct: 10, window: null })
  })

  it("keeps an edit inside its limits", () => {
    expect(clampPanelBalance(15)).toBe(15)
    expect(clampPanelBalance(12.5)).toBe(12.5)
    expect(clampPanelBalance(0)).toBe(PANEL_BALANCE_LIMITS.minPct)
    expect(clampPanelBalance(250)).toBe(PANEL_BALANCE_LIMITS.maxPct)
    expect(clampPanelBalance(Number.NaN)).toBe(DEFAULT_PANEL_BALANCE_PCT)
  })

  it("reads in the catalogue's words", () => {
    expect(say(m, panelBalanceRef(15))).toBe(m.domain_balance_setting({ pct: "15" }))
  })
})

describe("goal templates carry the conditions (C7)", () => {
  it("copies the panel balance and a Finish by night, without pre-filling a season", () => {
    const season = vi.fn(() => SEASON)
    const conditions = subjectConditionsFrom(template({ panelBalancePct: 20, window: { kind: "finish-by", night: "2026-12-31" } }), season)
    expect(conditions).toEqual({ panelBalancePct: 20, window: { kind: "finish-by", night: "2026-12-31" } })
    expect(season).not.toHaveBeenCalled()
  })

  it("pre-fills a season rule from the Target's visibility", () => {
    expect(subjectConditionsFrom(template({ panelBalancePct: 15, window: { kind: "season" } }), () => SEASON)).toEqual({ panelBalancePct: 15, window: SEASON })
  })

  it("leaves the window empty when the Target has no season", () => {
    expect(subjectConditionsFrom(template({ panelBalancePct: 15, window: { kind: "season" } }), () => null).window).toBeNull()
  })

  it("clamps a stored balance as it applies it", () => {
    expect(subjectConditionsFrom(template({ panelBalancePct: 0, window: null }), () => null).panelBalancePct).toBe(PANEL_BALANCE_LIMITS.minPct)
  })

  it("gives the defaults from a template without conditions, a built-in, or no template", () => {
    expect(subjectConditionsFrom(template(undefined), () => SEASON)).toEqual(DEFAULT_SUBJECT_CONDITIONS)
    expect(templateConditions(BUILT_IN_GOAL_TEMPLATES[0]!)).toEqual({ panelBalancePct: 10, window: null })
    expect(subjectConditionsFrom(undefined, () => SEASON)).toEqual(DEFAULT_SUBJECT_CONDITIONS)
  })

  it("names each window rule", () => {
    expect(say(m, windowRuleRef(null))).toBe(m.domain_window_none())
    expect(say(m, windowRuleRef({ kind: "season" }))).toBe(m.domain_window_rule_season())
  })
})
