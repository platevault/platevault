/**
 * Goal templates (D-W30, D-W47, PRJ-FR-12), the goal unit rule and the goal
 * conditions (C7), and naming templates (D-W20, STO-IMP-FR-07): the built-in
 * values, the token values every consumer builds the same way, and the pure
 * template resolution that New Project, Import, Archive, review names and
 * Settings share. Nothing here writes state.
 */
import { m, type MessageRef, msg } from "@/lib/i18n"
import { nightOf } from "./indexing"
import type { FrameTotals } from "./library"
import type {
  FrameHeader,
  GoalChannel,
  GoalTemplate,
  GoalTemplateConditions,
  GoalTemplateValue,
  NamingFrameType,
  NamingToken,
  QualityBar,
  Subject,
  SubjectConditions,
  SubjectWindow,
} from "./types"

const H = 3600
const USABLE: QualityBar = { kind: "usable-only" }

function hours(channels: GoalChannel[], h: number, qualityBar: QualityBar | null = USABLE): GoalTemplateValue[] {
  return channels.map((channel) => ({ channel, integrationS: h * H, frameCount: null, qualityBar }))
}

/**
 * Built-in goal templates and their values (D-W47). Never filtered by rig
 * (D-W30). Each value holds what a Goal does: one amount, time or frames
 * (C7, `goalAmount`), and a quality bar. OSC templates use the derived
 * channels "OSC" and "Dual-band", as `goalChannel` in derive.ts reads them.
 * HOO, SHO and LRGB are palette names; the OSC names are words, so they are
 * getters read in the current language.
 */
export const BUILT_IN_GOAL_TEMPLATES: GoalTemplate[] = [
  { id: "gtpl_hoo", name: "HOO", source: "built-in", values: hours(["Ha", "OIII"], 10) },
  { id: "gtpl_sho", name: "SHO", source: "built-in", values: hours(["Ha", "OIII", "SII"], 10) },
  { id: "gtpl_lrgb", name: "LRGB", source: "built-in", values: [...hours(["L"], 6, { kind: "usable-max-fwhm", maxArcsec: 3 }), ...hours(["R", "G", "B"], 2)] },
  {
    id: "gtpl_osc_broadband",
    get name() {
      return m.domain_template_osc_broadband()
    },
    source: "built-in",
    values: hours(["OSC"], 10),
  },
  {
    id: "gtpl_osc_dualband",
    get name() {
      return m.domain_template_osc_dualband()
    },
    source: "built-in",
    values: hours(["Dual-band"], 15),
  },
]

// ---------------------------------------------------------------------------
// Goal unit (C7): each goal counts time or frames, never both
// ---------------------------------------------------------------------------

/** What a goal counts: integration time or frames, one per goal (C7). */
export type GoalUnit = "time" | "frames"

/** A goal's one amount: seconds of integration, or a frame count. */
export type GoalAmount = { unit: "time"; seconds: number } | { unit: "frames"; frames: number }

type GoalFields = Pick<GoalTemplateValue, "integrationS" | "frameCount">

/**
 * The one amount a goal or template value holds, or null without one. A
 * goal stored before C7 may hold both fields: it reads as time, the unit its
 * progress always showed, so no goal needs two amounts to be met.
 */
export function goalAmount(goal: GoalFields): GoalAmount | null {
  if (goal.integrationS !== null) return { unit: "time", seconds: goal.integrationS }
  if (goal.frameCount !== null) return { unit: "frames", frames: goal.frameCount }
  return null
}

/** The stored fields of an amount, at most one set: what a goal editor writes when the unit or the value changes. */
export function goalFields(amount: GoalAmount | null): GoalFields {
  if (!amount) return { integrationS: null, frameCount: null }
  return amount.unit === "time" ? { integrationS: amount.seconds, frameCount: null } : { integrationS: null, frameCount: amount.frames }
}

