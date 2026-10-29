/**
 * Home's stored planning criteria (PLAN-FR-11/12): the one source Home's
 * Tonight and calendar are computed with. The library reads them on its
 * side (`home_dashboard`, `planning_calendar`); Home only reads and saves
 * them here. They read `null` until the user sets them: `PlanCriteria` has
 * no defaults by design and no spec gives every criterion a value, so Home
 * asks for them (`no_criteria`).
 *
 * The form checks the ranges the library refuses (`PlanCriteria::validate`)
 * on their field before it saves. A refusal the library still makes names
 * its field on the wire, and the dialog shows it there.
 */
import type { Darkness, PlanCriteria } from "@/api/ipc"
import { libraryQuery } from "@/api/query"
import type { FieldErrors } from "@/components/app/form-dialog"
import type { Messages } from "@/lib/i18n"

export const homeCriteriaQuery = () => libraryQuery("planningHomeCriteria")

/** The Moon limit's kind, or `""` before the user chooses one. */
export type MoonKind = PlanCriteria["moon"]["kind"] | ""

/** The criteria as the form edits them: `null` and `""` are not chosen yet. */
export interface CriteriaDraft {
  minAltitudeDeg: number | null
  darkness: Darkness | ""
  moon: MoonKind
  minSeparationDeg: number | null
  minDurationMinutes: number | null
}

export type CriteriaField = keyof CriteriaDraft

/** The longest minimum window the library takes, in minutes (`MAX_MINUTES`). */
const MAX_MINUTES = 1440

/** The draft of stored criteria, or an empty one when none are stored. */
export function draftOf(criteria: PlanCriteria | null): CriteriaDraft {
  if (!criteria) return { minAltitudeDeg: null, darkness: "", moon: "", minSeparationDeg: null, minDurationMinutes: null }
  return {
    minAltitudeDeg: criteria.minAltitudeDeg,
    darkness: criteria.darkness,
    moon: criteria.moon.kind,
    minSeparationDeg: criteria.moon.kind === "min_separation" ? criteria.moon.minSeparationDeg : null,
    minDurationMinutes: criteria.minDurationMinutes,
  }
}

/** Each field's message while it fails the library's ranges; none once the draft is whole and valid. */
export function criteriaErrors(m: Messages, draft: CriteriaDraft): FieldErrors<CriteriaField> {
  const altitude = draft.minAltitudeDeg
  const minutes = draft.minDurationMinutes
  const separation = draft.minSeparationDeg
  return {
    minAltitudeDeg: altitude !== null && Number.isFinite(altitude) && altitude >= 0 && altitude < 90 ? undefined : m.criteria_error_altitude(),
    darkness: draft.darkness === "" ? m.criteria_error_choose() : undefined,
    moon: draft.moon === "" ? m.criteria_error_choose() : undefined,
    minSeparationDeg:
      draft.moon !== "min_separation" || (separation !== null && Number.isFinite(separation) && separation > 0 && separation < 180) ? undefined : m.criteria_error_separation(),
    minDurationMinutes: minutes !== null && Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES ? undefined : m.criteria_error_duration(),
  }
}

/** The criteria a whole draft sets; `null` while a field is missing. */
export function criteriaOf(draft: CriteriaDraft): PlanCriteria | null {
  const { minAltitudeDeg, darkness, moon, minSeparationDeg, minDurationMinutes } = draft
  if (minAltitudeDeg === null || darkness === "" || moon === "" || minDurationMinutes === null) return null
  if (moon === "min_separation") {
    if (minSeparationDeg === null) return null
    return { minAltitudeDeg, darkness, moon: { kind: moon, minSeparationDeg }, minDurationMinutes }
  }
  return { minAltitudeDeg, darkness, moon: { kind: moon }, minDurationMinutes }
}
