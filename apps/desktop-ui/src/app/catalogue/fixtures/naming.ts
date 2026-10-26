/**
 * The naming tokens the catalogue's TokenTemplateField and TokenTable
 * specimens offer, in chip-editor order, each with its fallback and a
 * typical value from a sample library item. Catalogue only.
 */
import type { TemplateToken } from "@/components/app/fields"
import type { Messages } from "@/lib/i18n"

const TOKENS: ReadonlyArray<{ token: string; fallback: string; example: string; label: (m: Messages) => string }> = [
  { token: "target", fallback: "Unclassified", example: "M 31", label: (m) => m.domain_token_target() },
  { token: "filter", fallback: "nofilter", example: "Ha", label: (m) => m.session_filter() },
  { token: "date", fallback: "undated", example: "2026-10-11", label: (m) => m.session_observing_night() },
  { token: "frame_type", fallback: "unknown", example: "light", label: (m) => m.session_frame_type() },
  { token: "train", fallback: "unknown-train", example: "RedCat 51", label: (m) => m.domain_optical_train() },
  { token: "camera", fallback: "unknown-camera", example: "ASI2600MM", label: (m) => m.session_camera() },
  { token: "exposure", fallback: "unknown-exposure", example: "300s", label: (m) => m.domain_criterion_exposure() },
  { token: "gain", fallback: "unknown-gain", example: "100", label: (m) => m.domain_criterion_gain() },
  { token: "offset", fallback: "unknown-offset", example: "50", label: (m) => m.domain_criterion_offset() },
  { token: "binning", fallback: "1x1", example: "1x1", label: (m) => m.domain_criterion_binning() },
  { token: "set_temp", fallback: "untempered", example: "-10C", label: (m) => m.domain_token_set_temp() },
]

/** The naming tokens, worded in the reader's language. */
export function namingTokens(m: Messages): TemplateToken[] {
  return TOKENS.map(({ token, fallback, example, label }) => ({ token, label: label(m), example, fallback }))
}
