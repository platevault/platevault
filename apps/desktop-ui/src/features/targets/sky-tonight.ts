/**
 * Tonight's sky as the library computed it, in the shape the night visuals
 * take (components/domain/sky-lines.tsx). The Moon and the darkness window
 * appear once, in the Targets toolbar and on a Target page, for the page's
 * night at its planning site (PLAN-TGT-FR-07); no row repeats them. A row's
 * altitude sparkline plots the library's samples across the night
 * (PLAN-TGT-FR-04). This module only reshapes the library's values; the one
 * value it reads off them is when the peak in darkness falls, from the
 * samples (see `sparkOf`).
 */
import type { DarknessWindow_Serialize, MoonPhase, NightMoon_Serialize, TargetRow_Serialize, TargetsBasis_Serialize } from "@/api/ipc"
import type { Darkness, MoonTonight, SparkNight, SparkSky } from "@/components/domain/sky-lines"
import { type MessageRef, msg } from "@/lib/i18n"

const PHASE: Record<MoonPhase, MessageRef> = {
  new: msg("tonight_moon_phase_new"),
  waxing_crescent: msg("tonight_moon_phase_waxing_crescent"),
  first_quarter: msg("tonight_moon_phase_first_quarter"),
  waxing_gibbous: msg("tonight_moon_phase_waxing_gibbous"),
  full: msg("tonight_moon_phase_full"),
  waning_gibbous: msg("tonight_moon_phase_waning_gibbous"),
  last_quarter: msg("tonight_moon_phase_last_quarter"),
  waning_crescent: msg("tonight_moon_phase_waning_crescent"),
}

/** The Moon line's values; null while the library gives no illumination. */
export function moonTonight(moon: NightMoon_Serialize): MoonTonight | null {
  if (moon.illumination === null) return null
  return { illuminationPct: Math.round(moon.illumination * 100), phase: PHASE[moon.phase], rise: moon.riseUtc, set: moon.setUtc }
}

/** The darkness line's window; null on a night never dark at the criteria's level. */
export function darknessTonight(darkness: DarknessWindow_Serialize | null): Darkness {
  return darkness ? { start: darkness.startUtc, end: darkness.endUtc } : null
}

/** The sparkline's grid: one entry per library sample, evenly spaced over the basis's night bounds, every one drawn. */
export function sparkNight(basis: TargetsBasis_Serialize, samples: number): SparkNight {
  const start = Date.parse(basis.nightStartUtc)
  const step = samples > 1 ? (Date.parse(basis.nightEndUtc) - start) / (samples - 1) : 0
  return { samples: Array.from({ length: samples }, (_, i) => ({ ms: start + i * step })), from: 0, to: samples - 1 }
}

/**
 * One row's sparkline values. The peak is the library's `maxAltitudeDeg`;
 * its time is the sample or darkness boundary in the window where the
 * samples, interpolated at the boundaries, peak, so it is as fine as the
 * library's sample spacing. The best window is not part of the row read:
 * with no Img time there is none (`null`), otherwise it is left out. Null
 * without samples (planning values unknown) or with one missing, which is
 * how the wire carries a non-finite number.
 */
export function sparkOf(night: SparkNight, darkness: Darkness, row: TargetRow_Serialize): SparkSky | null {
  const samples = row.altitudeSamplesDeg
  if (samples.length === 0 || !samples.every((alt): alt is number => alt !== null)) return null
  const altitudes: readonly number[] = samples
  const best = row.imgTimeMinutes === 0 ? null : undefined
  if (!darkness || row.maxAltitudeDeg === null) return { altitudes, peakDeg: null, peakAt: null, best }
  const startMs = Date.parse(darkness.start)
  const endMs = Date.parse(darkness.end)
  const points = night.samples.flatMap((s, i) => (s.ms > startMs && s.ms < endMs ? [{ ms: s.ms, alt: altitudes[i]! }] : []))
  points.push({ ms: startMs, alt: altitudeAt(night, altitudes, startMs) }, { ms: endMs, alt: altitudeAt(night, altitudes, endMs) })
  const peak = points.reduce((top, p) => (p.alt > top.alt ? p : top))
  return { altitudes, peakDeg: row.maxAltitudeDeg, peakAt: new Date(peak.ms).toISOString(), best }
}

/** The samples' altitude at `ms`, linear between the two samples around it; the end sample's outside them. */
function altitudeAt(night: SparkNight, altitudes: readonly number[], ms: number): number {
  const after = night.samples.findIndex((s) => s.ms >= ms)
  if (after === -1) return altitudes[altitudes.length - 1]!
  if (after === 0) return altitudes[0]!
  const a = night.samples[after - 1]!
  const b = night.samples[after]!
  const t = (ms - a.ms) / (b.ms - a.ms)
  return altitudes[after - 1]! + t * (altitudes[after]! - altitudes[after - 1]!)
}
