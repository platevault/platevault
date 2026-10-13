/**
 * Home concept "Progress": what the light sessions of a recent period
 * (7, 30 or 90 nights) added to each goal of an open Project, what is
 * captured but not yet counted in the Project, and the frames from that
 * period still waiting for review.
 *
 * Only here: progress per period. Project pages show each goal's totals,
 * Sessions lists captures without the goals they feed; neither says what
 * recent nights changed.
 */
import { History } from "lucide-react"
import { useMemo } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import type { Column, MenuItem } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { KeyValueList } from "@/components/app/data"
import { EmptyState } from "@/components/app/feedback"
import { SegmentedField } from "@/components/app/fields"
import { Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { UsedByPreview } from "@/components/app/previews"
import { formatHours, projectLink, sessionsNeedingWork } from "@/domain/derive"
import { sessionBreakdown } from "@/domain/library"
import { sessionLabel } from "@/domain/membership"
import { shiftNight } from "@/domain/planning"
import { formatCount } from "@/lib/format"
import { sessionReviewSearch } from "@/features/v5/a-home/session-model"
import { type GoalMovement, recentProgress } from "./model"
import { type ConceptContext, goalAmount, goalShare, goalSubject, targetLink } from "./shared"

export const PERIODS = ["7", "30", "90"] as const
export type Period = (typeof PERIODS)[number]

export function parsePeriod(value: string | undefined): Period {
  return (PERIODS as readonly string[]).includes(value ?? "") ? (value as Period) : "30"
}

export function ProgressConcept({ ctx, period, onPeriod }: { ctx: ConceptContext; period: Period; onPeriod: (period: Period) => void }) {
  const m = useMessages()
  const follow = useFollowLink()
  const { world, tonight } = ctx
  const { catalog, disk } = world
  const since = shiftNight(tonight, -Number(period))
  const progress = useMemo(() => recentProgress(catalog, since), [catalog, since])
  const waiting = useMemo(() => sessionsNeedingWork(catalog).unreviewed.filter((u) => u.session.night >= since), [catalog, since])
  const captured = useMemo(
    () =>
      progress.sessions.reduce(
        (sum, session) => {
          const totals = sessionBreakdown(disk, catalog, session).captured
          return { frames: sum.frames + totals.frames, seconds: sum.seconds + totals.seconds }
        },
        { frames: 0, seconds: 0 },
      ),
    [progress, disk, catalog],
  )
  const nights = new Set(progress.sessions.map((s) => s.night)).size
  const waitingFrames = waiting.reduce((sum, u) => sum + u.frames, 0)

  const goalLabel = (g: GoalMovement) => goalSubject(m, catalog, g.project, g.progress.goal.subjectId, g.progress.goal.panelId)
  const pending = (g: GoalMovement) => g.progress.measure.captured - g.progress.measure.inProject
  const amount = (g: GoalMovement, value: number) => goalAmount(m, g.progress.measure.unit, value)

  const columns: Column<GoalMovement>[] = [
    {
      id: "goal",
      header: m.home_concept_column_goal(),
      rowHeader: true,
      sortValue: goalLabel,
      cell: (g) => (
        <>
          {goalLabel(g)}
          {g.progress.met ? (
            <>
              {" "}
              <Pill tone="success">{m.home_concept_met()}</Pill>
            </>
          ) : null}
        </>
      ),
    },
    { id: "channel", header: m.home_concept_column_channel(), sortValue: (g) => g.progress.goal.channel, cell: (g) => <Pill>{g.progress.goal.channel}</Pill> },
    { id: "added", header: m.home_concept_column_added(), align: "right", sortValue: (g) => goalShare(g.progress.measure, g.added), cell: (g) => m.home_concept_added({ amount: amount(g, g.added) }) },
    {
      id: "in-project",
      header: m.home_column_in_project(),
      align: "right",
      sortValue: (g) => goalShare(g.progress.measure, g.progress.measure.inProject),
      cell: (g) =>
        g.progress.measure.target === null
          ? amount(g, g.progress.measure.inProject)
          : m.home_concept_of_goal({ amount: amount(g, g.progress.measure.inProject), target: amount(g, g.progress.measure.target) }),
    },
    {
      id: "pending",
      header: m.home_concept_column_pending(),
      align: "right",
      sortValue: (g) => goalShare(g.progress.measure, pending(g)),
      cell: (g) => (pending(g) > 0 ? amount(g, pending(g)) : "–"),
    },
  ]
  const goalActions = (g: GoalMovement): MenuItem[] => [
    { id: "project", label: m.target_open_project(), run: () => follow(projectLink(g.project.id)) },
    ...(g.target ? [{ id: "target", label: m.project_open_target(), run: () => follow(targetLink(g.target!.id, tonight, tonight)) }] : []),
  ]

  return (
    <Section id="home-concept-progress" title={m.home_concept_progress()}>
      <SegmentedField
        label={m.home_concept_period()}
        value={period}
        options={PERIODS.map((value) => ({ value, label: m.home_concept_night_count({ count: Number(value) }) }))}
        onChange={onPeriod}
      />
      <KeyValueList
        columns={2}
        items={[
          { label: m.home_concept_capture_nights(), value: m.home_concept_night_count({ count: nights }) },
          {
            label: m.home_concept_captured(),
            value: m.home_concept_captured_value({ frames: m.home_concept_frames({ count: captured.frames, frames: formatCount(captured.frames) }), time: formatHours(captured.seconds) }),
          },
          {
            label: m.home_concept_waiting_review(),
            value:
              waitingFrames === 0 ? (
                "–"
              ) : (
                <UsedByPreview
                  label={m.home_concept_frames({ count: waitingFrames, frames: formatCount(waitingFrames) })}
                  link={{ to: "/sessions" }}
                  items={waiting.map((u) => ({
                    label: m.home_concept_session_item({ session: sessionLabel(m, u.session), frames: m.home_concept_frames({ count: u.frames, frames: formatCount(u.frames) }) }),
                    link: { to: "/sessions/$sessionId", params: { sessionId: u.session.id }, search: sessionReviewSearch(u.frames) },
                  }))}
                />
              ),
          },
          { label: m.home_concept_goals_moved(), value: m.home_concept_goal_count({ count: progress.goals.length }) },
        ]}
      />
      <DataTable
        label={m.home_concept_progress()}
        rows={progress.goals}
        columns={columns}
        getRowId={(g) => g.progress.goal.id}
        scroll="none"
        initialSort={{ columnId: "added", direction: "desc" }}
        groups={{ key: (g) => g.project.name, label: (name, rows) => m.home_concept_group({ name, count: rows.length }) }}
        rowLabel={(g) => m.home_concept_goal_item({ subject: goalLabel(g), channel: g.progress.goal.channel })}
        rowActions={goalActions}
        onRowClick={(g) => follow(projectLink(g.project.id))}
        empty={<EmptyState icon={History} title={m.home_concept_no_captures()} action={<UsedByPreview label={m.session_open_sessions()} link={{ to: "/sessions" }} items={[]} />} />}
      />
    </Section>
  )
}
