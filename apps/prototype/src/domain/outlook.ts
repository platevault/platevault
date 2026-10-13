/**
 * The nights ahead for the unfinished goals of open Projects (decision C8,
 * moved from the Home concepts). Each one joins existing derives; none of
 * them owns a rule.
 *
 * - `goalHorizon`: every unmet goal of an open Project (`targetStatus`),
 *   graded on each night of a horizon under its filter's Moon-avoidance
 *   curve (`nightImaging`, C6), plus each subject's Img time per night. The
 *   Sun and Moon samples (`skyNight`) are computed once per night and shared
 *   by every subject.
 * - `nightOutlooks`: per night, the darkness and the Moon at the site, the
 *   goals the night suits (best first) and those the Moon rules out, and the
 *   Targets on the night's plan. Home's calendar shows them.
 * - `goalsTonight`: the unmet goals graded on the horizon's first night,
 *   best first. Home's Tonight shows them.
 */
import { type GoalProgress, subjectCentre, subjectTarget, targetStatus } from "./derive"
import { BANDS, DEFAULT_MOON_AVOIDANCE } from "./labels"
import { altitudeDeg, defaultCriteria, type FilterGrade, julianDay, nightImaging, nightPlan, nightSummary, shiftNight, skyNight, type Tonight } from "./planning"
import type { Band, Catalog, GoalChannel, NightDate, ObservingSite, Project, Subject, Target } from "./types"

/** One subject of an open Project that still has unmet goals. */
export interface SubjectOutlook {
  /** `projectId/subjectId`. */
  key: string
  project: Project
  subject: Subject
  target: Target
  /** Img time in minutes on each horizon night: the windows of every unmet filter, merged. Zero without a position. */
  minutes: number[]
}

/** One unmet goal and its filter's grade on each horizon night. */
export interface GoalOutlook {
  subject: SubjectOutlook
  progress: GoalProgress
  /** One grade per horizon night; null when the subject has no position or the channel has no curve of its own (OSC, Dual-band). */
  grades: FilterGrade[] | null
  /** Per night: poor only because of the Moon, the position being up in darkness for at least the minimum duration. */
  moonLimited: boolean[] | null
}

export interface Horizon {
  nights: NightDate[]
  /** Darkness and the Moon at the site, per night. */
  summaries: Tonight[]
  subjects: SubjectOutlook[]
  goals: GoalOutlook[]
}

function isBand(channel: GoalChannel): channel is Band {
  return (BANDS as readonly string[]).includes(channel)
}

/** The unmet goals of open Projects graded over `count` nights from `firstNight` at `site`. */
export function goalHorizon(catalog: Catalog, site: ObservingSite, nowMs: number, firstNight: NightDate, count: number): Horizon {
  const criteria = defaultCriteria(site)
  const nights = Array.from({ length: count }, (_, i) => shiftNight(firstNight, i))

  const bySubject = new Map<string, { outlook: SubjectOutlook; centre: { ra: number; dec: number } | null; goals: GoalOutlook[] }>()
  for (const { project, subject, progress } of targetStatus(catalog)) {
    const target = subjectTarget(catalog, subject)
    if (!target) continue
    const key = `${project.id}/${subject.id}`
    let entry = bySubject.get(key)
    if (!entry) {
      entry = { outlook: { key, project, subject, target, minutes: [] }, centre: subjectCentre(catalog, subject), goals: [] }
      bySubject.set(key, entry)
    }
    const graded = entry.centre !== null && isBand(progress.goal.channel)
    entry.goals.push({ subject: entry.outlook, progress, grades: graded ? [] : null, moonLimited: graded ? [] : null })
  }

  const entries = [...bySubject.values()]
  for (const night of nights) {
    const sky = skyNight(site, night, criteria.darkness)
    for (const { outlook, centre, goals } of entries) {
      if (!centre) {
        outlook.minutes.push(0)
        continue
      }
      const altitudes = sky.samples.map((sample) => altitudeDeg(centre.ra, centre.dec, site.latitude, site.longitude, julianDay(sample.ms)))
      const bands = [...new Set(goals.map((g) => g.progress.goal.channel).filter(isBand))]
      const imaging = nightImaging(sky, altitudes, centre, criteria, DEFAULT_MOON_AVOIDANCE, bands, nowMs)
      outlook.minutes.push(imaging.minutes)
      for (const goal of goals) {
        const filter = imaging.filters.find((f) => f.band === goal.progress.goal.channel)
        if (!goal.grades || !goal.moonLimited || !filter) continue
        goal.grades.push(filter.grade)
        goal.moonLimited.push(filter.grade === "poor" && imaging.darkMinutes >= criteria.minDurationMin)
      }
    }
  }

  return {
    nights,
    summaries: nights.map((night) => nightSummary(site, night)),
    subjects: entries.map((e) => e.outlook),
    goals: entries.flatMap((e) => e.goals),
  }
}

