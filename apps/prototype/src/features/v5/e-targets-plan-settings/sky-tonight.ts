/**
 * Tonight's sky on one grid (slice E, S10 and S11): Sun and Moon altitude
 * samples for the night timeline, a Target's altitude curve, peak altitude
 * in darkness, Moon separation and next opposition.
 *
 * The grid is the planning module's `skyNight`, the samples that
 * `filterSuitability` and `clearStretches` read, on the same 10-minute grid
 * that `computeWindows` and `tonightAt` use, so curves, window blocks and
 * filter windows line up. Production computes all of it in Rust (PLAN-FR-08).
 */
import { altitudeDeg, julianDay, nightAt, norm360, SAMPLE_MIN, type SkyNight, skyNight, sunPosition } from "@/domain/planning"
import { angularSeparationDeg } from "@/domain/sky"
import type { ObservingSite } from "@/domain/types"

/** `sunLimit` follows the site's twilight setting. */
export interface NightGrid extends SkyNight {
  site: ObservingSite
  night: string
  /** Index range shown on the timeline: from sunset to sunrise, padded by 30 minutes. */
  from: number
  to: number
}

/** Tonight's grid at a site: local noon to noon in 10-minute samples, as `tonightAt` uses. */
export function nightGrid(site: ObservingSite, nowMs: number): NightGrid {
  const night = nightAt(nowMs, site)
  const { samples, sunLimit } = skyNight(site, night, site.twilight)
  const below = samples.map((s, i) => (s.sunAlt < 0 ? i : -1)).filter((i) => i >= 0)
  const pad = 30 / SAMPLE_MIN
  const from = below.length > 0 ? Math.max(0, below[0]! - pad) : 0
  const to = below.length > 0 ? Math.min(samples.length - 1, below[below.length - 1]! + pad) : samples.length - 1
  return { site, night, samples, sunLimit, from, to }
}

/** Altitude of a fixed position at every sample of the grid. */
export function altitudeCurve(grid: NightGrid, ra: number, dec: number): number[] {
  return grid.samples.map((s) => altitudeDeg(ra, dec, grid.site.latitude, grid.site.longitude, julianDay(s.ms)))
}

export interface ObjectTonight {
  altitudes: number[]
  /** Peak altitude while dark; null when there is no darkness tonight. */
  peakDarkDeg: number | null
  /** Separation from the Moon in the middle of the darkness window (or of the night). */
  moonSeparationDeg: number
}

export function objectTonight(grid: NightGrid, ra: number, dec: number): ObjectTonight {
  const altitudes = altitudeCurve(grid, ra, dec)
  let peak: number | null = null
  const dark: number[] = []
  grid.samples.forEach((s, i) => {
    if (s.sunAlt > grid.sunLimit) return
    dark.push(i)
    peak = peak === null ? altitudes[i]! : Math.max(peak, altitudes[i]!)
  })
  const mid = grid.samples[dark.length > 0 ? dark[Math.floor(dark.length / 2)]! : Math.floor(grid.samples.length / 2)]!
  return { altitudes, peakDarkDeg: peak, moonSeparationDeg: angularSeparationDeg(ra, dec, mid.moonRa, mid.moonDec) }
}

/** Whether the Moon is above the horizon at an instant on the grid (nearest sample). */
export function moonUpAt(grid: NightGrid, iso: string): boolean {
  const ms = Date.parse(iso)
  const first = grid.samples[0]!.ms
  const index = Math.max(0, Math.min(grid.samples.length - 1, Math.round((ms - first) / (SAMPLE_MIN * 60_000))))
  return grid.samples[index]!.moonAlt > 0
}

/**
 * Next opposition: the first date from now on which the Sun stands opposite
 * the object in right ascension (within half a day). `YYYY-MM-DD`.
 */
export function nextOpposition(ra: number, nowMs: number): string {
  const opposite = norm360(ra + 180)
  let best = { day: 0, gap: 360 }
  for (let day = 0; day <= 366; day += 1) {
    const sun = sunPosition(julianDay(nowMs + day * 86_400_000))
    const gap = Math.abs(((sun.ra - opposite + 540) % 360) - 180)
    if (gap < best.gap) best = { day, gap }
    if (gap < 0.6) break
  }
  return new Date(nowMs + best.day * 86_400_000).toISOString().slice(0, 10)
}
