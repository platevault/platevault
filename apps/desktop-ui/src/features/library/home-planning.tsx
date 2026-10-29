/**
 * Home's Tonight and calendar (PLAN-FR-11, PLAN-FR-12; D-W88, D-W89), as the
 * library computes them at the default site under Home's stored criteria.
 * Home words and links them; it never grades a goal or places a night.
 *
 * - Tonight: every unfinished goal of an open Project, best first, with its
 *   band grade and best window, or why it has no grade. When no goal suits
 *   tonight, a note above the table says when one next does.
 * - Calendar: tonight through the end of the fifth week from the start of
 *   this week (the locale's first day), one `planning_calendar` read. Each
 *   night shows its Moon, its hours of darkness and the goals it suits, and
 *   its card lists those goals, best first, and the goals the Moon rules out.
 *
 * Both read `no_site` or `no_criteria` while the default site or Home's
 * criteria are missing. Tonight offers to set them; the calendar under it
 * names the same gap without a second set of buttons. The Targets in each
 * night's plan are not served yet (astro-plan-wre19.14) and read as
 * unavailable, never as none.
 */
import { useQuery } from "@tanstack/react-query"
import { FolderPlus, MapPin, SlidersHorizontal } from "lucide-react"
import type {
  CalendarNight_Serialize,
  GoalGrade_Serialize,
  HomePlanningUnavailable,
  MoonPhase as MoonPhaseName,
  NextGoodNight_Serialize,
  NightMoon_Serialize,
  Tonight_Serialize,
  Ungraded,
  WindowUnavailableReason,
} from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Column, StepLink } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { ActionError, EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { GradeBadges } from "@/components/domain/grade-badges"
import { type CalendarNight, moonPhrase, NightCalendar } from "@/components/domain/night-calendar"
import { type MoonTonight, siteTime, siteTimeRange } from "@/components/domain/sky-lines"
import { formatCount, formatList, formatNight } from "@/lib/format"
import { getLocale, type MessageRef, type Messages, msg } from "@/lib/i18n"
import { dayInWeek, WEEK_START } from "@/lib/week"
import { ROWS } from "./ingestions"
import { readError } from "./parts"
import { calendarQuery } from "./queries"

type Follow = (link: StepLink) => void

/** The calendar's weeks, from the start of this week (PLAN-FR-12). */
const CALENDAR_WEEKS = 5

const targetLink = (targetId: string): StepLink => ({ to: "/targets/$targetId", params: { targetId } })
const projectLink = (projectId: string): StepLink => ({ to: "/projects/$projectId", params: { projectId } })

/** Targets set to a night: no `night` for tonight, as Targets reads an absent night (PLAN-TGT-FR-16). */
function targetsLink(night: string, tonight: string): StepLink {
  return { to: "/targets", search: night === tonight ? {} : { night } }
}

/**
 * What the library could not compute without: the default site first, then
 * Home's criteria. Tonight passes the ways to set them; the calendar under
 * it names the same gap without repeating Tonight's buttons.
 */
function PlanningUnavailable({ reason, follow, onSetCriteria }: { reason: HomePlanningUnavailable; follow?: Follow; onSetCriteria?: () => void }) {
  const m = useMessages()
  if (reason === "no_site") {
    const action = follow ? <ActionButton action={{ id: "add-site", label: m.tonight_add_site(), run: () => follow({ to: "/settings/sites" }) }} /> : undefined
    return <EmptyState icon={MapPin} title={m.home_no_site_yet()} action={action} />
  }
  const action = onSetCriteria ? <ActionButton action={{ id: "set-criteria", label: m.home_set_criteria(), run: onSetCriteria }} /> : undefined
  return <EmptyState icon={SlidersHorizontal} title={m.home_no_criteria_yet()} action={action} />
}

// Goals ------------------------------------------------------------------------

/** "M 31 · Ha": the goal's subject and channel. */
function goalName(m: Messages, g: GoalGrade_Serialize): string {
  return m.home_goal_item({ subject: g.designation, channel: g.channel ?? m.palette_session_no_filter() })
}

const NO_POSITION: Record<WindowUnavailableReason, (m: Messages) => string> = {
  target_coordinates_unknown: (m) => m.tonight_no_coordinates(),
  unsupported_coordinate_frame: (m) => m.targets_reason_unsupported_frame(),
}

/** Why a goal has no grade, in the user's words. */
function ungradedReason(m: Messages, ungraded: Ungraded): string {
  return ungraded.kind === "no_band" ? m.home_ungraded_no_band() : NO_POSITION[ungraded.reason](m)
}

/** Best first, for sorting by grade: good, marginal, poor, then ungraded. */
const GRADE_RANK = { good: 0, marginal: 1, poor: 2 } as const

/** The note above Tonight's goals when none suits tonight; none when one does. */
function nextGoodNightNote(m: Messages, next: NextGoodNight_Serialize | null): string | null {
  switch (next?.state) {
    case "night":
      return m.home_no_goals_suit_next({ date: formatNight(next.night) })
    case "none_within":
      return m.home_no_goals_suit_within({ count: next.nights, n: formatCount(next.nights) })
    case "no_gradable_goal":
      return m.home_no_gradable_goal()
    default:
      return null
  }
}

/** Tonight's goals, graded by the library (PLAN-FR-11), and when the next good night is. */
export function TonightGoals({ tonight, follow, onSetCriteria }: { tonight: Tonight_Serialize; follow: Follow; onSetCriteria?: () => void }) {
  const m = useMessages()
  if (tonight.unavailableReason) return <PlanningUnavailable reason={tonight.unavailableReason} follow={follow} onSetCriteria={onSetCriteria} />
  if (tonight.goals.length === 0) {
    // No Project page opens its add-goal dialog from a link yet, so the way in is a new Project, as Open work's.
    const action = <ActionButton action={{ id: "new-project", label: m.newproject_open_ellipsis(), opensDialog: true, run: () => follow({ to: "/projects", search: { new: "open" } }) }} />
    return <EmptyState icon={FolderPlus} title={m.home_no_unfinished_goals()} action={action} />
  }
  const note = nextGoodNightNote(m, tonight.nextGoodNight)
  const columns: Column<GoalGrade_Serialize>[] = [
    {
      id: "goal",
      header: m.home_column_goal(),
      rowHeader: true,
      truncate: true,
      sortValue: (g) => goalName(m, g),
      cell: (g) => goalName(m, g),
    },
    {
      id: "grade",
      header: m.home_column_grade(),
      sortValue: (g) => (g.grade ? GRADE_RANK[g.grade] : 3),
      cell: (g) =>
        g.grade && g.band ? (
          <GradeBadges grades={[{ band: g.band, grade: g.grade }]} />
        ) : (
          <UnknownValue label={m.home_not_graded()} reason={g.ungraded ? ungradedReason(m, g.ungraded) : undefined} />
        ),
    },
    {
      id: "window",
      header: m.tonight_window(),
      align: "right",
      sortValue: (g) => g.window?.startUtc ?? null,
      cell: (g) => {
        const w = g.window
        if (!w) return <UnknownValue label="–" />
        const range = siteTimeRange(w.startUtc, w.endUtc, w.timeZone)
        return w.peakAltitudeDeg === null ? range : m.home_window_peak({ range, altitude: formatCount(Math.round(w.peakAltitudeDeg)) })
      },
    },
  ]
  return (
    <>
      {/* The note is the Box's top bar: an inline info bar meeting the Box edges, above the table. */}
      {note ? <Notice tone="info" title={note} className="rounded-none border-x-0 border-t-0" /> : null}
      <BoxTable
        label={m.home_tonight()}
        rows={tonight.goals.slice(0, ROWS)}
        columns={columns}
        getRowId={(g) => g.goalId}
        rowLabel={(g) => m.home_goal_in_project({ goal: goalName(m, g), project: g.projectName })}
        rowActions={(g) => [
          { id: "target", label: m.project_open_target(), run: () => follow(targetLink(g.targetId)) },
          { id: "project", label: m.target_open_project(), run: () => follow(projectLink(g.projectId)) },
        ]}
        onRowClick={(g) => follow(targetLink(g.targetId))}
        empty={m.home_no_unfinished_goals()}
      />
    </>
  )
}

// Calendar ---------------------------------------------------------------------

const PHASE: Record<MoonPhaseName, MessageRef> = {
  new: msg("tonight_moon_phase_new"),
  waxing_crescent: msg("tonight_moon_phase_waxing_crescent"),
  first_quarter: msg("tonight_moon_phase_first_quarter"),
  waxing_gibbous: msg("tonight_moon_phase_waxing_gibbous"),
  full: msg("tonight_moon_phase_full"),
  waning_gibbous: msg("tonight_moon_phase_waning_gibbous"),
  last_quarter: msg("tonight_moon_phase_last_quarter"),
  waning_crescent: msg("tonight_moon_phase_waning_crescent"),
}

/** The phases from New Moon up to Full Moon: the lit limb is on the right. */
const WAXING: ReadonlySet<MoonPhaseName> = new Set(["new", "waxing_crescent", "first_quarter", "waxing_gibbous"])

/** The library's Moon as the night visuals take it: a percentage, the phase's name, rise and set. */
function moonTonight(moon: NightMoon_Serialize): MoonTonight {
  return { illuminationPct: moon.illumination === null ? null : Math.round(moon.illumination * 100), phase: PHASE[moon.phase], rise: moon.riseUtc, set: moon.setUtc }
}

/** "Moon 40% Waxing gibbous · rises 21:40 CET · no moonset". */
function moonText(m: Messages, moon: MoonTonight, timeZone: string): string {
  return [
    moonPhrase(m, moon),
    moon.rise ? m.tonight_moon_rises({ time: siteTime(moon.rise, timeZone) }) : m.tonight_moon_no_rise(),
    moon.set ? m.tonight_moon_sets({ time: siteTime(moon.set, timeZone) }) : m.tonight_moon_no_set(),
  ].join(" · ")
}

/** Tonight through the last night of the calendar's fifth week. */
function calendarSpan(tonight: string): { firstNight: string; nights: number } {
  return { firstNight: tonight, nights: CALENDAR_WEEKS * 7 - dayInWeek(tonight, WEEK_START[getLocale()]) }
}

/**
 * Home's calendar (PLAN-FR-12) from tonight, the site-local evening date
 * Tonight names. Without that date the library computed nothing for
 * Tonight, so `reason` (Tonight's own) stands for the calendar too: both
 * read the one default site and Home's one set of criteria.
 */
export function HomeCalendar({ tonight, reason }: { tonight: string | null; reason: HomePlanningUnavailable | null }) {
  const m = useMessages()
  const span = tonight ? calendarSpan(tonight) : null
  const calendar = useQuery({ ...calendarQuery(span?.firstNight ?? "", span?.nights ?? 0), enabled: span !== null })
  if (!tonight) return reason ? <PlanningUnavailable reason={reason} /> : null
  if (calendar.error) return <ActionError message={readError(m, calendar.error)} onRetry={() => void calendar.refetch()} />
  const data = calendar.data
  if (!data) return null
  if (data.unavailableReason) return <PlanningUnavailable reason={data.unavailableReason} />
  const { site, timeZone } = data
  // The library computes nights only at a site, so a reply with nights names it.
  if (!site || !timeZone) return <PlanningUnavailable reason="no_site" />
  const names = (goals: GoalGrade_Serialize[]) => (goals.length === 0 ? "–" : formatList(goals.map((g) => goalName(m, g))))
  const nights = data.nights.map((n: CalendarNight_Serialize): CalendarNight => {
    const moon = moonTonight(n.moon)
    return {
      night: n.night,
      moon,
      waxing: WAXING.has(n.moon.phase),
      darkS: n.darkness ? n.darkSeconds : null,
      goals: n.suitedGoals.length,
      // astro-plan-wre19.14: planning_calendar carries no plannedTargets yet.
      planned: null,
      link: targetsLink(n.night, tonight),
      card: (
        <KeyValueList
          items={[
            { label: m.plan_dark(), value: n.darkness ? siteTimeRange(n.darkness.startUtc, n.darkness.endUtc, timeZone) : m.calendar_never_dark() },
            { label: m.tonight_moon(), value: moonText(m, moon, timeZone) },
            { label: m.calendar_legend_goals(), value: names(n.suitedGoals) },
            { label: m.home_moon_rules_out(), value: names(n.moonRuledOutGoals) },
            { label: m.calendar_legend_planned(), value: <UnknownValue label={m.calendar_plan_unknown()} /> },
          ]}
        />
      ),
    }
  })
  return (
    <>
      <NightCalendar label={m.home_calendar_label({ site: site.name })} today={tonight} nights={nights} />
      {/* astro-plan-wre19.14: the Targets in each night's plan (plannedTargets). */}
      <Notice tone="info" title={m.home_planned_unavailable()} className="mt-3" />
    </>
  )
}
