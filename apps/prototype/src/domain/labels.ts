/**
 * Domain vocabulary shared by every screen (foundation-owned), so a term
 * reads the same wherever it appears. Each name is a catalogue ref, worded
 * with `say(m, …)` in the reader's language. Status words with their glyphs
 * live in `components/app/status.tsx`.
 */
import { formatCount } from "@/lib/format"
import { type MessageRef, msg } from "@/lib/i18n"
import type { Band, GoalChannel, InputMode, MoonConstraint, OperationUnit, QualityBar, ResultKind, RunStep, WrapUpStepId } from "./types"

export const RUN_STEPS: RunStep[] = ["select", "review", "calibrate", "prepare", "results", "done"]

/** A run step's name: Select, Review, Calibrate, Prepare, Results, Done (`stepName` in app/run-ui words it). */
export const STEP_NAME: Record<RunStep, MessageRef> = {
  select: msg("step_select"),
  review: msg("step_review"),
  calibrate: msg("step_calibrate"),
  prepare: msg("step_prepare"),
  results: msg("step_results"),
  done: msg("step_done"),
}

/** "Linked run": the run folder holds links to the reviewed inputs (PREP-FR-04). */
export const MODE_NAME: Record<InputMode, MessageRef> = {
  linked: msg("domain_mode_linked"),
  "direct-source": msg("domain_mode_direct_source"),
  copy: msg("domain_mode_copy"),
  clone: msg("domain_mode_clone"),
}

export const RESULT_KIND_NAME: Record<ResultKind, MessageRef> = {
  "final-image": msg("domain_result_final_image"),
  "linear-integration": msg("domain_result_linear_integration"),
  "channel-product": msg("domain_result_channel_product"),
  "mosaic-panel": msg("domain_result_mosaic_panel"),
  "assembled-mosaic": msg("domain_result_assembled_mosaic"),
}

/** Plural product-input kinds, as a profile's capability names them. */
export const PRODUCT_KIND_NAME: Record<ResultKind, MessageRef> = {
  "final-image": msg("domain_products_final_image"),
  "linear-integration": msg("domain_products_linear_integration"),
  "channel-product": msg("domain_products_channel_product"),
  "mosaic-panel": msg("domain_products_mosaic_panel"),
  "assembled-mosaic": msg("domain_products_assembled_mosaic"),
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
export function qualityBarRef(bar: QualityBar | null): MessageRef {
  if (!bar) return msg("domain_quality_any")
  if (bar.kind === "usable-only") return msg("status_usable")
  return bar.kind === "max-fwhm" ? msg("domain_quality_max_fwhm", { arcsec: bar.maxArcsec }) : msg("domain_quality_usable_max_fwhm", { arcsec: bar.maxArcsec })
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

export const WRAP_UP_NAME: Record<WrapUpStepId, MessageRef> = {
  cleanup: msg("domain_wrap_up_cleanup"),
  trash: msg("domain_wrap_up_trash"),
  archive: msg("domain_wrap_up_archive"),
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
      return msg("domain_frames", { count, n })
    case "entries":
      return msg("op_count_entries", { count, n })
    case "prepared-entries":
      return msg("op_count_prepared_entries", { count, n })
    case "sessions":
      return msg("domain_sessions", { count, n })
    case "items":
      return msg("op_count_items", { count, n })
  }
}
