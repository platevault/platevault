/**
 * The calibration view model the calibration components render
 * (CalibrationChoices, CalibrationDiagram, MasterPreview): plain data a host
 * maps from the library's calibration records, plus the catalogue words for
 * its kinds, states and checks. It holds no matching: which sources fit a
 * session, and why, comes with the data.
 */
import { type MessageRef, joinRefs, msg } from "@/lib/i18n"

/** A master's kind. A session pins one per `PinKind`; dark-flats count as darks for flats. */
export type CalibrationKind = "dark" | "flat" | "bias" | "dark-flat"

/** The kinds a light session pins, in order. */
export type PinKind = "dark" | "flat" | "bias"

export const PIN_KINDS: readonly PinKind[] = ["dark", "flat", "bias"]

/** One kind of one light session: what a pick, a confirm or a No names. */
export interface SessionKind {
  sessionId: string
  kind: PinKind
}

export type MatchCriterionName =
  | "camera"
  | "dimensions"
  | "binning"
  | "gain"
  | "offset"
  | "image-type"
  | "exposure"
  | "channel"
  | "optical-train"
  | "rig-version"
  | "temperature"
  | "rotation"
  | "age"

/** One check, lights against calibration. "warning": inside the hard limits but past the warning level, so the match is only suggested (CAL-FR-20, CAL-FR-21). */
export interface MatchCriterion {
  name: MatchCriterionName
  result: "compatible" | "warning" | "incompatible" | "unknown"
  lightValue: MessageRef
  calibrationValue: MessageRef
}

/** What a pin or a suggestion names: one dated master version, or a raw calibration session (CAL-FR-04, CAL-FR-14). */
export type CalibrationSource = { type: "master"; masterId: string; versionId: string } | { type: "raw"; sessionId: string }

/** Why this match (CAL-FR-03, CAL-FR-08): recorded with every pin and suggestion and kept after pinning. */
export interface MatchEvidence {
  /** The calibration's capture time; the lights' is the session's start. */
  capturedAt: string
  /** Flats: observing nights apart; darks and bias: days apart. Either direction. */
  apart: number
  /** Flats: the ROTATANG difference to the lights; null when unknown. */
  rotationDeltaDeg: number | null
  criteria: MatchCriterion[]
}

/**
 * One kind's calibration on a light session (LIB-FR-23, CAL-FR-05): waiting
 * for a match; a suggestion that needs confirmation; pinned; or an explicit
 * No, which needs no reason.
 */
export type CalibrationChoice =
  | { state: "waiting" }
  | { state: "suggested"; source: CalibrationSource; evidence: MatchEvidence }
  | { state: "pinned"; source: CalibrationSource; evidence: MatchEvidence; at: string; by: "matching" | "user" }
  | { state: "none"; at: string; by: "user" | "camera-default" }

/** A pinned file now: intact, or changed, missing or unreadable (the pin stays). */
export type PinHealth = "ok" | "changed" | "missing" | "unreadable"

export const KIND_NAME: Record<CalibrationKind, MessageRef> = {
  dark: msg("calibration_kind_dark"),
  flat: msg("calibration_kind_flat"),
  bias: msg("calibration_kind_bias"),
  "dark-flat": msg("calibration_kind_dark_flat"),
}

export const NO_KIND_NAME: Record<PinKind, MessageRef> = {
  dark: msg("calibration_no_darks"),
  flat: msg("calibration_no_flats"),
  bias: msg("calibration_no_bias"),
}

export const CHOICE_STATE_NAME: Record<CalibrationChoice["state"], MessageRef> = {
  waiting: msg("calibration_choice_waiting"),
  suggested: msg("calibration_choice_suggested"),
  pinned: msg("calibration_choice_pinned"),
  none: msg("calibration_choice_none"),
}

export const CRITERION_NAME: Record<MatchCriterionName, MessageRef> = {
  camera: msg("domain_criterion_camera"),
  dimensions: msg("domain_criterion_dimensions"),
  binning: msg("domain_criterion_binning"),
  gain: msg("domain_criterion_gain"),
  offset: msg("domain_criterion_offset"),
  "image-type": msg("domain_criterion_image_type"),
  exposure: msg("domain_criterion_exposure"),
  channel: msg("domain_criterion_channel"),
  "optical-train": msg("domain_criterion_rig"),
  "rig-version": msg("domain_criterion_rig_version"),
  temperature: msg("domain_criterion_temperature"),
  rotation: msg("domain_criterion_rotation"),
  age: msg("domain_criterion_age"),
}

const CRITERION_RESULT_KEY = { unknown: "domain_criterion_unknown", warning: "domain_criterion_warning", incompatible: "domain_criterion_incompatible" } as const

/** "All 9 checks pass", or the checks that do not: "Rotation warning, Temperature unknown". */
export function summaryRef(criteria: MatchCriterion[]): MessageRef {
  const bad = criteria.filter((c): c is MatchCriterion & { result: keyof typeof CRITERION_RESULT_KEY } => c.result !== "compatible")
  if (bad.length === 0) return msg("domain_criteria_all_compatible", { count: criteria.length })
  return joinRefs(
    bad.map((c) => msg(CRITERION_RESULT_KEY[c.result], { criterion: CRITERION_NAME[c.name] })),
    ", ",
  )
}
