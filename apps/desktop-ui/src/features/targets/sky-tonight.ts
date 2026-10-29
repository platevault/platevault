/**
 * Tonight's sky as the library computed it, in the shape the night visuals
 * take (components/domain/sky-lines.tsx). The Moon appears once, in the
 * Targets toolbar and on a Target page, for the page's night at its
 * planning site (PLAN-TGT-FR-07); no row repeats it. This module only
 * reshapes the library's values: illumination, phase, rise and set.
 */
import type { MoonPhase, NightMoon_Serialize } from "@/api/ipc"
import type { MoonTonight } from "@/components/domain/sky-lines"
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
