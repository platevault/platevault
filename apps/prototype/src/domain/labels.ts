/**
 * Domain vocabulary labels shared by every screen (foundation-owned), so a
 * term reads the same wherever it appears. Status words with their glyphs
 * live in `components/app/status.tsx`.
 */
import type { Band, CalibrationPolicy, GoalChannel, InputMode, MoonConstraint, QualityBar, ResultKind, RunStep, WrapUpStepId } from "./types"

export const RUN_STEPS: RunStep[] = ["select", "review", "calibrate", "prepare", "results", "done"]

export const STEP_LABEL: Record<RunStep, string> = {
  select: "Select",
  review: "Review",
  calibrate: "Calibrate",
  prepare: "Prepare",
  results: "Results",
  done: "Done",
}

/** "Linked run": the run folder holds links to the reviewed inputs (PREP-FR-04). */
export const MODE_LABEL: Record<InputMode, string> = { linked: "Linked run", "direct-source": "Direct source", copy: "Copy", clone: "Clone" }

export const RESULT_KIND_LABEL: Record<ResultKind, string> = {
  "final-image": "Final image",
  "linear-integration": "Linear integration",
  "channel-product": "Channel product",
  "mosaic-panel": "Mosaic panel",
  "assembled-mosaic": "Assembled mosaic",
}

/** Plural product-input kinds, as a profile's capability names them. */
export const PRODUCT_KIND_LABEL: Record<ResultKind, string> = {
  "final-image": "final images",
  "linear-integration": "linear integrations",
  "channel-product": "channel products",
  "mosaic-panel": "mosaic panels",
  "assembled-mosaic": "assembled mosaics",
}

export const CALIBRATION_POLICY_LABEL: Record<CalibrationPolicy, string> = {
  automatic: "Automatic",
  off: "Off",
}

/** Strip order of the Targets Filters column (PLAN-TGT-FR-06). */
export const BANDS: Band[] = ["L", "R", "G", "B", "Ha", "SII", "OIII"]

export const NARROW_BANDS: Band[] = ["Ha", "SII", "OIII"]

/** Goal channel chips in their order: the band set, then the derived OSC channels. */
export const GOAL_CHANNELS: GoalChannel[] = ["L", "R", "G", "B", "Ha", "OIII", "SII", "OSC", "Dual-band"]

export function isGoalChannel(value: string): value is GoalChannel {
  return (GOAL_CHANNELS as string[]).includes(value)
}

/** "Usable", "FWHM ≤ 2.5″", "Usable, FWHM ≤ 2.5″". */
export function qualityBarLabel(bar: QualityBar | null): string {
  if (!bar) return "Any quality"
  if (bar.kind === "usable-only") return "Usable"
  const limit = `FWHM ≤ ${bar.maxArcsec}″`
  return bar.kind === "max-fwhm" ? limit : `Usable, ${limit}`
}

/**
 * Default Moon constraints per band: broadband wants a dark Moon far away;
 * Ha and SII tolerate a bright Moon, OIII sits between (it is close to the
 * Moon's own spectrum).
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

/** Wrap up steps in order (P-WRAP1); Done follows the last. */
export const WRAP_UP_STEPS: WrapUpStepId[] = ["cleanup", "trash", "archive"]

export const WRAP_UP_LABEL: Record<WrapUpStepId, string> = {
  cleanup: "Clean up runs",
  trash: "Trash",
  archive: "Archive",
}
