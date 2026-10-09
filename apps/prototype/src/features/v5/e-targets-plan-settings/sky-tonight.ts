/**
 * Tonight's sky on one grid (slice E, S10 and S11): Sun and Moon altitude
 * samples for the night timeline, a Target's altitude curve, peak altitude
 * in darkness, Moon separation, the Moon-clear stretches behind each
 * filter's window, and next opposition.
 *
 * It uses the planning module's Sun, Moon and altitude formulas on the same
 * 10-minute grid that `computeWindows`, `tonightAt` and `filterSuitability`
 * use, so curves, window blocks and filter windows line up. Production
 * computes all of it in Rust (PLAN-FR-08).
 */
import { altitudeDeg, julianDay, moonPosition, nightAt, norm360, SAMPLE_MIN, sunPosition } from "@/domain/planning"
import { angularSeparationDeg } from "@/domain/sky"
import type { MoonConstraint, ObservingSite } from "@/domain/types"

export interface SkySample {
  ms: number
  sunAlt: number
  moonAlt: number
  moonRa: number
  moonDec: number
  /** Moon illumination, 0-100, rounded as `filterSuitability` rounds it. */
  moonIllum: number
}

export interface NightGrid {
  site: ObservingSite
  night: string
  samples: SkySample[]
  /** Sun below this altitude counts as dark under the site's twilight setting. */
  sunLimit: number
  /** Index range shown on the timeline: from sunset to sunrise, padded by 30 minutes. */
  from: number
  to: number
}

/** Tonight's grid at a site: local noon to noon in 10-minute samples, as `tonightAt` uses. */
export function nightGrid(site: ObservingSite, nowMs: number): NightGrid {
  const night = nightAt(nowMs, site)
  const base = Date.parse(`${night}T12:00:00Z`) - (site.longitude / 15) * 3_600_000
  const start0 = Math.round(base / (SAMPLE_MIN * 60_000)) * SAMPLE_MIN * 60_000
  const samples: SkySample[] = []
  for (let i = 0; i <= (24 * 60) / SAMPLE_MIN; i += 1) {
    const ms = start0 + i * SAMPLE_MIN * 60_000
    const jd = julianDay(ms)
    const sun = sunPosition(jd)
    const moon = moonPosition(jd)
    const elongation = angularSeparationDeg(sun.ra, sun.dec, moon.ra, moon.dec)
    samples.push({
      ms,
      sunAlt: altitudeDeg(sun.ra, sun.dec, site.latitude, site.longitude, jd),
      moonAlt: altitudeDeg(moon.ra, moon.dec, site.latitude, site.longitude, jd),
      moonRa: moon.ra,
      moonDec: moon.dec,
      moonIllum: Math.round(((1 - Math.cos((elongation * Math.PI) / 180)) / 2) * 100),
    })
  }
  const below = samples.map((s, i) => (s.sunAlt < 0 ? i : -1)).filter((i) => i >= 0)
  const pad = 30 / SAMPLE_MIN
  const from = below.length > 0 ? Math.max(0, below[0]! - pad) : 0
  const to = below.length > 0 ? Math.min(samples.length - 1, below[below.length - 1]! + pad) : samples.length - 1
  return { site, night, samples, sunLimit: site.twilight === "astronomical" ? -18 : -12, from, to }
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

export interface Stretch {
  start: string
  end: string
  minutes: number
}

/**
 * The stretches of tonight in which a position is dark, at or above
 * `minAltitudeDeg`, and clear of the Moon under `limit`: the Moon down, or
 * up but at least the minimum separation away and lit no more than the
 * maximum. These are the samples `filterSuitability` reads, so the longest
 * stretch equals its `minutes`. Without a limit the Moon is ignored.
 */
export function clearStretches(grid: NightGrid, altitudes: number[], ra: number, dec: number, minAltitudeDeg: number, limit: MoonConstraint | null): Stretch[] {
  const stepMs = SAMPLE_MIN * 60_000
  const out: Stretch[] = []
  let first: number | null = null
  const close = (endIndex: number) => {
    if (first === null) return
    const startMs = grid.samples[first]!.ms
    out.push({ start: new Date(startMs).toISOString(), end: new Date(startMs + (endIndex - first) * stepMs).toISOString(), minutes: (endIndex - first) * SAMPLE_MIN })
    first = null
  }
  grid.samples.forEach((s, i) => {
    let ok = s.sunAlt <= grid.sunLimit && altitudes[i]! >= minAltitudeDeg
    if (ok && limit && s.moonAlt > 0) ok = angularSeparationDeg(ra, dec, s.moonRa, s.moonDec) >= limit.minSeparationDeg && s.moonIllum <= limit.maxIlluminationPct
    if (ok) first ??= i
    else close(i)
  })
  close(grid.samples.length)
  return out
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
