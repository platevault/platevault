/**
 * "Good tonight" as the library grades it.
 *
 * - Suitable filters (PLAN-TGT-FR-15): a toolbar filter over the Filters
 *   strip's bands (`?good=`). A row qualifies when the library grades any
 *   chosen band good or marginal for it on the page's night, and the list
 *   sorts by the longest clear time among the chosen bands
 *   (targets-model.ts `byClearTime`).
 * - Goal grades (PLAN-FR-11): tonight's grade of each unfinished goal whose
 *   subject is this Target, from Home's Tonight (`planning_tonight`), so a
 *   Target page shows the same grade Home shows.
 */
import type { Band, GoalGrade_Serialize, TargetRow_Serialize, Tonight_Serialize } from "@/api/ipc"
import type { Facet } from "@/components/app/contracts"
import type { Messages } from "@/lib/i18n"
import { suits } from "./targets-model"

/** The Suitable filters facet over the page's bands, each counted by the rows it suits. */
export function suitableFacet(m: Messages, bands: readonly Band[], rows: readonly TargetRow_Serialize[], chosen: readonly Band[]): Facet {
  return {
    id: "good",
    label: m.domain_suitable_filters(),
    kind: "multi",
    value: chosen.filter((b) => bands.includes(b)),
    options: bands.map((band) => ({ value: band, label: band, count: rows.filter((r) => r.bands.some((b) => b.band === band && suits(b))).length })),
  }
}

/** Tonight's graded goals of one Target, best first as the library orders them. */
export function goalGradesFor(tonight: Tonight_Serialize, targetId: string): GoalGrade_Serialize[] {
  return tonight.goals.filter((g) => g.targetId === targetId)
}
