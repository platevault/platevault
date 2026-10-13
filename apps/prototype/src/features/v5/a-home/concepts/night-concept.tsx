/**
 * Home concept "Night" (Q8 A1+, R9-HOME-DEBATE §4): the planning site and
 * night, the night's darkness, Moon and plan as one-line facts, every unmet
 * goal graded for that night and the 29 after it, and each open Project's
 * next step, most urgent first.
 *
 * Only here: unmet goals joined with their filter's grade over 30 nights
 * (Targets grades one night for every target; Project goals carry no
 * windows), and the next steps of all open Projects in urgency order (the
 * Projects list sorts by name).
 */
import { useNavigate } from "@tanstack/react-router"
import { CircleCheck, FolderPlus, MapPin } from "lucide-react"
import { useMemo } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import { ActionButton, useAction } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { KeyValueList } from "@/components/app/data"
import { EmptyState } from "@/components/app/feedback"
import { Section } from "@/components/app/page"
import { NightPicker, SitePicker } from "@/components/app/pickers"
import { Pill } from "@/components/app/pill"
import { UsedByPreview } from "@/components/app/previews"
import { DarkLine, MoonLine } from "@/components/domain/sky-lines"
import { formatHours, projectLink } from "@/domain/derive"
import { nightPlan } from "@/domain/planning"
import { formatCount, formatNight } from "@/lib/format"
import { say } from "@/lib/i18n"
import { addToPlan } from "@/store/actions/planning"
import { type GoalOutlook, goalHorizon, HORIZON_NIGHTS, type NextStep, nextGoodNight, upNext } from "./model"
import {
  type ConceptContext,
  chosenNight,
  GRADE_RANK,
  GRADE_TONE,
  goalAmount,
  goalShare,
  goalSubject,
  gradeLabel,
  planningSiteAction,
  siteOptions,
  targetLink,
  targetsLink,
} from "./shared"

/** Rows Up next shows before "All Projects" (R9-HOME-DEBATE §4.2). */
const UP_NEXT_ROWS = 5

