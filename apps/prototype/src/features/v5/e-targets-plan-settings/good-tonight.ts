/**
 * Per-filter "good tonight" and Img time (slice E: Targets and Target
 * detail), from one Moon rule (C6): `imagingTonight` grades each filter under
 * its Moon-avoidance curve on the chosen night and sums Img time from the
 * same windows (`nightImaging`):
 *
 * - good: a window of the minimum duration clears the filter's curve and
 *   keeps at least three quarters of the dark time above the altitude limit;
 * - marginal: such a window exists, but the Moon takes more than a quarter;
 * - poor: no window of the minimum duration clears the curve.
 *
 * Img time is every filter's windows merged, so it is zero exactly when every
 * chip is poor. A position without a window that night (altitude or
 * darkness) gets no chips: that is not a filter's verdict. The grade is the
 * value; no chip carries a tooltip reason (§6.2).
 */
import { BANDS } from "@/domain/labels"
import { type FilterGrade, type MoonAvoidance, nightImaging, type Stretch } from "@/domain/planning"
import type { Band } from "@/domain/types"
import { m } from "@/lib/i18n"
import type { SkyContext } from "./targets-model"

/** One filter's chip under its Moon-avoidance curve (`imagingTonight`). */
export interface ImagingChip {
  band: Band
  grade: FilterGrade
  /** Longest stretch the curve allows, in minutes. */
  minutes: number
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

function stripOrder(bands: Band[]): Band[] {
  return [...bands].sort((a, b) => BANDS.indexOf(a) - BANDS.indexOf(b))
}

/** "Moon ≥ 120° at full · 14 d": one filter's curve. */
export function avoidanceText(curve: MoonAvoidance): string {
  return m.tonight_avoidance({ separation: curve.separationDeg, width: curve.widthDays })
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
    chips: hasWindow ? night.filters.map((f): ImagingChip => ({ band: f.band, grade: f.grade, minutes: f.minutes })) : null,
    imgTimeS: night.minutes * 60,
    windows: night.windows,
  }
}

/** A band is "ok" tonight when it is good or marginal (the Targets filter, presets). */
export function bandOk(chips: readonly ImagingChip[] | null, band: Band): boolean {
  return chips?.some((c) => c.band === band && c.grade !== "poor") ?? false
}

/**
 * Sort value of a chip strip. With picked bands (Q16): the longest Moon-clear time among them. Without: two
 * points per good and one per marginal band, so the order follows the badges shown (poor is hidden, Q36).
 */
export function chipsScore(chips: readonly ImagingChip[] | null, bands: readonly Band[] = []): number | null {
  if (!chips) return null
  if (bands.length > 0) {
    const picked = chips.filter((c) => bands.includes(c.band))
    return picked.length > 0 ? Math.max(...picked.map((c) => c.minutes)) : null
  }
  return chips.reduce((sum, c) => sum + (c.grade === "good" ? 2 : c.grade === "marginal" ? 1 : 0), 0)
}
