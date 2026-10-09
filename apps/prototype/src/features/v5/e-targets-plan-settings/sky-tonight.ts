/**
 * Tonight's sky on one grid (slice E, S10 and S11): Sun and Moon altitude
 * samples for the night timeline, a Target's altitude curve, peak altitude
 * in darkness, Moon separation and next opposition.
 *
 * This repeats the low-precision Sun, Moon and altitude formulas that
 * `src/domain/planning.ts` keeps private, on the same 10-minute grid that
 * `computeWindows` and `tonightAt` use, so curves and window blocks line up.
 * Production computes all of it in Rust (PLAN-FR-08). Foundation candidate:
 * export `sunPosition`, `moonPosition` and `altitudeDeg` from planning.ts and
 * delete the copies here.
 */
import { nightAt } from "@/domain/planning"
import { angularSeparationDeg } from "@/domain/sky"
import type { ObservingSite } from "@/domain/types"

const RAD = Math.PI / 180
export const SAMPLE_MIN = 10
const norm360 = (deg: number) => ((deg % 360) + 360) % 360
const julianDay = (ms: number) => ms / 86_400_000 + 2_440_587.5

function equatorial(lambdaDeg: number, betaDeg: number, epsDeg: number): { ra: number; dec: number } {
  const l = lambdaDeg * RAD
  const b = betaDeg * RAD
  const ep = epsDeg * RAD
  const ra = Math.atan2(Math.sin(l) * Math.cos(ep) - Math.tan(b) * Math.sin(ep), Math.cos(l))
  const dec = Math.asin(Math.sin(b) * Math.cos(ep) + Math.cos(b) * Math.sin(ep) * Math.sin(l))
  return { ra: norm360(ra / RAD), dec: dec / RAD }
}

function sunPosition(jd: number) {
  const n = jd - 2_451_545
  const L = norm360(280.46 + 0.985_647_4 * n)
  const g = norm360(357.528 + 0.985_600_3 * n) * RAD
  return equatorial(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g), 0, 23.439 - 0.000_000_4 * n)
}

function moonPosition(jd: number) {
  const T = (jd - 2_451_545) / 36_525
  const s = (deg: number) => Math.sin(deg * RAD)
  const lambda =
    218.32 + 481_267.881 * T + 6.29 * s(135 + 477_198.87 * T) - 1.27 * s(259.3 - 413_335.36 * T) + 0.66 * s(235.7 + 890_534.22 * T) +
    0.21 * s(269.9 + 954_397.74 * T) - 0.19 * s(357.5 + 35_999.05 * T) - 0.11 * s(186.5 + 966_404.03 * T)
  const beta = 5.13 * s(93.3 + 483_202.02 * T) + 0.28 * s(228.2 + 960_400.89 * T) - 0.28 * s(318.3 + 6_003.15 * T) - 0.17 * s(217.6 - 407_332.21 * T)
  return equatorial(norm360(lambda), beta, 23.439)
}

function altitudeDeg(ra: number, dec: number, latDeg: number, lonDeg: number, jd: number): number {
  const gmst = norm360(280.460_618_37 + 360.985_647_366_29 * (jd - 2_451_545))
  const ha = (gmst + lonDeg - ra) * RAD
  const lat = latDeg * RAD
  const d = dec * RAD
  return Math.asin(Math.sin(d) * Math.sin(lat) + Math.cos(d) * Math.cos(lat) * Math.cos(ha)) / RAD
}

export interface SkySample {
  ms: number
  sunAlt: number
  moonAlt: number
  moonRa: number
  moonDec: number
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
    samples.push({
      ms,
      sunAlt: altitudeDeg(sun.ra, sun.dec, site.latitude, site.longitude, jd),
      moonAlt: altitudeDeg(moon.ra, moon.dec, site.latitude, site.longitude, jd),
      moonRa: moon.ra,
      moonDec: moon.dec,
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
