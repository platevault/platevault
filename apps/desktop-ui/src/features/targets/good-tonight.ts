/**
 * "Good tonight" as the library grades it.
 *
 * - Suitable filters (PLAN-TGT-FR-15): a toolbar filter over the Filters
 *   strip's bands (`?good=`). The library keeps a row when it grades any
 *   chosen band good or marginal for it on the page's night, and orders the
 *   list by the longest clear time among the chosen bands, before it pages.
 * - Goal grades (PLAN-FR-11): tonight's grade of each unfinished goal whose
 *   subject is this Target, from Home's Tonight (`planning_tonight`), so a
 *   Target page shows the same grade Home shows.
 */
import type { Band, GoalGrade_Serialize, Tonight_Serialize } from "@/api/ipc"
import type { Facet } from "@/components/app/contracts"
import type { Messages } from "@/lib/i18n"

/**
 * The Suitable filters facet over the page's bands. It carries no counts: the
 * library filters the rows, so the rows on hand cannot count the whole list.
 */
export function suitableFacet(m: Messages, bands: readonly Band[], chosen: readonly Band[]): Facet {
  return {
    id: "good",
    label: m.domain_suitable_filters(),
    kind: "multi",
    value: chosen.filter((b) => bands.includes(b)),
    options: bands.map((band) => ({ value: band, label: band })),
  }
}

/** Tonight's graded goals of one Target, best first as the library orders them. */
export function goalGradesFor(tonight: Tonight_Serialize, targetId: string): GoalGrade_Serialize[] {
  return tonight.goals.filter((g) => g.targetId === targetId)
}
