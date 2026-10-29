/**
 * The planning criteria Home's Tonight is computed with (PLAN-FR-11).
 *
 * `home_dashboard` takes explicit `PlanCriteria` for its whole payload, and
 * `PlanCriteria` has no defaults by design: every field is the user's. The
 * stored Home criteria are a Settings value that does not exist yet
 * (astro-plan-wre19.9). Until it lands, every Home section built on
 * `home_dashboard` shows its "unavailable" state; this hook is the one
 * place to switch over.
 */
import type { PlanCriteria } from "@/api/ipc"

export type HomeCriteria = { state: "unavailable" } | { state: "ready"; criteria: PlanCriteria }

const UNAVAILABLE: HomeCriteria = { state: "unavailable" }

/** Home's criteria; `unavailable` until the Settings value of astro-plan-wre19.9 exists. */
export function useHomeCriteria(): HomeCriteria {
  // astro-plan-wre19.9: read the stored Home criteria here once the library serves them.
  return UNAVAILABLE
}
