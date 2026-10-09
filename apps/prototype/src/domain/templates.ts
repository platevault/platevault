/**
 * Goal templates (D-W30, D-W47, PRJ-FR-12) and naming templates (D-W20,
 * STO-IMP-FR-07): the built-in values, the token values every consumer
 * builds the same way, and the pure template resolution that New Project,
 * Import, Archive, review names and Settings share. Nothing here writes state.
 */
import { type MessageRef, msg } from "@/lib/i18n"
import { nightOf } from "./indexing"
import type { FrameHeader, GoalChannel, GoalTemplate, GoalTemplateValue, NamingFrameType, NamingToken, QualityBar } from "./types"

const H = 3600
const USABLE: QualityBar = { kind: "usable-only" }

function hours(channels: GoalChannel[], h: number, qualityBar: QualityBar | null = USABLE): GoalTemplateValue[] {
  return channels.map((channel) => ({ channel, integrationS: h * H, frameCount: null, qualityBar }))
}

/**
 * Built-in goal templates and their values (D-W47). Never filtered by rig
 * (D-W30). Each value holds the goal kinds a Goal does: integration time,
 * frame count and a quality bar. OSC templates use the derived channels
 * "OSC" and "Dual-band", as `goalChannel` in derive.ts reads them.
 */
export const BUILT_IN_GOAL_TEMPLATES: GoalTemplate[] = [
  { id: "gtpl_hoo", name: "HOO", source: "built-in", values: hours(["Ha", "OIII"], 10) },
  { id: "gtpl_sho", name: "SHO", source: "built-in", values: hours(["Ha", "OIII", "SII"], 10) },
  { id: "gtpl_lrgb", name: "LRGB", source: "built-in", values: [...hours(["L"], 6, { kind: "usable-max-fwhm", maxArcsec: 3 }), ...hours(["R", "G", "B"], 2)] },
  { id: "gtpl_osc_broadband", name: "OSC broadband", source: "built-in", values: hours(["OSC"], 10) },
  { id: "gtpl_osc_dualband", name: "OSC dual-band", source: "built-in", values: hours(["Dual-band"], 15) },
]

// ---------------------------------------------------------------------------
// Naming templates
// ---------------------------------------------------------------------------

/** Token order in the chip editor, each with the fallback used when metadata lacks it. */
export const NAMING_TOKENS: Array<{ token: NamingToken; fallback: string; label: MessageRef }> = [
  { token: "target", fallback: "unclassified", label: msg("domain_token_target") },
  { token: "filter", fallback: "nofilter", label: msg("session_filter") },
  { token: "date", fallback: "undated", label: msg("session_observing_night") },
  { token: "frame_type", fallback: "unknown", label: msg("session_frame_type") },
  { token: "train", fallback: "unknown-train", label: msg("domain_optical_train") },
  { token: "camera", fallback: "unknown-camera", label: msg("session_camera") },
  { token: "exposure", fallback: "unknown-exposure", label: msg("domain_criterion_exposure") },
  { token: "gain", fallback: "unknown-gain", label: msg("domain_criterion_gain") },
  { token: "offset", fallback: "unknown-offset", label: msg("domain_criterion_offset") },
  { token: "binning", fallback: "1x1", label: msg("domain_criterion_binning") },
  { token: "set_temp", fallback: "untempered", label: msg("domain_token_set_temp") },
]

/**
 * Per-type defaults; Settings stores only the overridden types. Raw
 * calibration frames wait under `Raw/` for their calibration process; the
 * master types are structured calibration storage (P-CAL3): flats per optical
 * train, filter and night (short-lived), darks per camera, exposure,
 * gain/offset and temperature, bias per camera and gain/offset (long-lived).
 */
export const DEFAULT_NAMING: Record<NamingFrameType, string> = {
  light: "{target}/{filter}/{date}/light/",
  flat: "Raw/Flats/{filter}/{date}/",
  dark: "Raw/Darks/{exposure}/{date}/",
  bias: "Raw/Bias/{date}/",
  "master-flat": "Flats/{train}/{filter}/{date}/",
  "master-dark": "Darks/{camera}/{exposure}_g{gain}_o{offset}_{set_temp}/",
  "master-bias": "Bias/{camera}/g{gain}_o{offset}/",
  "master-dark-flat": "Dark flats/{camera}/{exposure}_g{gain}_o{offset}_{set_temp}/",
}

