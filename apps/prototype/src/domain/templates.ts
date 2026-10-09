/**
 * Goal templates (D-W30, D-W47, PRJ-FR-12) and naming templates (D-W20,
 * STO-IMP-FR-07): the built-in values and the pure template resolution that
 * New Project, Import, Archive and Settings share. Nothing here writes state.
 */
import type { GoalTemplate, GoalTemplateValue, NamingFrameType, NamingToken } from "./types"

const H = 3600

function hours(channels: string[], h: number): GoalTemplateValue[] {
  return channels.map((channel) => ({ channel, integrationS: h * H, frameCount: null }))
}

/**
 * Built-in goal templates and their values (D-W47). Never filtered by rig
 * (D-W30). OSC templates use the derived channels "OSC" (no filter or a
 * broadband filter on an OSC camera) and "Dual-band" (a filter passing two
 * narrow bands), as `goalChannel` in derive.ts reads them.
 */
export const BUILT_IN_GOAL_TEMPLATES: GoalTemplate[] = [
  { id: "gtpl_hoo", name: "HOO", source: "built-in", values: hours(["Ha", "OIII"], 10) },
  { id: "gtpl_sho", name: "SHO", source: "built-in", values: hours(["Ha", "OIII", "SII"], 10) },
  { id: "gtpl_lrgb", name: "LRGB", source: "built-in", values: [...hours(["L"], 6), ...hours(["R", "G", "B"], 2)] },
  { id: "gtpl_osc_broadband", name: "OSC broadband", source: "built-in", values: hours(["OSC"], 10) },
  { id: "gtpl_osc_dualband", name: "OSC dual-band", source: "built-in", values: hours(["Dual-band"], 15) },
]

// ---------------------------------------------------------------------------
// Naming templates
// ---------------------------------------------------------------------------

/** Token order in the chip editor, each with the fallback used when metadata lacks it. */
export const NAMING_TOKENS: Array<{ token: NamingToken; fallback: string; label: string }> = [
  { token: "target", fallback: "unclassified", label: "Target" },
  { token: "filter", fallback: "nofilter", label: "Filter" },
  { token: "date", fallback: "undated", label: "Observing night" },
  { token: "frame_type", fallback: "unknown", label: "Frame type" },
  { token: "camera", fallback: "unknown-camera", label: "Camera" },
  { token: "exposure", fallback: "unknown-exposure", label: "Exposure" },
  { token: "gain", fallback: "unknown-gain", label: "Gain" },
  { token: "binning", fallback: "1x1", label: "Binning" },
  { token: "set_temp", fallback: "untempered", label: "Set temperature" },
]

/** Per-type defaults; Settings stores only the overridden types. */
export const DEFAULT_NAMING: Record<NamingFrameType, string> = {
  light: "{target}/{filter}/{date}/light/",
  flat: "flats/{filter}/{date}/",
  dark: "darks/{exposure}/",
  bias: "bias/",
  "master-flat": "masters/flats/{filter}/",
  "master-dark": "masters/darks/{exposure}/",
  "master-bias": "masters/bias/",
}

export function namingTemplate(overrides: Partial<Record<NamingFrameType, string>>, type: NamingFrameType): string {
  return overrides[type] ?? DEFAULT_NAMING[type]
}

/** Metadata a template resolves against; null fields use the token's fallback. */
export type NamingValues = Partial<Record<NamingToken, string | null>>

const RESERVED = new Set(["con", "prn", "aux", "nul", "com1", "lpt1", ".", ".."])
const MAX_SEGMENT = 80

/** Errors a template has before it is saved or resolved: unknown tokens, `..` and reserved names. */
export function validateNamingTemplate(template: string): string[] {
  const errors: string[] = []
  const known = new Set(NAMING_TOKENS.map((t) => t.token))
  for (const match of template.matchAll(/\{([^}]*)\}/g)) {
    if (!known.has(match[1] as NamingToken)) errors.push(`Unknown token {${match[1]}}`)
  }
  for (const segment of template.split("/")) {
    if (segment === "..") errors.push("A folder cannot be `..`")
    else if (RESERVED.has(segment.toLowerCase())) errors.push(`"${segment}" is a reserved name`)
  }
  if (template.startsWith("/")) errors.push("A template is relative to its location; remove the leading /")
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
