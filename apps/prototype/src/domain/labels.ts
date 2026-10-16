/**
 * Domain vocabulary shared by every screen (foundation-owned), so a term
 * reads the same wherever it appears. Each name is a catalogue ref, worded
 * with `say(m, …)` in the reader's language. Status words with their glyphs
 * live in `components/app/status.tsx`.
 */
import { formatCount, formatDecimal } from "@/lib/format"
import { type MessageRef, msg, nightRef, verbatim } from "@/lib/i18n"
import type { MoonAvoidance } from "./planning"
import type { ApplicationProfile, Band, Catalog, GoalChannel, InputMode, MoonConstraint, OperationUnit, OutputKind, QualityBar, SubjectWindow, WindowRule, WrapUpStepId } from "./types"

/**
 * The catalogue's object types (sky.ts) in the reader's language. A type a
 * resolver returns that is not in this list is provider data, shown as-is.
 */
const OBJECT_TYPE_NAME: Record<string, MessageRef> = {
  "Emission nebula": msg("domain_object_emission_nebula"),
  "Reflection nebula": msg("domain_object_reflection_nebula"),
  "Dark nebula": msg("domain_object_dark_nebula"),
  "Planetary nebula": msg("domain_object_planetary_nebula"),
  "Supernova remnant": msg("domain_object_supernova_remnant"),
  "Open cluster": msg("domain_object_open_cluster"),
  "Open cluster with reflection nebula": msg("domain_object_open_cluster_reflection"),
  "Globular cluster": msg("domain_object_globular_cluster"),
  "Spiral galaxy": msg("domain_object_spiral_galaxy"),
  "Edge-on spiral galaxy": msg("domain_object_edge_on_spiral"),
  "Starburst galaxy": msg("domain_object_starburst_galaxy"),
  "Interacting galaxies": msg("domain_object_interacting_galaxies"),
  "Galaxy group": msg("domain_object_galaxy_group"),
}

export function objectTypeRef(objectType: string): MessageRef {
  return OBJECT_TYPE_NAME[objectType] ?? verbatim(objectType)
}

/** View modes (PREP-FR-04): Symlinks, Copies. */
export const MODE_NAME: Record<InputMode, MessageRef> = {
  symlink: msg("domain_mode_symlink"),
  copy: msg("domain_mode_copy"),
}

/** A Result's Kind in its dropdown (RES-FR-01), in choice order. */
export const OUTPUT_KINDS: OutputKind[] = ["final-image", "linear-integration", "channel-product", "mosaic-panel", "assembled-mosaic", "other"]

export const OUTPUT_KIND_NAME: Record<OutputKind, MessageRef> = {
  "final-image": msg("domain_result_final_image"),
  "linear-integration": msg("domain_result_linear_integration"),
  "channel-product": msg("domain_result_channel_product"),
  "mosaic-panel": msg("domain_result_mosaic_panel"),
  "assembled-mosaic": msg("domain_result_assembled_mosaic"),
  other: msg("domain_result_other"),
}

/** Strip order of the Targets Filters column (PLAN-TGT-FR-06). */
export const BANDS: Band[] = ["L", "R", "G", "B", "Ha", "SII", "OIII"]

export const NARROW_BANDS: Band[] = ["Ha", "SII", "OIII"]

/** Goal channel chips in their order: the band set, then the derived OSC channels. */
export const GOAL_CHANNELS: GoalChannel[] = ["L", "R", "G", "B", "Ha", "OIII", "SII", "OSC", "Dual-band"]

export function isGoalChannel(value: string): value is GoalChannel {
  return (GOAL_CHANNELS as string[]).includes(value)
}

/** "Usable", "FWHM ≤ 2.5″", "Usable, FWHM ≤ 2.5″"; the limit in the reader's digits ("2,5″" in pt-BR). */
export function qualityBarRef(bar: QualityBar | null): MessageRef {
  if (!bar) return msg("domain_quality_any")
  if (bar.kind === "usable-only") return msg("status_usable")
  const arcsec = numberText(bar.maxArcsec)
  return bar.kind === "max-fwhm" ? msg("domain_quality_max_fwhm", { arcsec }) : msg("domain_quality_usable_max_fwhm", { arcsec })
}

/** A setting's number in the reader's digits, as precise as it was typed up to two decimals: "10", "3.5", "5.25" ("3,5" in pt-BR). */
export function numberText(value: number): string {
  if (Number.isInteger(value)) return formatCount(value)
  const tenths = value * 10
  return formatDecimal(value, Math.abs(tenths - Math.round(tenths)) < 1e-9 ? 1 : 2)
}

/** "Panel balance ±10%": a subject's or template's mosaic panel balance (C7). */
export function panelBalanceRef(pct: number): MessageRef {
  return msg("domain_balance_setting", { pct: numberText(pct) })
}