/** One goal's progress in a single unit (`goalMeasure`): seconds for time, a count for frames. */
export interface GoalMeasure {
  amount: GoalAmount | null
  /** The unit every number below counts in: the amount's, else frames (as each surface counts a goal without an amount). */
  unit: GoalUnit
  inProject: number
  captured: number
  /** The amount; null without one. */
  target: number | null
  /** Still needed in project, never below zero; null without an amount. */
  remaining: number | null
  /** "In project" reaches the amount; a goal without an amount is never met. */
  met: boolean
  /** Share of the amount in project, 0 to 1 (1 exactly when met); null without an amount. */
  fraction: number | null
}

/**
 * One goal's progress from its "in project" and "captured" totals, both
 * counted in the goal's one unit (C7), so the met test, what remains and the
 * progress line always agree. The totals themselves come from
 * `goalProgress` (derive.ts), which applies the quality bar.
 */
export function goalMeasure(goal: GoalFields, inProject: FrameTotals, captured: FrameTotals): GoalMeasure {
  const amount = goalAmount(goal)
  const unit: GoalUnit = amount?.unit ?? "frames"
  const count = (totals: FrameTotals) => (unit === "time" ? totals.seconds : totals.frames)
  const target = amount === null ? null : amount.unit === "time" ? amount.seconds : amount.frames
  const done = count(inProject)
  const met = target !== null && done >= target
  return {
    amount,
    unit,
    inProject: done,
    captured: count(captured),
    target,
    remaining: target === null ? null : Math.max(0, target - done),
    met,
    fraction: target === null ? null : met ? 1 : done / target,
  }
}

// ---------------------------------------------------------------------------
// Goal conditions (C7, "Goals, grilling round 4"): quality bar, panel
// balance, deadline or season window. Templates carry them.
// ---------------------------------------------------------------------------

/**
 * The bar's FWHM limit, the x of "count only frames with FWHM ≤ x″" (C7);
 * null without one.
 */
export function fwhmBar(bar: QualityBar | null): number | null {
  return bar && bar.kind !== "usable-only" ? bar.maxArcsec : null
}

/** The bar a goal editor writes (C7): Usable frames, narrowed to FWHM ≤ x″ when a limit is set. Inverse of `fwhmBar`. */
export function qualityBarFor(maxArcsec: number | null): QualityBar {
  return maxArcsec === null ? { kind: "usable-only" } : { kind: "usable-max-fwhm", maxArcsec }
}

/** The panel balance a subject and a template start with: ±10 % (C7, the user's default). */
export const DEFAULT_PANEL_BALANCE_PCT = 10

/** The panel balance an edit keeps: at least ±1 %, at most ±100 % (`clampPanelBalance`). */
export const PANEL_BALANCE_LIMITS = { minPct: 1, maxPct: 100 } as const

/** A subject's conditions until it sets its own: the default panel balance, no window. */
export const DEFAULT_SUBJECT_CONDITIONS: SubjectConditions = { panelBalancePct: DEFAULT_PANEL_BALANCE_PCT, window: null }

/** A template's conditions until it sets its own: the default panel balance, no window. */
export const DEFAULT_TEMPLATE_CONDITIONS: GoalTemplateConditions = { panelBalancePct: DEFAULT_PANEL_BALANCE_PCT, window: null }

/** A panel balance inside `PANEL_BALANCE_LIMITS`; a value that is not a number reads as the default. */
export function clampPanelBalance(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_PANEL_BALANCE_PCT
  return Math.min(PANEL_BALANCE_LIMITS.maxPct, Math.max(PANEL_BALANCE_LIMITS.minPct, pct))
}

/** A subject's goal conditions; a subject saved without them reads the defaults. */
export function subjectConditions(subject: Subject): SubjectConditions {
  return subject.conditions ?? DEFAULT_SUBJECT_CONDITIONS
}

/** A template's goal conditions; a template saved without them reads the defaults. */
export function templateConditions(template: GoalTemplate): GoalTemplateConditions {
  return template.conditions ?? DEFAULT_TEMPLATE_CONDITIONS
}

/**
 * The conditions a template gives one subject when it is applied (C7): its
 * panel balance, and its window rule resolved. "Finish by" copies the night;
 * "Season" takes what `season` pre-fills from the subject Target's
 * visibility (`seasonWindow` in planning.ts), and no window when the Target
 * has no season. `season` is only called for a season rule. Without a
 * template the subject keeps the defaults.
 */
