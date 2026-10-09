/**
 * Per-filter "good tonight" (slice E: Targets, Target detail and Plan). Each
 * band is graded from the foundation's `filterSuitability` under that band's
 * Moon constraint (`settings.moonConstraints`), with a one-line reason for
 * its tooltip and the night's Moon-clear stretches for the timeline:
 *
 * - good: a stretch of the minimum duration clears the band's Moon limits
 *   and keeps at least three quarters of the dark time above the altitude
 *   limit;
 * - marginal: such a stretch exists, but the Moon takes more than a quarter;
 * - poor: no stretch of the minimum duration clears the limits.
 *
 * A position without a window tonight (altitude or darkness) gets no chips:
 * that is not a filter's verdict.
 */
import { formatHours } from "@/domain/derive"
import { clearStretches, filterSuitability, type Stretch } from "@/domain/planning"
import type { Band, MoonConstraint, Target } from "@/domain/types"
import { m } from "@/lib/i18n"
import type { SkyContext } from "./targets-model"

export type FilterGrade = "good" | "marginal" | "poor"

/** The grade word: the timeline legend. */
export function gradeLabel(grade: FilterGrade): string {
  return { good: m.tonight_grade_good, marginal: m.tonight_grade_marginal, poor: m.tonight_grade_poor }[grade]()
}

/** Share of the dark time a band may lose to the Moon and still read good. */
const MARGINAL_SHARE = 0.75

export interface FilterChip {
  band: Band
  grade: FilterGrade
  /** Longest Moon-clear stretch, in minutes (`filterSuitability`). */
  minutes: number
  limit: MoonConstraint
  /** Moon-clear stretches tonight, longest first. */
  stretches: Stretch[]
  /** What `filterReason` words: the Moon in the band's longest stretch and the night's dark time. */
  moon: { up: boolean; separationDeg: number | null; illuminationPct: number }
  darkMinutes: number
  minDurationMin: number
}

export const BAND_ORDER: Band[] = ["L", "R", "G", "B", "Ha", "SII", "OIII"]

/** "Moon ≥ 60° · ≤ 80%": one band's Moon limits. */
export function limitText(limit: MoonConstraint): string {
  return m.tonight_limit({ separation: limit.minSeparationDeg, illumination: limit.maxIlluminationPct })
}

function hours(minutes: number): string {
  return formatHours(minutes * 60)
}

/** A chip's tooltip line, in the current language: "OIII good · 7h40 · Moon down", "L poor · Moon 58°, needs ≥ 90° · 78% lit, max 30%". */
export function filterReason(chip: FilterChip): string {
  const { band, limit, moon } = chip
  if (chip.grade === "good") {
    const where = moon.up ? m.tonight_moon_position({ separation: moon.separationDeg ?? "–", illumination: moon.illuminationPct }) : m.tonight_moon_down()
    return m.tonight_reason_good({ band, hours: hours(chip.minutes), moon: where })
  }
  if (chip.grade === "marginal") return m.tonight_reason_marginal({ band, hours: hours(chip.minutes), dark: hours(chip.darkMinutes) })
  const failing: string[] = []
  if (moon.up && moon.separationDeg !== null && moon.separationDeg < limit.minSeparationDeg) failing.push(m.tonight_fail_separation({ separation: moon.separationDeg, min: limit.minSeparationDeg }))
  if (moon.up && moon.illuminationPct > limit.maxIlluminationPct) failing.push(m.tonight_fail_illumination({ illumination: moon.illuminationPct, max: limit.maxIlluminationPct }))
  if (failing.length === 0) failing.push(chip.minutes > 0 ? m.tonight_fail_duration({ hours: hours(chip.minutes), needed: hours(chip.minDurationMin) }) : m.tonight_fail_moon_up())
  return m.tonight_reason_poor({ band, failing: failing.join(" · ") })
}

/**
 * The chips of one position tonight, one per band in strip order, or null
 * when it has no window of the minimum duration in darkness above the
 * altitude limit.
 */
export function filtersTonight(ctx: SkyContext, position: { id: string; ra: number | null; dec: number | null }, altitudes: number[], constraints: Record<Band, MoonConstraint>, bands: Band[]): FilterChip[] | null {
  const { ra, dec } = position
  if (ra === null || dec === null) return null
  const minAlt = ctx.criteria.minAltitudeDeg
  const dark = clearStretches(ctx.grid, altitudes, ra, dec, minAlt, null)
  const darkMinutes = Math.max(0, ...dark.map((s) => s.minutes))
  if (darkMinutes < ctx.criteria.minDurationMin) return null
  const probe: Target = { id: position.id, name: position.id, aliases: [], ra, dec, sizeDeg: null, coordinateSource: "catalog", resolver: null, notes: "", favourite: false, createdAt: "", revision: 1 }
  const ordered = [...bands].sort((a, b) => BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b))
  return filterSuitability(probe, ctx.site, ctx.grid.night, ctx.criteria, constraints, ordered).map((f): FilterChip => {
    const limit = constraints[f.band]
    const grade: FilterGrade = !f.good ? "poor" : f.minutes < darkMinutes * MARGINAL_SHARE ? "marginal" : "good"
    const stretches = f.stretches.sort((a, b) => b.minutes - a.minutes)
    return {
      band: f.band,
      grade,
      minutes: f.minutes,
      limit,
      stretches,
      moon: { up: f.moonUp, separationDeg: f.moonSeparationDeg, illuminationPct: f.moonIlluminationPct },
      darkMinutes,
      minDurationMin: ctx.criteria.minDurationMin,
    }
  })
}

/** A band is "ok" tonight when it is good or marginal (the Targets filter, presets). */
export function bandOk(chips: FilterChip[] | null, band: Band): boolean {
  return chips?.some((c) => c.band === band && c.grade !== "poor") ?? false
}

/** Sort value of a chip strip: a band's minutes, or two points per good and one per marginal band. */
export function chipsScore(chips: FilterChip[] | null, band?: Band): number | null {
  if (!chips) return null
  if (band) return chips.find((c) => c.band === band)?.minutes ?? null
  return chips.reduce((sum, c) => sum + (c.grade === "good" ? 2 : c.grade === "marginal" ? 1 : 0), 0)
}
