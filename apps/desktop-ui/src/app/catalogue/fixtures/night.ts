/**
 * Night facts for the catalogue's MoonLine, DarkLine, AltitudeSpark and
 * NightCalendar specimens: the Moon's illumination and phase from its mean
 * synodic month, a darkness window that shortens toward midsummer and is
 * absent at a far-north site in June, and altitude curves of three Targets
 * on a 10-minute grid. The figures are a smooth model, not an ephemeris: the
 * specimens show the components' states, never planning truth. Catalogue
 * only.
 */
import type { CalendarNight } from "@/components/domain/night-calendar"
import type { Darkness, MoonTonight, SparkNight, SparkSky } from "@/components/domain/sky-lines"
import { type MessageRef, msg } from "@/lib/i18n"
import { shiftNight } from "@/lib/week"

export interface SampleSite {
  id: string
  name: string
  latitude: number
  timeZone: string
  /** Offset from UTC in hours, for local noon. */
  utcOffsetH: number
  minAltitudeDeg: number
}

export const UTRECHT: SampleSite = { id: "site_utrecht", name: "Utrecht", latitude: 52.09, timeZone: "Europe/Amsterdam", utcOffsetH: 2, minAltitudeDeg: 30 }
export const TROMSO: SampleSite = { id: "site_tromso", name: "Tromsø", latitude: 69.65, timeZone: "Europe/Oslo", utcOffsetH: 2, minAltitudeDeg: 30 }

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const SYNODIC_DAYS = 29.530588
/** A New Moon (2026-09-11, about 03:27 UTC). */
const NEW_MOON_MS = Date.parse("2026-09-11T03:27:00Z")

const noonMs = (site: SampleSite, night: string) => Date.parse(`${night}T12:00:00Z`) - site.utcOffsetH * HOUR_MS

function moonAge(ms: number): number {
  const age = ((ms - NEW_MOON_MS) / DAY_MS) % SYNODIC_DAYS
  return age < 0 ? age + SYNODIC_DAYS : age
}

const PHASES: ReadonlyArray<[number, MessageRef]> = [
  [1.85, msg("tonight_moon_phase_new")],
  [5.54, msg("tonight_moon_phase_waxing_crescent")],
  [9.23, msg("tonight_moon_phase_first_quarter")],
  [12.92, msg("tonight_moon_phase_waxing_gibbous")],
  [16.61, msg("tonight_moon_phase_full")],
  [20.3, msg("tonight_moon_phase_waning_gibbous")],
  [23.99, msg("tonight_moon_phase_last_quarter")],
  [27.68, msg("tonight_moon_phase_waning_crescent")],
  [SYNODIC_DAYS, msg("tonight_moon_phase_new")],
]

/** The Moon at local midnight: illumination, phase, and rise and set about 50 minutes later each night. */
export function moonOn(site: SampleSite, night: string): MoonTonight {
  const midnight = noonMs(site, night) + 12 * HOUR_MS
  const age = moonAge(midnight)
  const illuminationPct = Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC_DAYS)) / 2) * 100)
  const phase = PHASES.find(([until]) => age < until)![1]
  // The Moon transits about 0.8 h later per day of age, from local noon at New Moon.
  const transit = noonMs(site, night) + (age / SYNODIC_DAYS) * 24 * HOUR_MS
  const inNight = (ms: number) => (ms > noonMs(site, night) && ms < noonMs(site, night) + DAY_MS ? new Date(ms).toISOString() : null)
  return { illuminationPct, phase, rise: inNight(transit - 6 * HOUR_MS), set: inNight(transit + 6 * HOUR_MS) }
}

/** Hours of astronomical darkness: longest at the winter solstice, none above the latitude where the Sun stays high in June. */
function darkHours(site: SampleSite, night: string): number {
  const dayOfYear = (Date.parse(`${night}T00:00:00Z`) - Date.parse(`${night.slice(0, 4)}-01-01T00:00:00Z`)) / DAY_MS
  const season = Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365.25) // 1 at the winter solstice, -1 at midsummer
  const latitudeFactor = (site.latitude - 40) / 25
  return Math.max(0, 9 + season * 6 * (0.6 + latitudeFactor) - (site.latitude > 60 ? 4 : 1))
}

/** The night's darkness window, centred on local midnight; null when it never gets dark. */
export function darknessOn(site: SampleSite, night: string): Darkness {
  const hours = darkHours(site, night)
  if (hours < 0.5) return null
  const midnight = noonMs(site, night) + 12 * HOUR_MS
  return { start: new Date(midnight - (hours / 2) * HOUR_MS).toISOString(), end: new Date(midnight + (hours / 2) * HOUR_MS).toISOString() }
}

const STEP_MS = 10 * 60_000

/** The 10-minute grid from local noon to noon; sunset to sunrise is the darkness window widened by two hours. */
export function sparkNight(site: SampleSite, night: string): SparkNight {
  const start = noonMs(site, night)
  const samples = Array.from({ length: DAY_MS / STEP_MS }, (_, i) => ({ ms: start + i * STEP_MS }))
  const dark = darknessOn(site, night)
  const index = (ms: number) => Math.round((ms - start) / STEP_MS)
  const from = dark ? index(Date.parse(dark.start)) - 12 : index(start + 10 * HOUR_MS)
  const to = dark ? index(Date.parse(dark.end)) + 12 : index(start + 14 * HOUR_MS)
  return { samples, from, to }
}

/** A Target transiting at `transitH` hours after local noon at `peakDeg`, setting `peakDeg + 40°` below it twelve hours later. */
export function skyOf(site: SampleSite, night: string, transitH: number, peakDeg: number): SparkSky {
  const grid = sparkNight(site, night)
  const start = noonMs(site, night)
  const altitudes = grid.samples.map(({ ms }) => peakDeg - (peakDeg + 40) * ((1 - Math.cos((2 * Math.PI * ((ms - start) / HOUR_MS - transitH)) / 24)) / 2))
  const dark = darknessOn(site, night)
  if (!dark) return { altitudes, peakDeg: null, peakAt: null, best: null }
  const inDark = grid.samples.map((s, i) => ({ ms: s.ms, alt: altitudes[i]! })).filter((s) => s.ms >= Date.parse(dark.start) && s.ms <= Date.parse(dark.end))
  const peak = inDark.reduce((best, s) => (s.alt > best.alt ? s : best), inDark[0]!)
  const above = inDark.filter((s) => s.alt >= site.minAltitudeDeg)
  return {
    altitudes,
    peakDeg: Math.round(peak.alt),
    peakAt: new Date(peak.ms).toISOString(),
    best: above.length > 0 ? { start: new Date(above[0]!.ms).toISOString(), end: new Date(above.at(-1)!.ms).toISOString() } : null,
  }
}

/** `count` nights from `today`: their Moon and darkness, sample goal and plan counts, and a card body from `card`. */
export function calendarNights(site: SampleSite, today: string, count: number, card: (night: string) => CalendarNight["card"]): CalendarNight[] {
  return Array.from({ length: count }, (_, i): CalendarNight => {
    const night = shiftNight(today, i)
    const moon = moonOn(site, night)
    const dark = darknessOn(site, night)
    return {
      night,
      moon,
      waxing: moonOn(site, shiftNight(night, 1)).illuminationPct > moon.illuminationPct,
      darkS: dark ? (Date.parse(dark.end) - Date.parse(dark.start)) / 1000 : null,
      goals: (i * 5) % 4,
      planned: i % 6 === 0 ? 1 : 0,
      link: { to: "/targets", search: i === 0 ? {} : { night } },
      card: card(night),
    }
  })
}