export function subjectConditionsFrom(template: GoalTemplate | undefined, season: () => SubjectWindow | null): SubjectConditions {
  if (!template) return DEFAULT_SUBJECT_CONDITIONS
  const { panelBalancePct, window } = templateConditions(template)
  const resolved: SubjectWindow | null = !window ? null : window.kind === "finish-by" ? { kind: "finish-by", night: window.night } : season()
  return { panelBalancePct: clampPanelBalance(panelBalancePct), window: resolved }
}

// ---------------------------------------------------------------------------
// Naming templates
// ---------------------------------------------------------------------------

/** Token order in the chip editor, each with the fallback used when metadata lacks it. */
export const NAMING_TOKENS: Array<{ token: NamingToken; fallback: string; label: MessageRef }> = [
  { token: "target", fallback: "Unclassified", label: msg("domain_token_target") },
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
 * (Import); the optical train is its TELESCOP. `{target}` is the Target the
 * user confirmed (P-IMP2), never OBJECT: without one it reads "Unclassified".
 */
export function headerNamingValues(header: FrameHeader, frameType: string, target: string | null = null): NamingValues {
  return namingValues({
    target,
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
/** Characters no file or folder name may hold on Windows, and so on no computer PlateVault writes to. */
const UNSAFE_NAME_CHARACTERS = /[\\:*?"<>|]/g

/** Errors a template has before it is saved or resolved: unknown tokens, literal characters no file or folder name may hold, `..` and reserved names. */
export function validateNamingTemplate(template: string): MessageRef[] {
  const errors: MessageRef[] = []
  const known = new Set(NAMING_TOKENS.map((t) => t.token))
  for (const match of template.matchAll(/\{([^}]*)\}/g)) {
    if (!known.has(match[1] as NamingToken)) errors.push(msg("domain_naming_unknown_token", { token: match[0] }))
  }
  // Token values are made safe when they resolve (`sanitize`); the text typed around them is checked here.
  const unsafe = [...new Set(template.replace(/\{[^}]*\}/g, "").match(UNSAFE_NAME_CHARACTERS) ?? [])]
  if (unsafe.length > 0) errors.push(msg("domain_naming_unsafe_characters", { characters: unsafe.join(" ") }))
  for (const segment of template.split("/")) {
    if (segment === "..") errors.push(msg("domain_naming_parent_folder"))
    else if (RESERVED.has(segment.toLowerCase())) errors.push(msg("domain_naming_reserved", { name: segment }))
  }
  if (template.startsWith("/")) errors.push(msg("domain_naming_leading_slash"))
  return errors
}

function sanitize(value: string): string {
  return value.replace(UNSAFE_NAME_CHARACTERS, "-").replace(/\s+/g, " ").trim().slice(0, MAX_SEGMENT)
}

/**
 * Resolve a template against metadata. Returns the relative folder path and
 * every fallback token it used, so the preview can name them (STO-IMP-AC-08).
 * A token in `omit` whose value is missing writes nothing instead of its
 * fallback (Settings › Naming, wmbp9), and the folder it leaves empty
 * collapses: no separator is doubled and none leads the path.
 */
export function resolveNamingTemplate(template: string, values: NamingValues, omit: readonly NamingToken[] = []): { path: string; fallbacks: NamingToken[] } {
  const fallbacks: NamingToken[] = []
  let omitted = false
  const resolved = template.replace(/\{([^}]*)\}/g, (_, name: string) => {
    const token = NAMING_TOKENS.find((t) => t.token === name)
    if (!token) return ""
    const value = values[token.token]
    if (value === null || value === undefined || value === "") {
      if (omit.includes(token.token)) {
        omitted = true
        return ""
      }
      fallbacks.push(token.token)
      return token.fallback
    }
    return sanitize(value).replace(/\//g, "-")
  })
  const path = omitted ? resolved.replace(/\/{2,}/g, "/").replace(/^\//, "") : resolved
  return { path, fallbacks }
}
