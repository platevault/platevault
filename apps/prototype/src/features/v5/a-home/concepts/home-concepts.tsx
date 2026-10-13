/**
 * `#/home-concepts` (bead astro-plan-5kpyp): the Home concepts side by side
 * for the user's C8 choice, a dashboard that adds value without repeating a
 * page. A switcher picks the concept (`?concept=`) and states, in one line,
 * what only that concept shows. The route loads lazily and goes once C8 is
 * decided.
 *
 * Search keys: `concept` (night · month · progress), `night` (the Night
 * concept's chosen night, as Targets reads it) and `period` (the Progress
 * concept's 7, 30 or 90 nights).
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMessages } from "@/app/preferences"
import { SegmentedField } from "@/components/app/fields"
import { PageBody, PageHeader } from "@/components/app/page"
import type { SearchParams } from "@/routes"
import { MonthConcept } from "./month-concept"
import { NightConcept } from "./night-concept"
import { parsePeriod, ProgressConcept } from "./progress-concept"
import { useConceptContext } from "./shared"

const CONCEPTS = ["night", "month", "progress"] as const
type ConceptId = (typeof CONCEPTS)[number]

function parseConcept(value: string | undefined): ConceptId {
  return (CONCEPTS as readonly string[]).includes(value ?? "") ? (value as ConceptId) : "night"
}

export function HomeConceptsPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as SearchParams
  const ctx = useConceptContext()
  const concept = parseConcept(search.concept)

  function setSearch(patch: SearchParams) {
    void navigate({
      to: "/home-concepts",
      search: (previous: SearchParams) => {
        const next: SearchParams = { ...previous, ...patch }
        for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === "") delete next[key]
        return next
      },
      replace: true,
    } as never)
  }

  const names: Record<ConceptId, string> = { night: m.home_concept_night(), month: m.home_concept_month(), progress: m.home_concept_progress() }
  const statements: Record<ConceptId, string> = { night: m.home_concept_night_only(), month: m.home_concept_month_only(), progress: m.home_concept_progress_only() }

  return (
    <>
      <PageHeader title={m.home_concept_title()} />
      <PageBody>
        <SegmentedField
          label={m.home_concept_switch()}
          value={concept}
          options={CONCEPTS.map((value) => ({ value, label: names[value] }))}
          onChange={(value) => setSearch({ concept: value })}
          description={statements[concept]}
        />
        {concept === "night" ? <NightConcept ctx={ctx} requestedNight={search.night} onNight={(night) => setSearch({ night: night === ctx.tonight ? undefined : night })} /> : null}
        {concept === "month" ? <MonthConcept ctx={ctx} /> : null}
        {concept === "progress" ? <ProgressConcept ctx={ctx} period={parsePeriod(search.period)} onPeriod={(period) => setSearch({ period })} /> : null}
      </PageBody>
    </>
  )
}
