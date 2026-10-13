/**
 * What every Home concept reads: the planning site, tonight there and the
 * clock, from narrow store selectors instead of the whole state
 * (R9-HOME-DEBATE §4.4), plus the words and links the concepts share.
 */
import { useMemo } from "react"
import type { Action } from "@/components/app/contracts"
import type { Tone } from "@/components/app/status"
import { findSubject, formatHours, planningSite, subjectName, type StepLink, type World } from "@/domain/derive"
import { type FilterGrade, upcomingNight } from "@/domain/planning"
import type { GoalMeasure } from "@/domain/templates"
import type { Catalog, NightDate, ObservingSite, Project, Subject, TargetId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { type Messages, msg } from "@/lib/i18n"
import { commit, nowIso, useStore } from "@/store/core"

const NIGHT = /^\d{4}-\d{2}-\d{2}$/

export interface ConceptContext {
  world: World
  /** The planning site Targets uses too (`planningSite`); null without one. */
  site: ObservingSite | null
  nowMs: number
  /** Tonight at the site (`upcomingNight`), else today's date. */
  tonight: NightDate
}

/** The concepts' shared reading of the store, re-derived every 10 minutes of the (simulated) clock. */
export function useConceptContext(): ConceptContext {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const operations = useStore((s) => s.operations)
  const settings = useStore((s) => s.settings)
  const faults = useStore((s) => s.faults)
  const bucket = Math.floor((Date.now() + faults.clockOffsetMs) / 600_000)
  return useMemo(() => {
    const world: World = { disk, catalog, operations, settings, faults }
    const site = planningSite(world)
    const nowMs = Date.parse(nowIso())
    return { world, site, nowMs, tonight: site ? upcomingNight(site, nowMs) : nowIso().slice(0, 10) }
    // `bucket` re-derives tonight as the clock moves on.
  }, [disk, catalog, operations, settings, faults, bucket])
}

/** A chosen night (`?night=`): a valid date after tonight, else tonight, as Targets reads it. */
export function chosenNight(requested: string | undefined, tonight: NightDate): NightDate {
  return requested && NIGHT.test(requested) && !Number.isNaN(Date.parse(requested)) && requested > tonight ? requested : tonight
}

/** The sites for a SitePicker, by name. */
export function siteOptions(catalog: Catalog): { id: string; name: string }[] {
  return Object.values(catalog.sites)
    .map((site) => ({ id: site.id, name: site.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Pick the planning site: the one setting Home and Targets share (R9-HOME-DEBATE §3). */
export function planningSiteAction(m: Messages, siteId: string): Action {
  return {
    id: "planning-site",
    label: m.plan_site(),
    run: () => commit(msg("plan_site"), (s) => ({ ...s, settings: { ...s.settings, planningSiteId: siteId } }), { href: "/home-concepts" }),
  }
}

/** A goal's amount in its own unit: "6h10" or "120 frames". */
export function goalAmount(m: Messages, unit: GoalMeasure["unit"], value: number): string {
  return unit === "time" ? formatHours(value) : m.home_concept_frames({ count: value, frames: formatCount(value) })
}

/** A share of a goal's target, for sorting goals of either unit together; null without a target. */
export function goalShare(measure: GoalMeasure, value: number | null): number | null {
  return value === null || !measure.target ? null : value / measure.target
}

/** The goal's subject, with its panel for a mosaic panel's goal: "IC 5070 · Panel 2". */
export function goalSubject(m: Messages, catalog: Catalog, project: Project, subjectId: string, panelId: string | null): string {
  const subject: Subject | undefined = findSubject(project, subjectId)
  const name = subject ? subjectName(m, catalog, subject) : m.plan_unknown_target()
  const panel = panelId ? subject?.mosaic?.panels.find((p) => p.id === panelId) : undefined
  return panel ? m.home_panel({ name, n: panel.n }) : name
}

export const GRADE_TONE: Record<FilterGrade, Tone> = { good: "success", marginal: "warning", poor: "muted" }

/** Sort order of the grades: good first. */
export const GRADE_RANK: Record<FilterGrade, number> = { good: 0, marginal: 1, poor: 2 }

export function gradeLabel(m: Messages, grade: FilterGrade): string {
  return { good: m.home_concept_grade_good, marginal: m.home_concept_grade_marginal, poor: m.home_concept_grade_poor }[grade]()
}

/** Targets on a night: no `night` for tonight, as Targets reads an absent night. */
export function targetsLink(night: NightDate, tonight: NightDate, view?: "planned"): StepLink {
  const search: Record<string, string> = {}
  if (view) search.view = view
  if (night !== tonight) search.night = night
  return { to: "/targets", search }
}

export function targetLink(targetId: TargetId, night: NightDate, tonight: NightDate): StepLink {
  return { to: "/targets/$targetId", params: { targetId }, search: night === tonight ? {} : { night } }
}
