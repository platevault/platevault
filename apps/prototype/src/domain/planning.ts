/**
 * Observing windows (spec 072). Production computes windows in Rust through
 * the shared skymath contracts (PLAN-FR-08). This is a labelled prototype
 * calculation: low-precision Sun and Moon positions and a 10-minute sample
 * grid, enough to show plausible, criteria-consistent windows. Suitability is
 * astronomical only (PLAN-FR-05). Tonight (PLAN-FR-11) supplies Home's
 * Tonight section and the Plan area: the Moon, the darkness window and the
 * best window per Target. The Moon rule (C6) is one Moon-avoidance curve per
 * filter (`MoonAvoidance`, design/R10-MOON-MODEL.md); `nightImaging` grades
 * the filters and sums Img time from it in one pass.
 */
import { angularSeparationDeg } from "./sky"
import type { Band, CalendarExport, Catalog, MoonConstraint, NightDate, ObservingSite, ObservingWindow, PlanCriteria, ReminderSettings, SiteId, SubjectWindow, Target, TargetId } from "./types"
import { formatCount, formatDateTime } from "@/lib/format"
import { m, msg, type MessageRef } from "@/lib/i18n"

const RAD = Math.PI / 180
/** Minutes between samples of the night grid that windows, Tonight and the Targets timeline share. */
export const SAMPLE_MIN = 10
export const PLAN_NIGHTS = 14

export const norm360 = (deg: number) => ((deg % 360) + 360) % 360

export function julianDay(ms: number): number {
  return ms / 86_400_000 + 2_440_587.5
}

function equatorial(lambdaDeg: number, betaDeg: number, epsDeg: number): { ra: number; dec: number } {
  const l = lambdaDeg * RAD
  const b = betaDeg * RAD
  const e = epsDeg * RAD
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l))
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l))
  return { ra: norm360(ra / RAD), dec: dec / RAD }
}

/** Low-precision Sun ecliptic longitude in degrees (about 0.01°). */
function sunLongitudeDeg(jd: number): number {
  const n = jd - 2_451_545
  const L = norm360(280.46 + 0.985_647_4 * n)
  const g = norm360(357.528 + 0.985_600_3 * n) * RAD
  return L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)
}

/** Low-precision Sun position (about 0.01°). */
export function sunPosition(jd: number): { ra: number; dec: number } {
  return equatorial(sunLongitudeDeg(jd), 0, 23.439 - 0.000_000_4 * (jd - 2_451_545))
}

/** Low-precision Moon ecliptic longitude and latitude in degrees (Astronomical Almanac, about 0.3°). */
function moonEcliptic(jd: number): { lambda: number; beta: number } {
  const T = (jd - 2_451_545) / 36_525
  const s = (deg: number) => Math.sin(deg * RAD)
  const lambda =
    218.32 +
    481_267.881 * T +
    6.29 * s(135 + 477_198.87 * T) -
    1.27 * s(259.3 - 413_335.36 * T) +
    0.66 * s(235.7 + 890_534.22 * T) +
    0.21 * s(269.9 + 954_397.74 * T) -
    0.19 * s(357.5 + 35_999.05 * T) -
    0.11 * s(186.5 + 966_404.03 * T)
  const beta = 5.13 * s(93.3 + 483_202.02 * T) + 0.28 * s(228.2 + 960_400.89 * T) - 0.28 * s(318.3 + 6_003.15 * T) - 0.17 * s(217.6 - 407_332.21 * T)
  return { lambda: norm360(lambda), beta }
}

/** Low-precision Moon position (Astronomical Almanac, about 0.3°). */
export function moonPosition(jd: number): { ra: number; dec: number } {
  const { lambda, beta } = moonEcliptic(jd)
  return equatorial(lambda, beta, 23.439)
}

/**
 * The Moon's age at `jd`: days since new Moon, 0 to `SYNODIC_MONTH_DAYS`,
 * from its lead over the Sun in ecliptic longitude (Target Scheduler reads
 * age the same way, from the Moon's phase angle).
 */
export function moonAgeDays(jd: number): number {
  return (norm360(moonEcliptic(jd).lambda - sunLongitudeDeg(jd)) / 360) * SYNODIC_MONTH_DAYS
}

/** Altitude in degrees of a fixed position at a site and instant. */
export function altitudeDeg(ra: number, dec: number, latDeg: number, lonDeg: number, jd: number): number {
  const gmst = norm360(280.460_618_37 + 360.985_647_366_29 * (jd - 2_451_545))
  const ha = (gmst + lonDeg - ra) * RAD
  const lat = latDeg * RAD
  const d = dec * RAD
  return Math.asin(Math.sin(d) * Math.sin(lat) + Math.cos(d) * Math.cos(lat) * Math.cos(ha)) / RAD
}

