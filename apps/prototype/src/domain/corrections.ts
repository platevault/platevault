/**
 * Catalog corrections (LIB-FR-05, LIB-FR-12). Corrections live on sessions and
 * change only the catalog: source headers (`Asset.observed`) never change.
 * Derived totals and grouping read the corrected value through these helpers.
 */
import type { CatalogCorrection, CorrectionField, Session } from "./types"

/** The session's most recent correction of `field` (latest `at`, then revision, then order), or null. */
export function latestCorrection(session: Session, field: CorrectionField): CatalogCorrection | null {
  let latest: CatalogCorrection | null = null
  for (const correction of session.corrections) {
    if (correction.field !== field) continue
    if (!latest || correction.at > latest.at || (correction.at === latest.at && correction.revision >= latest.revision)) latest = correction
  }
  return latest
}

/** Exposure in seconds from the session's latest exposure correction; null when uncorrected or unreadable. */
export function correctedExposureS(session: Session): number | null {
  const correction = latestCorrection(session, "exposure")
  const seconds = correction ? Number.parseFloat(correction.correctedValue) : Number.NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}
