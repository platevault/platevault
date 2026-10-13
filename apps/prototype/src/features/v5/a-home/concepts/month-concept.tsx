/**
 * Home concept "Month": the next 30 nights at the planning site, one row
 * each and grouped by week, with the night's darkness, the Moon, the unmet
 * goals the night suits or the Moon limits, and the night's plan.
 *
 * Only here: more than one night at a time. Targets and its Planned view
 * show one chosen night; nothing else lists nights ahead.
 */
import { useNavigate } from "@tanstack/react-router"
import { MapPin } from "lucide-react"
import { useMemo } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { ActionButton, useAction } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { KeyValueList } from "@/components/app/data"
import { EmptyState } from "@/components/app/feedback"
import { Section } from "@/components/app/page"
import { SitePicker } from "@/components/app/pickers"
import { UsedByPreview } from "@/components/app/previews"
import { formatHours } from "@/domain/derive"
import { nightPlan, shiftNight, type Tonight } from "@/domain/planning"
import type { NightDate, Target } from "@/domain/types"
import { formatNight } from "@/lib/format"
import { say } from "@/lib/i18n"
import { type GoalOutlook, goalHorizon, weekOf } from "./model"
import { type ConceptContext, goalSubject, planningSiteAction, siteOptions, targetLink, targetsLink } from "./shared"

interface NightRow {
  night: NightDate
  summary: Tonight
  /** Seconds of darkness at the site; null when it never gets dark. */
  darkS: number | null
  good: GoalOutlook[]
  limited: GoalOutlook[]
  planned: Target[]
}