/** The criteria behind Img time's altitude, darkness and duration. The Moon fields stay null: the Moon rule is per filter (C6, `nightImaging`). */
export function defaultCriteria(site: ObservingSite | null): PlanCriteria {
  return {
    minAltitudeDeg: site?.minAltitudeDeg ?? 30,
    darkness: site?.twilight ?? "astronomical",
    maxMoonIlluminationPct: null,
    minMoonSeparationDeg: null,
    minDurationMin: 60,
  }
}

/** `YYYY-MM-DD` of the night (evening date) that `ms` belongs to at a site. */
export function nightAt(ms: number, site: ObservingSite): string {
  const local = ms + (site.longitude / 15) * 3_600_000 - 12 * 3_600_000
  return new Date(local).toISOString().slice(0, 10)
}

/** `night` moved by `days`: "2026-10-10" and 1 give "2026-10-11". */
export function shiftNight(night: string, days: number): string {
  return new Date(Date.parse(`${night}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** The first sample of a night's grid: local noon at the site, snapped to `SAMPLE_MIN` so window identities stay stable across clock changes. */
function nightStartMs(site: ObservingSite, night: string): number {
  const base = Date.parse(`${night}T12:00:00Z`) - (site.longitude / 15) * 3_600_000
  return Math.round(base / (SAMPLE_MIN * 60_000)) * SAMPLE_MIN * 60_000
}

/**
 * "Tonight" at a site: the night that holds `ms` until its darkness is over
 * (its Sun, on a night without darkness), then the next night. `nightAt`
 * alone turns over at local noon, so a morning would still read the night
 * that has just ended, with no window left in it.
 */
export function upcomingNight(site: ObservingSite, ms: number): string {
  const night = nightAt(ms, site)
  const sunLimit = site.twilight === "astronomical" ? -18 : -12
  const start0 = nightStartMs(site, night)
  const step = SAMPLE_MIN * 60_000
  let darkEnd: number | null = null
  let sunrise: number | null = null
  for (let i = 0; i <= (24 * 60) / SAMPLE_MIN; i += 1) {
    const t = start0 + i * step
    const jd = julianDay(t)
    const sun = sunPosition(jd)
    const alt = altitudeDeg(sun.ra, sun.dec, site.latitude, site.longitude, jd)
    if (alt <= sunLimit) darkEnd = t + step
    if (alt < 0) sunrise = t + step
  }
  const end = darkEnd ?? sunrise
  return end !== null && ms >= end ? shiftNight(night, 1) : night
}

export function windowKey(targetId: TargetId, siteId: SiteId, start: string): string {
  return `${targetId}/${siteId}/${start}`
}

/**
 * A reminder's delivered identity: Target, site and night (PLAN-AC-07). It
 * survives criteria edits that move the window's start, so the same night is
 * never notified twice.
 */
export function reminderKey(window: ObservingWindow, site: ObservingSite): string {
  return `${window.targetId}/${window.siteId}/${nightAt(Date.parse(window.start), site)}`
}

// ---------------------------------------------------------------------------
// Per-night plans (Round 6): each night has its own plan
// ---------------------------------------------------------------------------

/** The Targets on one night's plan, by name. */
export function nightPlan(catalog: Catalog, night: NightDate): Target[] {
  return Object.values(catalog.plans)
    .filter((p) => p.nights.includes(night))
    .map((p) => catalog.targets[p.targetId])
    .filter((t): t is Target => t !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Every night from `from` on whose plan holds a Target, in order: what reminders and the calendar export cover. */
export function plannedNights(catalog: Catalog, from: NightDate): NightDate[] {
  const nights = new Set<NightDate>()
  for (const plan of Object.values(catalog.plans)) {
    if (!catalog.targets[plan.targetId]) continue
    for (const night of plan.nights) if (night >= from) nights.add(night)
  }
  return [...nights].sort()
}

/** The windows of every upcoming planned night at a site, night by night: the calendar export's events and the reminders' schedule. */
export function plannedWindows(catalog: Catalog, site: ObservingSite, nowMs: number): ObservingWindow[] {
  const criteria = defaultCriteria(site)
  return plannedNights(catalog, upcomingNight(site, nowMs)).flatMap((night) =>
    nightPlan(catalog, night)
      .flatMap((target) => windowsOnNight(target, site, criteria, night, nowMs))
      .sort((a, b) => a.start.localeCompare(b.start)),
  )
}

/**
 * Windows for one Target at one site over the next nights, from `firstNight`
 * (the night that holds `nowMs` by default); a window must end after
 * `nowMs`. Every listed window meets every criterion at each sample it
 * covers.
 */
export function computeWindows(target: Target, site: ObservingSite, criteria: PlanCriteria, nowMs: number, nights = PLAN_NIGHTS, firstNight = nightAt(nowMs, site)): ObservingWindow[] {
  if (target.ra === null || target.dec === null) return []
  const sunLimit = criteria.darkness === "astronomical" ? -18 : -12
  const windows: ObservingWindow[] = []
  for (let n = 0; n < nights; n += 1) {
    const start0 = nightStartMs(site, firstNight) + n * 86_400_000
    let run: { start: number; samples: Array<{ alt: number; illum: number; sep: number }> } | null = null
    const flush = (endMs: number) => {
      if (!run) return
      const durationMin = (endMs - run.start) / 60_000
      if (durationMin >= criteria.minDurationMin && endMs > nowMs) {
        const mid = run.samples[Math.floor(run.samples.length / 2)]!
        const start = new Date(run.start).toISOString()
        windows.push({
          key: windowKey(target.id, site.id, start),
          targetId: target.id,
          siteId: site.id,
          start,
          end: new Date(endMs).toISOString(),
          maxAltitudeDeg: Math.max(...run.samples.map((s) => s.alt)),
          moonIlluminationPct: mid.illum,
          moonSeparationDeg: mid.sep,
        })
      }
      run = null
    }
    for (let i = 0; i <= (24 * 60) / SAMPLE_MIN; i += 1) {
      const t = start0 + i * SAMPLE_MIN * 60_000
      const jd = julianDay(t)
      const sun = sunPosition(jd)
      const dark = altitudeDeg(sun.ra, sun.dec, site.latitude, site.longitude, jd) <= sunLimit
      const alt = dark ? altitudeDeg(target.ra, target.dec, site.latitude, site.longitude, jd) : -90
      let ok = dark && alt >= criteria.minAltitudeDeg
      let illum = 0
      let sep = 180
      if (ok) {
        const moon = moonPosition(jd)
        const moonAlt = altitudeDeg(moon.ra, moon.dec, site.latitude, site.longitude, jd)
        const elongation = angularSeparationDeg(sun.ra, sun.dec, moon.ra, moon.dec)
        illum = Math.round(((1 - Math.cos(elongation * RAD)) / 2) * 100)
        sep = angularSeparationDeg(target.ra, target.dec, moon.ra, moon.dec)
        if (moonAlt > 0) {
          if (criteria.maxMoonIlluminationPct !== null && illum > criteria.maxMoonIlluminationPct) ok = false
          if (criteria.minMoonSeparationDeg !== null && sep < criteria.minMoonSeparationDeg) ok = false
        }
      }
      if (ok) {
        run ??= { start: t, samples: [] }
        run.samples.push({ alt, illum, sep })
      } else flush(t)
    }
    flush(start0 + 24 * 60 * 60_000)
  }
  return windows
}

export interface MoonTonight {
  /** Illuminated fraction at the middle of tonight, 0-100. */
  illuminationPct: number
  /** The phase name: Waxing crescent, Full Moon, … */
  phase: MessageRef
  /** Rise and set during tonight's night (local noon to noon); null when it does not rise or set then. */
  rise: string | null
  set: string | null
}

export interface Tonight {
  night: string
  site: ObservingSite
  moon: MoonTonight
  /** Astronomical (or the site's) darkness window; null when the Sun never gets low enough. */
  darkness: { start: string; end: string } | null
}

function phaseName(elongationDeg: number, waxing: boolean): MessageRef {
  if (elongationDeg < 12) return msg("tonight_moon_phase_new")
  if (elongationDeg > 168) return msg("tonight_moon_phase_full")
  if (elongationDeg >= 80 && elongationDeg <= 100) return msg(waxing ? "tonight_moon_phase_first_quarter" : "tonight_moon_phase_last_quarter")
  if (elongationDeg < 90) return msg(waxing ? "tonight_moon_phase_waxing_crescent" : "tonight_moon_phase_waning_crescent")
  return msg(waxing ? "tonight_moon_phase_waxing_gibbous" : "tonight_moon_phase_waning_gibbous")
}

/** Tonight at a site (`upcomingNight`): the Moon and the darkness window. */
export function tonightAt(site: ObservingSite, nowMs: number): Tonight {
  return nightSummary(site, upcomingNight(site, nowMs))
}

/** One night at a site: the Moon and the darkness window, on the same grid as `computeWindows`. */
export function nightSummary(site: ObservingSite, night: string): Tonight {
  const start0 = nightStartMs(site, night)
  const sunLimit = site.twilight === "astronomical" ? -18 : -12
  let darkStart: number | null = null
  let darkEnd: number | null = null
  let rise: number | null = null
  let set: number | null = null
  let wasUp: boolean | null = null
  const steps = (24 * 60) / SAMPLE_MIN
  for (let i = 0; i <= steps; i += 1) {
    const t = start0 + i * SAMPLE_MIN * 60_000
    const jd = julianDay(t)
    const sun = sunPosition(jd)
    const dark = altitudeDeg(sun.ra, sun.dec, site.latitude, site.longitude, jd) <= sunLimit
    if (dark && darkStart === null) darkStart = t
    if (dark) darkEnd = t
    const moon = moonPosition(jd)
    const up = altitudeDeg(moon.ra, moon.dec, site.latitude, site.longitude, jd) > 0
    if (wasUp !== null && up !== wasUp) {
      if (up && rise === null) rise = t
      if (!up && set === null) set = t
    }
    wasUp = up
  }
  const mid = julianDay(start0 + 12 * 3_600_000)
  const sun = sunPosition(mid)
  const moon = moonPosition(mid)
  const elongation = angularSeparationDeg(sun.ra, sun.dec, moon.ra, moon.dec)
  const later = moonPosition(mid + 0.25)
  const waxing = angularSeparationDeg(sun.ra, sun.dec, later.ra, later.dec) > elongation
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())
  return {
    night,
    site,
    moon: { illuminationPct: Math.round(((1 - Math.cos(elongation * RAD)) / 2) * 100), phase: phaseName(elongation, waxing), rise: iso(rise), set: iso(set) },
    darkness: darkStart !== null && darkEnd !== null ? { start: iso(darkStart)!, end: iso(darkEnd + SAMPLE_MIN * 60_000)! } : null,
  }
}

/** The best window tonight (`upcomingNight`, highest peak altitude) for a Target, or null when it has none tonight. */
export function bestWindowTonight(target: Target, site: ObservingSite, criteria: PlanCriteria, nowMs: number): ObservingWindow | null {
  return windowsOnNight(target, site, criteria, upcomingNight(site, nowMs), nowMs).sort((a, b) => b.maxAltitudeDeg - a.maxAltitudeDeg)[0] ?? null
}

/** A Target's windows on one night that end after `nowMs`: none on a night already past. */
export function windowsOnNight(target: Target, site: ObservingSite, criteria: PlanCriteria, night: string, nowMs: number): ObservingWindow[] {
  return computeWindows(target, site, criteria, nowMs, 1, night)
}

// ---------------------------------------------------------------------------
// Moon avoidance (C6): one Lorentzian curve per filter
// ---------------------------------------------------------------------------

/** Days from new Moon to new Moon (the mean synodic month, Target Scheduler's `DAYS_IN_LUNAR_CYCLE`). */
export const SYNODIC_MONTH_DAYS = 29.530_59

/**
 * One filter's Moon-avoidance curve (C6): the Moon-avoidance Lorentzian of
 * ACP Scheduler's MoonAvoid and N.I.N.A. Target Scheduler's classic
 * avoidance (design/R10-MOON-MODEL.md). The Moon must keep `separationDeg`
 * from the position at full Moon, half that `widthDays` before or after full,
 * and less still as it thins towards new Moon.
 */
export interface MoonAvoidance {
  separationDeg: number
  widthDays: number
}

/** The ranges a curve keeps, Target Scheduler's: separation 0 to 180°, width 1 to 14 days. */
export const MOON_AVOIDANCE_LIMITS = {
  separationDeg: { min: 0, max: 180 },
  widthDays: { min: 1, max: 14 },
} as const

/** A curve inside `MOON_AVOIDANCE_LIMITS`: what an edit stores, so the width never reaches zero. */
export function clampMoonAvoidance(curve: MoonAvoidance): MoonAvoidance {
  const { separationDeg: sep, widthDays: width } = MOON_AVOIDANCE_LIMITS
  return {
    separationDeg: Math.min(sep.max, Math.max(sep.min, curve.separationDeg)),
    widthDays: Math.min(width.max, Math.max(width.min, curve.widthDays)),
  }
}

/**
 * The separation a curve asks at a Moon age, in degrees: the Lorentzian
 * separation / (1 + ((0.5 − age / P) / (width / P))²) with P the synodic
 * month, as ACP's help page computes it and Target Scheduler's
 * `GetMoonAvoidanceLorentzianSeparation` does.
 */
export function requiredMoonSeparationDeg(curve: MoonAvoidance, ageDays: number): number {
  const x = (0.5 - ageDays / SYNODIC_MONTH_DAYS) / (curve.widthDays / SYNODIC_MONTH_DAYS)
  return curve.separationDeg / (1 + x * x)
}

/**
 * Whether the Moon lets a filter image a position at one sample (C6): it is
 * below the horizon, or at least the curve's separation away at its age.
 * Below the horizon the curve does not apply, as Target Scheduler's
 * relaxation turns avoidance off for a low Moon (design/R10-MOON-MODEL.md).
 */
export function moonAllows(curve: MoonAvoidance, sample: Pick<SkySample, "moonAlt" | "moonAgeDays">, separationDeg: number): boolean {
  return sample.moonAlt <= 0 || separationDeg >= requiredMoonSeparationDeg(curve, sample.moonAgeDays)
}

/** One sample of a night on the `computeWindows` grid: the Sun and the Moon at that instant. */
export interface SkySample {
  ms: number
  sunAlt: number
  moonAlt: number
  moonRa: number
  moonDec: number
  /** Moon illumination, 0-100, rounded. */
  moonIllum: number
  /** Moon age in days since new Moon (`moonAgeDays`). */
  moonAgeDays: number
}

/** A night's samples and the Sun altitude below which a sample counts as dark. */
export interface SkyNight {
  samples: SkySample[]
  sunLimit: number
}

/** One night at a site: local noon to noon in `SAMPLE_MIN` samples, dark under `darkness`. */
export function skyNight(site: ObservingSite, night: string, darkness: PlanCriteria["darkness"]): SkyNight {
  const start0 = nightStartMs(site, night)
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
      moonIllum: Math.round(((1 - Math.cos(elongation * RAD)) / 2) * 100),
      moonAgeDays: moonAgeDays(jd),
    })
  }
  return { samples, sunLimit: darkness === "astronomical" ? -18 : -12 }
}

/** A run of consecutive samples; `end` is the end of its last sample. */
export interface Stretch {
  start: string
  end: string
  minutes: number
}

/** Consecutive samples by index, `first` to `last` inclusive. */
interface Run {
  first: number
  last: number
}

/** The runs of samples `0 … count - 1` that `keep` passes, in order. */
function runsWhere(count: number, keep: (index: number) => boolean): Run[] {
  const out: Run[] = []
  let first: number | null = null
  for (let i = 0; i <= count; i += 1) {
    if (i < count && keep(i)) first ??= i
    else if (first !== null) {
      out.push({ first, last: i - 1 })
      first = null
    }
  }
  return out
}

function runMinutes(run: Run): number {
  return (run.last - run.first + 1) * SAMPLE_MIN
}

function runEndMs(sky: SkyNight, run: Run): number {
  return sky.samples[run.first]!.ms + runMinutes(run) * 60_000
}

function stretchOf(sky: SkyNight, run: Run): Stretch {
  return { start: new Date(sky.samples[run.first]!.ms).toISOString(), end: new Date(runEndMs(sky, run)).toISOString(), minutes: runMinutes(run) }
}

/**
 * The stretches of a night in which a position is dark, at or above
 * `minAltitudeDeg`, and clear of the Moon under `limit`: the Moon down, or
 * up but at least the minimum separation away and lit no more than the
 * maximum. Without a limit the Moon is ignored. `altitudes` is the
 * position's altitude at each sample.
 * @deprecated The two independent limits give way to one curve per filter (C6): use `nightImaging`. W3 moves the Targets page; W4 removes this.
 */
export function clearStretches(sky: SkyNight, altitudes: number[], ra: number, dec: number, minAltitudeDeg: number, limit: MoonConstraint | null): Stretch[] {
  return runsWhere(sky.samples.length, (i) => {
    const s = sky.samples[i]!
    if (s.sunAlt > sky.sunLimit || altitudes[i]! < minAltitudeDeg) return false
    return !limit || s.moonAlt <= 0 || (angularSeparationDeg(ra, dec, s.moonRa, s.moonDec) >= limit.minSeparationDeg && s.moonIllum <= limit.maxIlluminationPct)
  }).map((run) => stretchOf(sky, run))
}

/**
 * One band's verdict for one Target and night (`filterSuitability`).
 * @deprecated Use `FilterNight` from `nightImaging` (C6). W4 removes this.
 */
export interface FilterTonight {
  band: Band
  /** A stretch of at least the minimum duration meets the band's Moon constraint that night. */
  good: boolean
  /** Longest such stretch, in minutes. */
  minutes: number
  /** Moon separation at the Target's highest dark sample; null when it never clears the altitude limit in darkness. */
  moonSeparationDeg: number | null
  /** Moon illumination at that sample, 0-100. */
  moonIlluminationPct: number
  /** The Moon is up at that sample. */
  moonUp: boolean
  /** Every stretch that meets the band's Moon constraint that night, in order (`clearStretches`). */
  stretches: Stretch[]
}

/**
 * Per-band suitability of a Target on one night (planning, "good tonight").
 * The night's samples are computed once (`skyNight`); each band's verdict
 * reads its `clearStretches` under the band's Moon constraint, so broadband
 * needs a dark Moon and narrowband tolerates more.
 * @deprecated Grades and Img time come from one Moon curve per filter (C6): use `nightImaging`. W3 moves its callers; W4 removes this.
 */
export function filterSuitability(target: Target, site: ObservingSite, night: string, criteria: PlanCriteria, constraints: Record<Band, MoonConstraint>, bands: Band[]): FilterTonight[] {
  const { ra, dec } = target
  if (ra === null || dec === null) {
    return bands.map((band) => ({ band, good: false, minutes: 0, moonSeparationDeg: null, moonIlluminationPct: 0, moonUp: false, stretches: [] }))
  }
  const sky = skyNight(site, night, criteria.darkness)
  const altitudes = sky.samples.map((s) => altitudeDeg(ra, dec, site.latitude, site.longitude, julianDay(s.ms)))
  // The Target's highest sample in darkness above the altitude limit.
  let peak = -1
  for (const [i, s] of sky.samples.entries()) {
    if (s.sunAlt <= sky.sunLimit && altitudes[i]! >= criteria.minAltitudeDeg && (peak < 0 || altitudes[i]! > altitudes[peak]!)) peak = i
  }
  const at = peak < 0 ? null : sky.samples[peak]!
  return bands.map((band): FilterTonight => {
    const stretches = clearStretches(sky, altitudes, ra, dec, criteria.minAltitudeDeg, constraints[band])
    const minutes = Math.max(0, ...stretches.map((s) => s.minutes))
    return {
      band,
      good: minutes >= criteria.minDurationMin,
      minutes,
      moonSeparationDeg: at ? Math.round(angularSeparationDeg(ra, dec, at.moonRa, at.moonDec)) : null,
      moonIlluminationPct: at?.moonIllum ?? 0,
      moonUp: at ? at.moonAlt > 0 : false,
      stretches,
    }
  })
}

/** How a filter fares on a night: good; marginal, when the Moon takes more than a quarter of the dark time; poor, without a window. */
export type FilterGrade = "good" | "marginal" | "poor"

/** Share of the night's dark time a filter's longest window must keep to grade good. */
const GOOD_SHARE = 0.75

/** A filter's grade from its longest Moon-clear stretch and the night's longest dark stretch, in minutes. */
export function filterGrade(clearMinutes: number, darkMinutes: number, minDurationMin: number): FilterGrade {
  if (clearMinutes < minDurationMin) return "poor"
  return clearMinutes < darkMinutes * GOOD_SHARE ? "marginal" : "good"
}

/** The Moon seen from a position at its highest sample in darkness above the altitude limit (`nightImaging`). */
export interface MoonReading {
  up: boolean
  separationDeg: number
  /** Illumination, 0-100. */
  illuminationPct: number
  ageDays: number
}

/** One filter's night under its Moon-avoidance curve (`nightImaging`). */
export interface FilterNight {
  band: Band
  grade: FilterGrade
  /** Longest stretch the curve allows in darkness above the altitude limit, of any length, in minutes. */
  minutes: number
  /** The stretches of at least the minimum duration: the filter's windows, in order. */
  windows: Stretch[]
  /** The separation the curve asks at the reading's Moon age (`NightImaging.moon`); null without a reading. */
  requiredSeparationDeg: number | null
}

/** A position's night under the Moon rule: each filter's grade and Img time, from the same windows. */
export interface NightImaging {
  filters: FilterNight[]
  /** Longest stretch in darkness above the altitude limit, the Moon aside, in minutes: what a grade measures against. */
  darkMinutes: number
  moon: MoonReading | null
  /** Img time's windows: every filter's windows, merged. */
  windows: Stretch[]
  /** Img time in minutes, the merged windows' total: zero exactly when every filter grades poor. */
  minutes: number
}

/**
 * One position on one night under the Moon rule (C6), so the filter grades
 * and Img time cannot disagree. A filter's windows are the stretches of at
 * least `minDurationMin` in darkness above `minAltitudeDeg` that its curve
 * allows (`moonAllows`); Img time is every filter's windows merged. As in
 * `computeWindows`, only stretches that end after `nowMs` count. `sky` and
 * `altitudes` (the position's altitude at each sample) are computed once per
 * night by the caller.
 */
export function nightImaging(
  sky: SkyNight,
  altitudes: number[],
  position: { ra: number; dec: number },
  criteria: Pick<PlanCriteria, "minAltitudeDeg" | "minDurationMin">,
  curves: Record<Band, MoonAvoidance>,
  bands: Band[],
  nowMs: number,
): NightImaging {
  const count = sky.samples.length
  const dark = sky.samples.map((s, i) => s.sunAlt <= sky.sunLimit && altitudes[i]! >= criteria.minAltitudeDeg)
  const separation = sky.samples.map((s) => angularSeparationDeg(position.ra, position.dec, s.moonRa, s.moonDec))
  const ahead = (runs: Run[]) => runs.filter((run) => runEndMs(sky, run) > nowMs)
  const longest = (runs: Run[]) => Math.max(0, ...runs.map(runMinutes))
  const darkMinutes = longest(ahead(runsWhere(count, (i) => dark[i]!)))
  // The position's highest dark sample: where a verdict reads the Moon.
  let peak = -1
  for (let i = 0; i < count; i += 1) if (dark[i] && (peak < 0 || altitudes[i]! > altitudes[peak]!)) peak = i
  const at = peak < 0 ? null : sky.samples[peak]!
  const inWindow = new Array<boolean>(count).fill(false)
  const filters = bands.map((band): FilterNight => {
    const curve = curves[band]
    const clear = ahead(runsWhere(count, (i) => dark[i]! && moonAllows(curve, sky.samples[i]!, separation[i]!)))
    const windows = clear.filter((run) => runMinutes(run) >= criteria.minDurationMin)
    for (const run of windows) inWindow.fill(true, run.first, run.last + 1)
    const minutes = longest(clear)
    return {
      band,
      grade: filterGrade(minutes, darkMinutes, criteria.minDurationMin),
      minutes,
      windows: windows.map((run) => stretchOf(sky, run)),
      requiredSeparationDeg: at ? requiredMoonSeparationDeg(curve, at.moonAgeDays) : null,
    }
  })
  const imaging = runsWhere(count, (i) => inWindow[i]!)
  return {
    filters,
    darkMinutes,
    moon: at ? { up: at.moonAlt > 0, separationDeg: separation[peak]!, illuminationPct: at.moonIllum, ageDays: at.moonAgeDays } : null,
    windows: imaging.map((run) => stretchOf(sky, run)),
    minutes: imaging.reduce((sum, run) => sum + runMinutes(run), 0),
  }
}

// ---------------------------------------------------------------------------
// Deadline or season window (C7): nights left and the priority rise
// ---------------------------------------------------------------------------

/** Nights a season window looks ahead: a year. */
export const SEASON_SCAN_NIGHTS = 366

/**
 * One night's visibility of a position: the longest stretch, in minutes, in
 * which it is dark and at or above the altitude limit, the Moon aside (a
 * season is about the sky, not the Moon's phase).
 */
export function visibleMinutes(position: { ra: number; dec: number }, site: ObservingSite, criteria: Pick<PlanCriteria, "minAltitudeDeg" | "darkness">, night: NightDate): number {
  const start0 = nightStartMs(site, night)
  const sunLimit = criteria.darkness === "astronomical" ? -18 : -12
  const visible = (i: number) => {
    const jd = julianDay(start0 + i * SAMPLE_MIN * 60_000)
    const sun = sunPosition(jd)
    return altitudeDeg(sun.ra, sun.dec, site.latitude, site.longitude, jd) <= sunLimit && altitudeDeg(position.ra, position.dec, site.latitude, site.longitude, jd) >= criteria.minAltitudeDeg
  }
  return Math.max(0, ...runsWhere((24 * 60) / SAMPLE_MIN + 1, visible).map(runMinutes))
}

/**
 * The season window a subject's editor and a "Season" template rule pre-fill
 * (C7): the run of nights, from `fromNight` on, on which the position is
 * visible for at least `minDurationMin` (`visibleMinutes`). Visible on
 * `fromNight`, it is the rest of the current season; otherwise the next
 * season within the scan. Null when the position is never visible in the
 * scan, or visible on every night of it: a Target up all year has no season.
 */
export function seasonWindow(
  position: { ra: number; dec: number },
  site: ObservingSite,
  criteria: Pick<PlanCriteria, "minAltitudeDeg" | "darkness" | "minDurationMin">,
  fromNight: NightDate,
  scanNights = SEASON_SCAN_NIGHTS,
): SubjectWindow | null {
  let from: NightDate | null = null
  let to: NightDate | null = null
  for (let n = 0; n < scanNights; n += 1) {
    const night = shiftNight(fromNight, n)
    if (visibleMinutes(position, site, criteria, night) >= criteria.minDurationMin) {
      from ??= night
      to = night
    } else if (from !== null && to !== null) return { kind: "season", from, to }
  }
  return from === null || to === null || from === fromNight ? null : { kind: "season", from, to }
}

/** Nights from one night to another: 0 for the same night, negative when `to` is earlier. */
export function nightsBetween(from: NightDate, to: NightDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** Planning raises a subject's priority over the last this-many nights of its window (C7). */
export const PRIORITY_RISE_NIGHTS = 30

/**
 * Planning's priority from a deadline (C7), 0 to 1: 0 while more than
 * `PRIORITY_RISE_NIGHTS` nights are left, then rising by one step a night to
 * 1 on the last night. A window that has passed, or not yet opened, adds
 * nothing: no night left to plan in it.
 */
export function deadlinePriority(nightsLeft: number): number {
  if (nightsLeft <= 0) return 0
  return Math.max(0, Math.min(1, (PRIORITY_RISE_NIGHTS + 1 - nightsLeft) / PRIORITY_RISE_NIGHTS))
}

/** A subject's window seen from tonight (`windowProgress`). */
export interface WindowProgress {
  window: SubjectWindow
  /** "upcoming": a season that opens after tonight; "passed": its last night is before tonight. */
  state: "upcoming" | "open" | "passed"
  /** Nights left to image in it, tonight and the last night included; an upcoming season counts all its nights; 0 once passed. */
  nightsLeft: number
  /** Nights until an upcoming season opens; 0 otherwise. */
  opensIn: number
  /** `deadlinePriority` while the window is open; 0 otherwise. */
  priority: number
  /** "12 nights left", "Opens in 30 nights", "Season over", "Finish-by date passed". */
  line: MessageRef
}

/** Progress shows the nights left and Planning reads the priority (C7). `tonight` is the planning night (`upcomingNight`). */
export function windowProgress(window: SubjectWindow, tonight: NightDate): WindowProgress {
  const last = window.kind === "finish-by" ? window.night : window.to
  const nights = (count: number) => ({ count, n: formatCount(count) })
  if (tonight > last) {
    return { window, state: "passed", nightsLeft: 0, opensIn: 0, priority: 0, line: msg(window.kind === "season" ? "domain_window_season_over" : "domain_window_finish_by_passed") }
  }
  if (window.kind === "season" && tonight < window.from) {
    const opensIn = nightsBetween(tonight, window.from)
    return { window, state: "upcoming", nightsLeft: nightsBetween(window.from, last) + 1, opensIn, priority: 0, line: msg("domain_window_opens_in", nights(opensIn)) }
  }
  const nightsLeft = nightsBetween(tonight, last) + 1
  return { window, state: "open", nightsLeft, opensIn: 0, priority: deadlinePriority(nightsLeft), line: msg("domain_window_nights_left", nights(nightsLeft)) }
}

/** Short zone name at an instant, e.g. "CEST". */
export function zoneAbbreviation(iso: string, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")
  return part?.value ?? timeZone
}

/**
 * The site whose zone PlateVault's clock and reminder times read in: the
 * reminder site while reminders are on, otherwise the default site.
 */
export function reminderSiteOf(sites: Record<SiteId, ObservingSite>, reminders: ReminderSettings, defaultSiteId: SiteId | null): ObservingSite | null {
  const id = reminders.enabled && reminders.siteId ? reminders.siteId : defaultSiteId
  return id ? (sites[id] ?? null) : null
}

/** The zone `formatZonedDateTime` reads in: the given one, else the browser's. */
export function displayZone(timeZone?: string): string {
  return timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Date, time and named zone: "5 Oct 2026, 20:40 CEST". Without a zone, the browser's zone, still named. */
export function formatZonedDateTime(iso: string, timeZone?: string): string {
  const zone = displayZone(timeZone)
  return `${formatDateTime(iso, zone)} ${zoneAbbreviation(iso, zone)}`
}

/** A `datetime-local` value ("2026-10-05T20:40") read as wall-clock time in a zone; null when malformed. */
export function wallTimeToIso(local: string, timeZone?: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(local)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: displayZone(timeZone), year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
  const offset = (ms: number) => {
    const p = Object.fromEntries(format.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]))
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - Math.floor(ms / 60_000) * 60_000
  }
  // Two passes settle the offset across a daylight-saving change.
  let at = wall - offset(wall)
  at = wall - offset(at)
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}

// ---------------------------------------------------------------------------
// Calendar snapshot (PLAN-FR-04)
// ---------------------------------------------------------------------------

function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
}

function icsTime(iso: string): string {
  return `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`
}

/** Fold content lines at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const out: string[] = []
  let rest = line
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 75
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 75) cut -= 1
    out.push(rest.slice(0, cut))
    rest = ` ${rest.slice(cut)}`
  }
  out.push(rest)
  return out.join("\r\n")
}

/**
 * The .ics bytes for a saved export, worded in the current language.
 * Generated only from the snapshot, so a later criteria change never alters
 * a saved file (PLAN-AC-03).
 */
export function calendarFile(exportRecord: CalendarExport, siteName: string, targetNames: Record<TargetId, string>): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PlateVault prototype//Observing plans//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(m.plan_ics_calendar({ site: siteName }))}`,
    `X-WR-TIMEZONE:${exportRecord.timeZone}`,
  ]
  for (const w of exportRecord.windows) {
    const name = targetNames[w.targetId] ?? w.targetId
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsText(w.key)}@platevault.invalid`,
      `DTSTAMP:${icsTime(exportRecord.at)}`,
      `DTSTART:${icsTime(w.start)}`,
      `DTEND:${icsTime(w.end)}`,
      `SUMMARY:${icsText(m.plan_ics_summary({ name }))}`,
      `LOCATION:${icsText(siteName)}`,
      `DESCRIPTION:${icsText(m.plan_ics_description({ altitude: Math.round(w.maxAltitudeDeg), moon: w.moonIlluminationPct, separation: Math.round(w.moonSeparationDeg) }))}`,
      "END:VEVENT",
    )
  }
  lines.push("END:VCALENDAR")
  return `${lines.map(fold).join("\r\n")}\r\n`
}

/** Browser download stands in for the native save dialog in the prototype. */
export function downloadText(fileName: string, text: string, type = "text/calendar") {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
