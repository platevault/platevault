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
import { filterSuitability } from "@/domain/planning"
import type { Band, MoonConstraint, Target } from "@/domain/types"
import { clearStretches, type Stretch } from "./sky-tonight"
import type { SkyContext } from "./targets-model"

export type FilterGrade = "good" | "marginal" | "poor"

export const GRADE_LABEL: Record<FilterGrade, string> = { good: "Good", marginal: "Marginal", poor: "Poor" }

/** Share of the dark time a band may lose to the Moon and still read good. */
const MARGINAL_SHARE = 0.75

export interface FilterChip {
  band: Band
  grade: FilterGrade
  /** Longest Moon-clear stretch, in minutes (`filterSuitability`). */
  minutes: number
  /** Tooltip line: "OIII good · 7h40 · Moon down". */
  reason: string
  limit: MoonConstraint
  /** Moon-clear stretches tonight, longest first. */
  stretches: Stretch[]
}

export const BAND_ORDER: Band[] = ["L", "R", "G", "B", "Ha", "SII", "OIII"]

/** "Moon ≥ 60° · ≤ 80%": one band's Moon limits. */
export function limitText(limit: MoonConstraint): string {
  return `Moon ≥ ${limit.minSeparationDeg}° · ≤ ${limit.maxIlluminationPct}%`
}

function hours(minutes: number): string {
  return formatHours(minutes * 60)
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
    const moon = f.moonUp ? `Moon ${f.moonSeparationDeg ?? "–"}° · ${f.moonIlluminationPct}%` : "Moon down"
    let reason: string
    if (grade === "good") reason = `${f.band} good · ${hours(f.minutes)} · ${moon}`
    else if (grade === "marginal") reason = `${f.band} marginal · ${hours(f.minutes)} of ${hours(darkMinutes)} clear of the Moon`
    else {
      const failing: string[] = []
      if (f.moonUp && f.moonSeparationDeg !== null && f.moonSeparationDeg < limit.minSeparationDeg) failing.push(`Moon ${f.moonSeparationDeg}°, needs ≥ ${limit.minSeparationDeg}°`)
      if (f.moonUp && f.moonIlluminationPct > limit.maxIlluminationPct) failing.push(`${f.moonIlluminationPct}% lit, max ${limit.maxIlluminationPct}%`)
      if (failing.length === 0) failing.push(f.minutes > 0 ? `${hours(f.minutes)} clear of the Moon, needs ${hours(ctx.criteria.minDurationMin)}` : "Moon up all window")
      reason = `${f.band} poor · ${failing.join(" · ")}`
    }
    const stretches = clearStretches(ctx.grid, altitudes, ra, dec, minAlt, limit).sort((a, b) => b.minutes - a.minutes)
    return { band: f.band, grade, minutes: f.minutes, reason, limit, stretches }
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
