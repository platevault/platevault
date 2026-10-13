/**
 * Per-filter "good tonight" and Img time (slice E: Targets and Target
 * detail), from one Moon rule (C6): `imagingTonight` grades each filter under
 * its Moon-avoidance curve on the chosen night and sums Img time from the
 * same windows (`nightImaging`), with a one-line reason per chip for its
 * tooltip:
 *
 * - good: a window of the minimum duration clears the filter's curve and
 *   keeps at least three quarters of the dark time above the altitude limit;
 * - marginal: such a window exists, but the Moon takes more than a quarter;
 * - poor: no window of the minimum duration clears the curve.
 *
 * Img time is every filter's windows merged, so it is zero exactly when every
 * chip is poor. A position without a window that night (altitude or
 * darkness) gets no chips: that is not a filter's verdict.
 *
 * `filtersTonight` and its chips still grade under the old per-band limits
 * (`settings.moonConstraints`) until W3 moves the Targets page.
 */
import { formatHours } from "@/domain/derive"
import { BANDS } from "@/domain/labels"
import { clearStretches, filterGrade, type FilterGrade, filterSuitability, type MoonAvoidance, type MoonReading, nightImaging, type Stretch } from "@/domain/planning"
import type { Band, MoonConstraint, Target } from "@/domain/types"
import { m } from "@/lib/i18n"
import type { SkyContext } from "./targets-model"

/** @deprecated Import `FilterGrade` from `@/domain/planning`; W3 moves the imports. */
export type { FilterGrade }

/** What `bandOk` and `chipsScore` read from a chip of either kind. */
type GradedBand = { band: Band; grade: FilterGrade; minutes: number }

/** One filter's chip under its Moon-avoidance curve (`imagingTonight`). */
export interface ImagingChip {
  band: Band
  grade: FilterGrade
  /** Longest stretch the curve allows, in minutes. */
  minutes: number
  curve: MoonAvoidance
  /** The separation the curve asks at the reading's Moon age; null without a reading. */
  requiredSeparationDeg: number | null
  /** The Moon at the position's highest dark sample. */
  moon: MoonReading | null
  darkMinutes: number
  minDurationMin: number
}

/** A position on the chosen night under the Moon rule: its chips and its Img time, from the same windows. */
export interface ImagingTonight {
  /** One chip per band in strip order; null without a window of the minimum duration in darkness above the altitude limit. */
  chips: ImagingChip[] | null
  /** Img time in seconds: every chip's windows merged, so zero exactly when every chip is poor. */
  imgTimeS: number
  /** Img time's windows, in order. */
  windows: Stretch[]
}

function hours(minutes: number): string {
  return formatHours(minutes * 60)
}

function stripOrder(bands: Band[]): Band[] {
  return [...bands].sort((a, b) => BANDS.indexOf(a) - BANDS.indexOf(b))
}

/** "Moon ≥ 120° at full · 14 d": one filter's curve. */
export function avoidanceText(curve: MoonAvoidance): string {
  return m.tonight_avoidance({ separation: curve.separationDeg, width: curve.widthDays })
}

/** A chip's tooltip line, in the current language: "OIII good · 7h40 · Moon down", "L poor · Moon 58°, needs ≥ 94°". */
export function imagingReason(chip: ImagingChip): string {
  const { band, moon } = chip
  if (chip.grade === "good") {
    const where = moon?.up ? m.tonight_moon_position({ separation: Math.round(moon.separationDeg), illumination: moon.illuminationPct }) : m.tonight_moon_down()
    return m.tonight_reason_good({ band, hours: hours(chip.minutes), moon: where })
  }
  if (chip.grade === "marginal") return m.tonight_reason_marginal({ band, hours: hours(chip.minutes), dark: hours(chip.darkMinutes) })
  const need = chip.requiredSeparationDeg
  // Floor and ceiling keep the worded separation below the worded need.
  const failing =
    moon?.up && need !== null && moon.separationDeg < need
      ? m.tonight_fail_separation({ separation: Math.floor(moon.separationDeg), min: Math.ceil(need) })
      : chip.minutes > 0
        ? m.tonight_fail_duration({ hours: hours(chip.minutes), needed: hours(chip.minDurationMin) })
        : m.tonight_fail_moon_up()
  return m.tonight_reason_poor({ band, failing })
}

/**
 * One position on the chosen night: a chip per band in strip order under
 * that band's curve, and Img time from the same windows (`nightImaging`).
 * `altitudes` is the position's altitude at each sample of `ctx.grid`.
 */