export function MonthConcept({ ctx }: { ctx: ConceptContext }) {
  const m = useMessages()
  const navigate = useNavigate()
  const follow = useFollowLink()
  const siteRunner = useAction()
  const { world, site, nowMs, tonight } = ctx
  const { catalog } = world
  const horizon = useMemo(() => (site ? goalHorizon(catalog, site, nowMs, tonight) : null), [catalog, site, nowMs, tonight])
  const rows = useMemo<NightRow[]>(
    () =>
      horizon?.nights.map((night, i) => {
        const summary = horizon.summaries[i]!
        const dark = summary.darkness
        return {
          night,
          summary,
          darkS: dark ? (Date.parse(dark.end) - Date.parse(dark.start)) / 1000 : null,
          good: horizon.goals.filter((g) => g.grades?.[i] === "good"),
          limited: horizon.goals.filter((g) => g.moonLimited?.[i] === true),
          planned: nightPlan(catalog, night),
        }
      }) ?? [],
    [horizon, catalog],
  )

  const goalItems = (goals: GoalOutlook[], night: NightDate) =>
    goals.map((g) => ({
      label: m.home_concept_goal_item({ subject: goalSubject(m, catalog, g.subject.project, g.progress.goal.subjectId, g.progress.goal.panelId), channel: g.progress.goal.channel }),
      link: targetLink(g.subject.target.id, night, tonight),
    }))
  const goalsCell = (goals: GoalOutlook[], night: NightDate) =>
    goals.length === 0 ? "–" : <UsedByPreview label={m.home_concept_goal_count({ count: goals.length })} link={targetsLink(night, tonight)} items={goalItems(goals, night)} />
  const moonText = (r: NightRow) => m.home_concept_moon_value({ illumination: r.summary.moon.illuminationPct, phase: say(m, r.summary.moon.phase) })

  const columns: Column<NightRow>[] = [
    {
      id: "night",
      header: m.home_concept_column_night(),
      rowHeader: true,
      sortValue: (r) => r.night,
      cell: (r) => formatNight(r.night),
    },
    { id: "dark", header: m.home_concept_column_dark(), align: "right", sortValue: (r) => r.darkS, cell: (r) => (r.darkS === null ? "–" : formatHours(r.darkS)) },
    { id: "moon", header: m.home_concept_moon(), sortValue: (r) => r.summary.moon.illuminationPct, cell: moonText },
    { id: "good", header: m.home_concept_column_good_for(), sortValue: (r) => r.good.length, cell: (r) => goalsCell(r.good, r.night) },
    { id: "limited", header: m.home_concept_column_limited(), sortValue: (r) => r.limited.length, cell: (r) => goalsCell(r.limited, r.night) },
    {
      id: "planned",
      header: m.home_concept_planned(),
      sortValue: (r) => r.planned.length,
      cell: (r) =>
        r.planned.length === 0 ? (
          "–"
        ) : (
          <UsedByPreview
            label={m.home_concept_target_count({ count: r.planned.length })}
            link={targetsLink(r.night, tonight, "planned")}
            items={r.planned.map((t) => ({ label: t.name, link: targetLink(t.id, r.night, tonight) }))}
          />
        ),
    },
  ]
  const nightActions = (r: NightRow): MenuItem[] => [
    { id: "targets", label: m.home_concept_open_in_targets(), run: () => follow(targetsLink(r.night, tonight)) },
    { id: "plan", label: m.home_concept_open_plan(), run: () => follow(targetsLink(r.night, tonight, "planned")) },
  ]
  const addSite: Action = { id: "add-site", label: m.tonight_add_site(), run: () => void navigate({ to: "/settings/sites" }) }

  // The facts over the whole horizon: the darkest night, the night most goals suit, and the nights already planned.
  const darkest = rows.reduce<NightRow | null>((low, r) => (!low || r.summary.moon.illuminationPct < low.summary.moon.illuminationPct ? r : low), null)
  const best = rows.reduce<NightRow | null>((top, r) => (r.good.length > 0 && (!top || r.good.length > top.good.length || (r.good.length === top.good.length && (r.darkS ?? 0) > (top.darkS ?? 0))) ? r : top), null)
  const plannedNights = rows.filter((r) => r.planned.length > 0)

  return (
    <Section
      id="home-concept-outlook"
      title={m.home_concept_outlook()}
      actions={
        <>
          <SitePicker
            value={site?.id ?? null}
            onChange={(siteId) => siteRunner.run(planningSiteAction(m, siteId))}
            sites={siteOptions(catalog)}
            defaultSiteId={world.settings.defaultSiteId}
            onManage={() => void navigate({ to: "/settings/sites" })}
          />
          {siteRunner.feedback}
        </>
      }
    >
      {site && horizon ? (
        <>
          <KeyValueList
            columns={2}
            items={[
              { label: m.home_concept_darkest(), value: darkest ? m.home_concept_night_fact({ night: formatNight(darkest.night), detail: moonText(darkest) }) : "–" },
              {
                label: m.home_concept_best_night(),
                value: best ? m.home_concept_night_fact({ night: formatNight(best.night), detail: m.home_concept_goals_good({ count: best.good.length }) }) : "–",
              },
              {
                label: m.home_concept_planned(),
                value:
                  plannedNights.length === 0 ? (
                    m.home_concept_nothing_planned()
                  ) : (
                    <UsedByPreview
                      label={m.home_concept_night_count({ count: plannedNights.length })}
                      link={targetsLink(plannedNights[0]!.night, tonight, "planned")}
                      items={plannedNights.map((r) => ({
                        label: m.home_concept_night_fact({ night: formatNight(r.night), detail: r.planned.map((t) => t.name).join(", ") }),
                        link: targetsLink(r.night, tonight, "planned"),
                      }))}
                    />
                  ),
              },
            ]}
          />
          <DataTable
            label={m.home_concept_outlook()}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.night}
            scroll="none"
            groups={{ key: (r) => weekOf(r.night), label: (week) => m.home_concept_week({ from: formatNight(week), to: formatNight(shiftNight(week, 6)) }) }}
            rowLabel={(r) => formatNight(r.night)}
            rowActions={nightActions}
            onRowClick={(r) => follow(targetsLink(r.night, tonight))}
          />
        </>
      ) : (
        <EmptyState icon={MapPin} title={m.home_no_site()} action={<ActionButton action={addSite} />} />
      )}
    </Section>
  )
}