export function namingTemplate(overrides: Partial<Record<NamingFrameType, string>>, type: NamingFrameType): string {
  return overrides[type] ?? DEFAULT_NAMING[type]
}

/** Metadata a template resolves against; null fields use the token's fallback. */
export type NamingValues = Partial<Record<NamingToken, string | null>>

/** The metadata the naming tokens read, before formatting. */
export interface NamingFacts {
  target: string | null
  filter: string | null
  /** Observing night, `YYYY-MM-DD`. */
  night: string | null
  frameType: string
  camera: string | null
  exposureS: number | null
  gain: number | null
  /** Optional: only the calibration storage templates read it. */
  offset?: number | null
  binning: number | null
  ccdTempC: number | null
  /** Optical train (rig) name; optional, only the master flat template reads it. */
  train?: string | null
}

/**
 * Token values from metadata, formatted one way for every consumer (Import
 * destinations, Archive and Restore folders, review display names, the
 * Settings preview and calibration storage): "300s", "2x2", "-10C".
 */
export function namingValues(facts: NamingFacts): NamingValues {
  return {
    target: facts.target,
    filter: facts.filter,
    date: facts.night,
    frame_type: facts.frameType,
    camera: facts.camera,
    exposure: facts.exposureS === null ? null : `${Number(facts.exposureS.toPrecision(6))}s`,
    gain: facts.gain === null ? null : String(facts.gain),
    offset: facts.offset === null || facts.offset === undefined ? null : String(facts.offset),
    binning: facts.binning === null ? null : `${facts.binning}x${facts.binning}`,
    set_temp: facts.ccdTempC === null ? null : `${Math.round(facts.ccdTempC)}C`,
    train: facts.train ?? null,
  }
}

/**
 * Token values from a file's observed header, before indexing associates it
 * (Import); the Target is its OBJECT and the optical train its TELESCOP.
 */
export function headerNamingValues(header: FrameHeader, frameType: string): NamingValues {
  return namingValues({
    target: header.object,
    filter: header.filter,
    night: header.dateObs ? nightOf(header.dateObs) : null,
    frameType,
    camera: header.instrument,
    exposureS: header.exposureS,
    gain: header.gain,
    offset: header.offset,
    binning: header.binning,
    ccdTempC: header.ccdTempC,
    train: header.telescope,
  })
}

const RESERVED = new Set(["con", "prn", "aux", "nul", "com1", "lpt1", ".", ".."])
const MAX_SEGMENT = 80

/** Errors a template has before it is saved or resolved: unknown tokens, `..` and reserved names. */
export function validateNamingTemplate(template: string): MessageRef[] {
  const errors: MessageRef[] = []
  const known = new Set(NAMING_TOKENS.map((t) => t.token))
  for (const match of template.matchAll(/\{([^}]*)\}/g)) {
    if (!known.has(match[1] as NamingToken)) errors.push(msg("domain_naming_unknown_token", { token: match[0] }))
  }
  for (const segment of template.split("/")) {
    if (segment === "..") errors.push(msg("domain_naming_parent_folder"))
    else if (RESERVED.has(segment.toLowerCase())) errors.push(msg("domain_naming_reserved", { name: segment }))
  }
  if (template.startsWith("/")) errors.push(msg("domain_naming_leading_slash"))
  return errors
}

function sanitize(value: string): string {
  return value.replace(/[\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, MAX_SEGMENT)
}

/**
 * Resolve a template against metadata. Returns the relative folder path and
 * every fallback token it used, so the preview can name them (STO-IMP-AC-08).
 */
export function resolveNamingTemplate(template: string, values: NamingValues): { path: string; fallbacks: NamingToken[] } {
  const fallbacks: NamingToken[] = []
  const path = template.replace(/\{([^}]*)\}/g, (_, name: string) => {
    const token = NAMING_TOKENS.find((t) => t.token === name)
    if (!token) return ""
    const value = values[token.token]
    if (value === null || value === undefined || value === "") {
      fallbacks.push(token.token)
      return token.fallback
    }
    return sanitize(value).replace(/\//g, "-")
  })
  return { path, fallbacks }
}