export function imagingTonight(ctx: SkyContext, position: { ra: number; dec: number }, altitudes: number[], curves: Record<Band, MoonAvoidance>, bands: Band[]): ImagingTonight {
  const night = nightImaging(ctx.grid, altitudes, position, ctx.criteria, curves, stripOrder(bands), ctx.nowMs)
  const hasWindow = night.darkMinutes >= ctx.criteria.minDurationMin
  return {
    chips: hasWindow
      ? night.filters.map(
          (f): ImagingChip => ({
            band: f.band,
            grade: f.grade,
            minutes: f.minutes,
            curve: curves[f.band],
            requiredSeparationDeg: f.requiredSeparationDeg,
            moon: night.moon,
            darkMinutes: night.darkMinutes,
            minDurationMin: ctx.criteria.minDurationMin,
          }),
        )
      : null,
    imgTimeS: night.minutes * 60,
    windows: night.windows,
  }
}

/** A band is "ok" tonight when it is good or marginal (the Targets filter, presets). */
export function bandOk(chips: readonly GradedBand[] | null, band: Band): boolean {
  return chips?.some((c) => c.band === band && c.grade !== "poor") ?? false
}

/** Sort value of a chip strip: a band's minutes, or two points per good and one per marginal band. */
export function chipsScore(chips: readonly GradedBand[] | null, band?: Band): number | null {
  if (!chips) return null
  if (band) return chips.find((c) => c.band === band)?.minutes ?? null
  return chips.reduce((sum, c) => sum + (c.grade === "good" ? 2 : c.grade === "marginal" ? 1 : 0), 0)
}

// ---------------------------------------------------------------------------
// Old per-band limits (separation ≥ and illumination ≤), until W3
// ---------------------------------------------------------------------------

/** @deprecated Use `ImagingChip` (`imagingTonight`, C6). W4 removes this. */
export interface FilterChip {
  band: Band
  grade: FilterGrade
  /** Longest Moon-clear stretch, in minutes (`filterSuitability`). */
  minutes: number
  limit: MoonConstraint
  /** What `filterReason` words: the Moon in the band's longest stretch and the night's dark time. */
  moon: { up: boolean; separationDeg: number | null; illuminationPct: number }
  darkMinutes: number
  minDurationMin: number
}

/** @deprecated Use `BANDS` from `@/domain/labels`, the same strip order; W3 moves the imports. */
export const BAND_ORDER: Band[] = BANDS

/**
 * "Moon ≥ 60° · ≤ 80%": one band's Moon limits.
 * @deprecated Use `avoidanceText` (C6). W4 removes this.
 */
export function limitText(limit: MoonConstraint): string {
  return m.tonight_limit({ separation: limit.minSeparationDeg, illumination: limit.maxIlluminationPct })
}

/**
 * A chip's tooltip line, in the current language: "OIII good · 7h40 · Moon down", "L poor · Moon 58°, needs ≥ 90° · 78% lit, max 30%".
 * @deprecated Use `imagingReason` (C6). W4 removes this.
 */
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
 * The chips of one position on the chosen night, one per band in strip
 * order, or null when it has no window of the minimum duration in darkness
 * above the altitude limit.
 * @deprecated Grades the old two limits while Img time ignores the Moon; use `imagingTonight`, which takes both from one curve per filter (C6). W3 moves the Targets page; W4 removes this.
 */
export function filtersTonight(ctx: SkyContext, position: { id: string; ra: number | null; dec: number | null }, altitudes: number[], constraints: Record<Band, MoonConstraint>, bands: Band[]): FilterChip[] | null {
  const { ra, dec } = position
  if (ra === null || dec === null) return null
  const minAlt = ctx.criteria.minAltitudeDeg
  const dark = clearStretches(ctx.grid, altitudes, ra, dec, minAlt, null)
  const darkMinutes = Math.max(0, ...dark.map((s) => s.minutes))
  if (darkMinutes < ctx.criteria.minDurationMin) return null
  const probe: Target = { id: position.id, name: position.id, aliases: [], ra, dec, sizeDeg: null, coordinateSource: "catalog", resolver: null, notes: "", favourite: false, createdAt: "", revision: 1 }
  return filterSuitability(probe, ctx.site, ctx.grid.night, ctx.criteria, constraints, stripOrder(bands)).map(
    (f): FilterChip => ({
      band: f.band,
      grade: filterGrade(f.minutes, darkMinutes, ctx.criteria.minDurationMin),
      minutes: f.minutes,
      limit: constraints[f.band],
      moon: { up: f.moonUp, separationDeg: f.moonSeparationDeg, illuminationPct: f.moonIlluminationPct },
      darkMinutes,
      minDurationMin: ctx.criteria.minDurationMin,
    }),
  )
}