export function NightConcept({ ctx, requestedNight, onNight }: { ctx: ConceptContext; requestedNight: string | undefined; onNight: (night: string) => void }) {
  const m = useMessages()
  const navigate = useNavigate()
  const follow = useFollowLink()
  const siteRunner = useAction()
  const { world, site, nowMs, tonight } = ctx
  const { catalog } = world
  const night = chosenNight(requestedNight, tonight)
  const horizon = useMemo(() => (site ? goalHorizon(catalog, site, nowMs, night) : null), [catalog, site, nowMs, night])
  const planned = useMemo(() => nightPlan(catalog, night), [catalog, night])
  const plannedIds = useMemo(() => new Set(planned.map((t) => t.id)), [planned])
  const steps = useMemo(() => upNext(world, nowMs), [world, nowMs])

  const goalLabel = (g: GoalOutlook) => goalSubject(m, catalog, g.subject.project, g.progress.goal.subjectId, g.progress.goal.panelId)
  const rowName = (g: GoalOutlook) => m.home_concept_goal_item({ subject: goalLabel(g), channel: g.progress.goal.channel })
  const goodNights = (g: GoalOutlook) => g.grades?.filter((grade) => grade === "good").length ?? null
  const nextGood = (g: GoalOutlook) => (g.grades ? nextGoodNight(g.grades) : null)

  const openTarget = (g: GoalOutlook) => follow(targetLink(g.subject.target.id, night, tonight))
  const goalActions = (g: GoalOutlook): MenuItem[] => {
    const items: MenuItem[] = []
    if (!plannedIds.has(g.subject.target.id)) items.push({ id: "plan", label: m.targets_add_to_plan(), run: () => addToPlan(g.subject.target.id, night) })
    items.push({ id: "target", label: m.project_open_target(), run: () => openTarget(g) })
    items.push({ id: "project", label: m.target_open_project(), run: () => follow(projectLink(g.subject.project.id)) })
    return items
  }

  const goalColumns: Column<GoalOutlook>[] = [
    {
      id: "goal",
      header: m.home_concept_column_goal(),
      rowHeader: true,
      sortValue: goalLabel,
      cell: (g) => (
        <>
          {goalLabel(g)}
          {plannedIds.has(g.subject.target.id) ? (
            <>
              {" "}
              <Pill tone="info">{m.home_concept_on_plan()}</Pill>
            </>
          ) : null}
        </>
      ),
    },
    { id: "channel", header: m.home_concept_column_channel(), sortValue: (g) => g.progress.goal.channel, cell: (g) => <Pill>{g.progress.goal.channel}</Pill> },
    {
      id: "remaining",
      header: m.home_concept_column_remaining(),
      align: "right",
      sortValue: (g) => goalShare(g.progress.measure, g.progress.measure.remaining),
      cell: (g) => (g.progress.measure.remaining === null ? "–" : goalAmount(m, g.progress.measure.unit, g.progress.measure.remaining)),
    },
    {
      id: "night",
      header: formatNight(night),
      sortValue: (g) => (g.grades ? GRADE_RANK[g.grades[0]!] : null),
      cell: (g) => (g.grades ? <Pill tone={GRADE_TONE[g.grades[0]!]}>{gradeLabel(m, g.grades[0]!)}</Pill> : "–"),
    },
    {
      id: "next",
      header: m.home_concept_column_next_good(),
      sortValue: nextGood,
      cell: (g) => {
        const index = nextGood(g)
        return index === null || !horizon ? "–" : formatNight(horizon.nights[index]!)
      },
    },
    {
      id: "good",
      header: m.home_concept_column_good_nights(),
      align: "right",
      sortValue: goodNights,
      cell: (g) => {
        const count = goodNights(g)
        return count === null ? "–" : m.home_concept_of_nights({ count: formatCount(count), total: formatCount(HORIZON_NIGHTS) })
      },
    },
  ]

  const stepColumns: Column<NextStep>[] = [
    { id: "project", header: m.home_concept_column_project(), rowHeader: true, sortValue: (s) => s.project.name, cell: (s) => s.project.name },
    { id: "reason", header: m.home_concept_column_reason(), sortValue: (s) => say(m, s.next.reason), cell: (s) => say(m, s.next.reason) },
  ]
  const nextAction = (s: NextStep): Action => ({ id: `next-${s.project.id}`, label: say(m, s.next.label), run: () => follow(s.next.link) })
  const newProject: Action = { id: "new-project", label: m.newproject_open(), opensDialog: true, run: () => openSheet({ kind: "new-project" }) }
  const addSite: Action = { id: "add-site", label: m.tonight_add_site(), run: () => void navigate({ to: "/settings/sites" }) }

  // The open-goal subject with the most Img time on the night: what to point at first.
  const best = horizon?.subjects.reduce<{ name: string; minutes: number; targetId: string } | null>((top, s) => {
    const minutes = s.minutes[0] ?? 0
    if (minutes === 0 || (top && top.minutes >= minutes)) return top
    return { name: goalSubject(m, catalog, s.project, s.subject.id, null), minutes, targetId: s.target.id }
  }, null)
  const summary = horizon?.summaries[0]

  return (
    <>
      <Section
        id="home-concept-planning"
        title={m.home_concept_planning()}
        description={
          summary && site ? (
            <>
              <DarkLine darkness={summary.darkness} timeZone={site.timeZone} />
              {" · "}
              <MoonLine moon={summary.moon} timeZone={site.timeZone} />
            </>
          ) : undefined
        }
        actions={
          <>
            <SitePicker
              value={site?.id ?? null}
              onChange={(siteId) => siteRunner.run(planningSiteAction(m, siteId))}
              sites={siteOptions(catalog)}
              defaultSiteId={world.settings.defaultSiteId}
              onManage={() => void navigate({ to: "/settings/sites" })}
            />
            {site ? <NightPicker value={night} onChange={onNight} today={tonight} /> : null}
            {siteRunner.feedback}
          </>
        }
      >
        {site ? (
          <KeyValueList
            columns={2}
            items={[
              {
                label: m.home_concept_planned(),
                value: (
                  <UsedByPreview
                    label={planned.length > 0 ? m.home_concept_target_count({ count: planned.length }) : m.home_concept_nothing_planned()}
                    link={targetsLink(night, tonight, "planned")}
                    items={planned.map((t) => ({ label: t.name, link: targetLink(t.id, night, tonight) }))}
                  />
                ),
              },
              {
                label: m.home_concept_best(),
                value: best ? (
                  <UsedByPreview label={m.home_concept_best_value({ name: best.name, time: formatHours(best.minutes * 60) })} link={targetLink(best.targetId, night, tonight)} items={[]} />
                ) : (
                  "–"
                ),
              },
            ]}
          />
        ) : (
          <EmptyState icon={MapPin} title={m.home_no_site()} action={<ActionButton action={addSite} />} />
        )}
      </Section>

      {horizon ? (
        <Section id="home-concept-needs" title={m.home_concept_needs()}>
          <DataTable
            label={m.home_concept_needs()}
            rows={horizon.goals}
            columns={goalColumns}
            getRowId={(g) => g.progress.goal.id}
            scroll="none"
            initialSort={{ columnId: "good", direction: "asc" }}
            groups={{ key: (g) => g.subject.project.name, label: (name, rows) => m.home_concept_group({ name, count: rows.length }) }}
            rowLabel={rowName}
            rowActions={goalActions}
            onRowClick={openTarget}
            empty={
              <EmptyState icon={CircleCheck} title={m.home_concept_goals_met()} action={<UsedByPreview label={m.home_concept_all_projects()} link={{ to: "/projects" }} items={[]} />} />
            }
          />
        </Section>
      ) : null}

      <Section
        id="home-concept-up-next"
        title={m.common_up_next()}
        actions={
          steps.length > 0 ? (
            <UsedByPreview
              label={m.home_concept_all_projects()}
              link={{ to: "/projects" }}
              items={steps.slice(UP_NEXT_ROWS).map((s) => ({ label: s.project.name, link: projectLink(s.project.id) }))}
            />
          ) : null
        }
      >
        <DataTable
          label={m.common_up_next()}
          rows={steps.slice(0, UP_NEXT_ROWS)}
          columns={stepColumns}
          getRowId={(s) => s.project.id}
          scroll="none"
          rowLabel={(s) => s.project.name}
          primaryRowAction={nextAction}
          rowActions={(s) => [{ id: "project", label: m.target_open_project(), run: () => follow(projectLink(s.project.id)) }]}
          onRowClick={(s) => follow(projectLink(s.project.id))}
          empty={<EmptyState icon={FolderPlus} title={m.home_concept_no_open_projects()} action={<ActionButton action={newProject} />} />}
        />
      </Section>
    </>
  )
}
