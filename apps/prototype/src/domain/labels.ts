/**
 * Domain vocabulary labels shared by every screen (foundation-owned), so a
 * term reads the same wherever it appears. Status words with their glyphs
 * live in `components/app/status.tsx`.
 */
import type { Band, CalibrationPolicy, InputMode, ResultKind, RunStep } from "./types"

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