/** "Finish by 30 Nov", "Season 13 Oct – 2 Dec": a subject's window (C7). */
export function windowRef(window: SubjectWindow): MessageRef {
  return window.kind === "finish-by" ? msg("domain_window_finish_by", { night: nightRef(window.night) }) : msg("domain_window_season", { from: nightRef(window.from), to: nightRef(window.to) })
}

/** "No deadline", "Finish by 30 Nov", "Season from visibility": a template's window rule (C7). */
export function windowRuleRef(rule: WindowRule | null): MessageRef {
  if (!rule) return msg("domain_window_none")
  return rule.kind === "finish-by" ? msg("domain_window_finish_by", { night: nightRef(rule.night) }) : msg("domain_window_rule_season")
}

/**
 * Default Moon constraints per band: broadband wants a dark Moon far away;
 * Ha and SII tolerate a bright Moon, OIII sits between (it is close to the
 * Moon's own spectrum).
 * @deprecated One Moon-avoidance curve per filter replaces the two limits (C6): use `DEFAULT_MOON_AVOIDANCE`. W4 removes this.
 */
export const DEFAULT_MOON_CONSTRAINTS: Record<Band, MoonConstraint> = {
  L: { minSeparationDeg: 90, maxIlluminationPct: 30 },
  R: { minSeparationDeg: 90, maxIlluminationPct: 30 },
  G: { minSeparationDeg: 90, maxIlluminationPct: 30 },
  B: { minSeparationDeg: 90, maxIlluminationPct: 30 },
  Ha: { minSeparationDeg: 30, maxIlluminationPct: 100 },
  SII: { minSeparationDeg: 40, maxIlluminationPct: 100 },
  OIII: { minSeparationDeg: 60, maxIlluminationPct: 80 },
}

/**
 * Default Moon-avoidance curve per band (C6; sources and dates in
 * design/R10-MOON-MODEL.md). No source publishes per-filter values, so each
 * group takes a cited setting:
 * - broadband, ACP's starting point: 120° at full Moon, 14 days;
 * - OIII, Target Scheduler's default and its narrowband suggestion: 60°, 7 days;
 * - Ha and SII, the red lines that scattered moonlight reaches least: a
 *   published Target Scheduler narrowband setting, 35°, 3 days.
 */
export const DEFAULT_MOON_AVOIDANCE: Record<Band, MoonAvoidance> = {
  L: { separationDeg: 120, widthDays: 14 },
  R: { separationDeg: 120, widthDays: 14 },
  G: { separationDeg: 120, widthDays: 14 },
  B: { separationDeg: 120, widthDays: 14 },
  Ha: { separationDeg: 35, widthDays: 3 },
  SII: { separationDeg: 35, widthDays: 3 },
  OIII: { separationDeg: 60, widthDays: 7 },
}

/** Wrap up steps in order (PRJ-FR-14); Close project is the last step's final action. */
export const WRAP_UP_STEPS: WrapUpStepId[] = ["cleanup", "trash", "archive"]

export const WRAP_UP_NAME: Record<WrapUpStepId, MessageRef> = {
  cleanup: msg("wrapup_cleanup_title"),
  trash: msg("trash_title"),
  archive: msg("wrapup_archive_title"),
}

/** What an operation counts, as a plural noun beside its totals: "12 of 40 frames". */
export const OPERATION_UNIT_NAME: Record<OperationUnit, MessageRef> = {
  files: msg("op_unit_files"),
  frames: msg("op_unit_frames"),
  entries: msg("op_unit_entries"),
  "prepared-entries": msg("op_unit_prepared_entries"),
  sessions: msg("op_unit_sessions"),
  items: msg("op_unit_items"),
}

/** A count in an operation's unit, agreeing with it: "1 frame", "1,200 frames". */
export function unitCount(unit: OperationUnit, count: number): MessageRef {
  const n = formatCount(count)
  switch (unit) {
    case "files":
      return msg("op_count_files", { count, n })
    case "frames":
      return msg("project_frames_count", { count, n })
    case "entries":
      return msg("op_count_entries", { count, n })
    case "prepared-entries":
      return msg("op_count_prepared_entries", { count, n })
    case "sessions":
      return msg("location_sessions_count", { count, n })
    case "items":
      return msg("op_count_items", { count, n })
  }
}

/** Application profiles in choice order: the applications by name, then the generic launcher last. */
export function orderedProfiles(catalog: Pick<Catalog, "profiles">): ApplicationProfile[] {
  const profiles = Object.values(catalog.profiles)
  const apps = profiles.filter((p) => p.application !== "generic").sort((a, b) => a.name.localeCompare(b.name))
  return [...apps, ...profiles.filter((p) => p.application === "generic")]
}

/** A profile's name as a choice: an application's own name; the generic launcher reads "Other app" (`startrun_profile_other`). */
export function profileRef(profile: ApplicationProfile): MessageRef {
  return profile.application === "generic" ? msg("startrun_profile_other") : verbatim(profile.name)
}
