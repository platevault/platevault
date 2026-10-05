/**
 * Observing windows (spec 072). Production computes windows in Rust through
 * the shared skymath contracts (PLAN-FR-08). This is a labelled prototype
 * calculation: low-precision Sun and Moon positions and a 10-minute sample
 * grid, enough to show plausible, criteria-consistent windows. Suitability is
 * astronomical only (PLAN-FR-05).
 */
import { angularSeparationDeg } from "@/domain/sky"
import type { CalendarExport, ObservingSite, ObservingWindow, PlanCriteria, ReminderSettings, SiteId, Target, TargetId } from "@/domain/types"
import { formatDateTime } from "@/lib/format"

const RAD = Math.PI / 180
const SAMPLE_MIN = 10
export const PLAN_NIGHTS = 14

const norm360 = (deg: number) => ((deg % 360) + 360) % 360

function julianDay(ms: number): number {
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

/** Low-precision Sun position (about 0.01°). */
function sunPosition(jd: number) {
  const n = jd - 2_451_545
  const L = norm360(280.46 + 0.985_647_4 * n)
  const g = norm360(357.528 + 0.985_600_3 * n) * RAD
  const lambda = L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)
  return equatorial(lambda, 0, 23.439 - 0.000_000_4 * n)
}

/** Low-precision Moon position (Astronomical Almanac, about 0.3°). */
function moonPosition(jd: number) {
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
  return equatorial(norm360(lambda), beta, 23.439)
}

function altitudeDeg(ra: number, dec: number, latDeg: number, lonDeg: number, jd: number): number {
  const gmst = norm360(280.460_618_37 + 360.985_647_366_29 * (jd - 2_451_545))
  const ha = (gmst + lonDeg - ra) * RAD
  const lat = latDeg * RAD
  const d = dec * RAD
  return Math.asin(Math.sin(d) * Math.sin(lat) + Math.cos(d) * Math.cos(lat) * Math.cos(ha)) / RAD
}

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

/**
 * Windows for one Target at one site over the next nights. Every listed window
 * meets every criterion at each sample it covers.
 */
export function computeWindows(target: Target, site: ObservingSite, criteria: PlanCriteria, nowMs: number, nights = PLAN_NIGHTS): ObservingWindow[] {
  if (target.ra === null || target.dec === null) return []
  const sunLimit = criteria.darkness === "astronomical" ? -18 : -12
  const firstNight = nightAt(nowMs, site)
  const windows: ObservingWindow[] = []
  for (let n = 0; n < nights; n += 1) {
    const base = Date.parse(`${firstNight}T12:00:00Z`) + n * 86_400_000 - (site.longitude / 15) * 3_600_000
    // Snap the grid so window identities stay stable across clock changes.
    const start0 = Math.round(base / (SAMPLE_MIN * 60_000)) * SAMPLE_MIN * 60_000
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

export function criteriaSummary(c: PlanCriteria): string {
  const parts = [`altitude ≥ ${c.minAltitudeDeg}°`, c.darkness === "astronomical" ? "astronomical darkness" : "nautical darkness", `at least ${c.minDurationMin} min`]
  if (c.maxMoonIlluminationPct !== null) parts.push(`Moon ≤ ${c.maxMoonIlluminationPct}% when up`)
  if (c.minMoonSeparationDeg !== null) parts.push(`Moon ≥ ${c.minMoonSeparationDeg}° away when up`)
  return parts.join(", ")
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
 * The .ics bytes for a saved export. Generated only from the snapshot, so a
 * later criteria change never alters a saved file (PLAN-AC-03).
 */
export function calendarFile(exportRecord: CalendarExport, siteName: string, targetNames: Record<TargetId, string>): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PlateVault prototype//Observing plans//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`PlateVault windows at ${siteName}`)}`,
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
      `SUMMARY:${icsText(`${name} observing window at ${siteName}`)}`,
      `LOCATION:${icsText(siteName)}`,
      `DESCRIPTION:${icsText(
        `Astronomical suitability only: no weather, equipment or processing readiness. Max altitude ${Math.round(w.maxAltitudeDeg)}°. Moon ${w.moonIlluminationPct}% illuminated, ${Math.round(w.moonSeparationDeg)}° away. Times shown in ${exportRecord.timeZone}. Prototype calculation.`,
      )}`,
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