/** Index of the first good night after `from`, else null. */
export function nextGoodNight(grades: readonly FilterGrade[], from = 0): number | null {
  for (let i = from + 1; i < grades.length; i += 1) if (grades[i] === "good") return i
  return null
}

/** Sort order of the grades: good first. */
export const GRADE_RANK: Record<FilterGrade, number> = { good: 0, marginal: 1, poor: 2 }

/** Best first on night `i`: the better grade, then the more Img time, then the subject's key. */
function bestOn(i: number): (a: GoalOutlook, b: GoalOutlook) => number {
  const rank = (g: GoalOutlook) => (g.grades?.[i] ? GRADE_RANK[g.grades[i]] : 3)
  return (a, b) => rank(a) - rank(b) || (b.subject.minutes[i] ?? 0) - (a.subject.minutes[i] ?? 0) || a.subject.key.localeCompare(b.subject.key)
}

/** One night of a horizon, as Home's calendar shows it. */
export interface NightOutlook {
  night: NightDate
  summary: Tonight
  /** Seconds of darkness at the site; null when it never gets dark. */
  darkS: number | null
  /** The Moon is more lit on the next night. */
  waxing: boolean
  /** Unmet goals graded good on the night, best first. */
  suited: GoalOutlook[]
  /** Unmet goals the Moon rules out on the night. */
  moonLimited: GoalOutlook[]
  /** The Targets on the night's plan, by name. */
  planned: Target[]
}

/** Each horizon night's darkness, Moon, suited and Moon-limited goals and plan. */
export function nightOutlooks(catalog: Catalog, site: ObservingSite, horizon: Horizon): NightOutlook[] {
  const after = horizon.nights.length > 0 ? nightSummary(site, shiftNight(horizon.nights.at(-1)!, 1)) : null
  return horizon.nights.map((night, i) => {
    const summary = horizon.summaries[i]!
    const next = horizon.summaries[i + 1] ?? after!
    const dark = summary.darkness
    return {
      night,
      summary,
      darkS: dark ? (Date.parse(dark.end) - Date.parse(dark.start)) / 1000 : null,
      waxing: next.moon.illuminationPct > summary.moon.illuminationPct,
      suited: horizon.goals.filter((g) => g.grades?.[i] === "good").sort(bestOn(i)),
      moonLimited: horizon.goals.filter((g) => g.moonLimited?.[i] === true),
      planned: nightPlan(catalog, night),
    }
  })
}

/** What Tonight lists: the goals graded good or marginal on the horizon's first night, best first, and the next night that suits any goal. */
export interface GoalsTonight {
  goals: GoalOutlook[]
  /** The first later horizon night with a goal graded good; null when none. */
  nextGood: NightDate | null
}

export function goalsTonight(horizon: Horizon): GoalsTonight {
  const goals = horizon.goals.filter((g) => g.grades?.[0] === "good" || g.grades?.[0] === "marginal").sort(bestOn(0))
  const next = horizon.goals.reduce<number | null>((first, g) => {
    const i = g.grades ? nextGoodNight(g.grades) : null
    return i !== null && (first === null || i < first) ? i : first
  }, null)
  return { goals, nextGood: next === null ? null : horizon.nights[next]! }
}
